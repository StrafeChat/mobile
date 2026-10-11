package chat.strafe.push

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import org.json.JSONException
import org.json.JSONObject
import java.security.GeneralSecurityException
import java.security.KeyFactory
import java.security.KeyStore
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.PKCS8EncodedKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** A UnifiedPush endpoint as last given to a slot. */
data class UnifiedPushEndpoint(val slot: String, val endpoint: String, val p256dh: String?, val auth: String?)

/**
 * Everything the push path keeps on disk, in app-private SharedPreferences.
 *
 * The secrets - each slot's Web Push private key and auth secret, and each account's session
 * token for the background actions - are sealed with an AES-256-GCM key that lives in the
 * AndroidKeyStore and can't be exported, each bound (as GCM associated data) to what it is
 * and which slot it belongs to, so values can't be swapped between entries. Public keys,
 * endpoints and the display config are not secret and are stored as they are.
 *
 * No user authentication on the wrapping key: pushes are decrypted while the phone is locked.
 */
class PushStore private constructor(context: Context) {
  private val prefs: SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private val lock = Any()

  // --- Web Push keys ---

  /** The slot's keys, created if missing (and recreated if the wrapping key was lost). */
  fun ensureKeys(slot: String): WebPushKeys = synchronized(lock) {
    loadKeys(slot) ?: generateKeys(slot)
  }

  fun loadKeys(slot: String): WebPushKeys? = synchronized(lock) {
    val pub = prefs.getString("k.$slot.pub", null) ?: return null
    val sealedPriv = prefs.getString("k.$slot.priv", null) ?: return null
    val sealedAuth = prefs.getString("k.$slot.auth", null) ?: return null
    return try {
      val pkcs8 = open(WebPushCrypto.base64UrlDecode(sealedPriv), "priv", slot)
      val auth = open(WebPushCrypto.base64UrlDecode(sealedAuth), "auth", slot)
      val priv = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(pkcs8)) as ECPrivateKey
      WebPushKeys(priv, WebPushCrypto.base64UrlDecode(pub), auth)
    } catch (e: GeneralSecurityException) {
      // The keystore key is gone (e.g. the app's keystore was reset): these keys are
      // unrecoverable. A fresh ensureKeys() makes new ones and JS re-subscribes with them.
      Log.w(TAG, "slot keys unreadable, discarding them", e)
      deleteKeys(slot)
      null
    }
  }

  fun hasKeys(slot: String): Boolean = loadKeys(slot) != null

  fun deleteKeys(slot: String) = synchronized(lock) {
    prefs.edit().remove("k.$slot.pub").remove("k.$slot.priv").remove("k.$slot.auth").commit()
    Unit
  }

  @SuppressLint("ApplySharedPref")
  private fun generateKeys(slot: String): WebPushKeys {
    val pair = WebPushCrypto.generateKeyPair()
    val pub = WebPushCrypto.encodePublicKey(pair.public as ECPublicKey)
    val auth = ByteArray(16).also { java.security.SecureRandom().nextBytes(it) }
    // commit(), not apply(): the public half is about to be handed to an instance, and the
    // private half must already be on disk if the process dies right after.
    val ok = prefs.edit()
      .putString("k.$slot.pub", WebPushCrypto.base64UrlEncode(pub))
      .putString("k.$slot.priv", WebPushCrypto.base64UrlEncode(seal(pair.private.encoded, "priv", slot)))
      .putString("k.$slot.auth", WebPushCrypto.base64UrlEncode(seal(auth, "auth", slot)))
      .commit()
    if (!ok) throw GeneralSecurityException("could not persist push keys")
    return WebPushKeys(pair.private as ECPrivateKey, pub, auth)
  }

  // --- session tokens (for Mark as read / Decline) ---

  fun setToken(slot: String, token: String?) = synchronized(lock) {
    if (token.isNullOrEmpty()) {
      prefs.edit().remove("tok.$slot").apply()
    } else {
      prefs.edit().putString("tok.$slot", WebPushCrypto.base64UrlEncode(seal(token.toByteArray(), "tok", slot))).apply()
    }
  }

  fun token(slot: String): String? = synchronized(lock) {
    val sealed = prefs.getString("tok.$slot", null) ?: return null
    return try {
      String(open(WebPushCrypto.base64UrlDecode(sealed), "tok", slot))
    } catch (e: GeneralSecurityException) {
      prefs.edit().remove("tok.$slot").apply()
      null
    }
  }

  /** Tokens of accounts that are no longer configured are dropped. */
  fun retainTokens(slots: Set<String>) = synchronized(lock) {
    val stale = prefs.all.keys.filter { it.startsWith("tok.") && it.removePrefix("tok.") !in slots }
    if (stale.isNotEmpty()) prefs.edit().apply { stale.forEach { remove(it) } }.apply()
  }

  // --- notification links ---

  /**
   * This install's link key: random, made once, kept in app-private storage. Our own
   * notifications put it in the `strafe://push/open` links of their Reply / Answer buttons
   * ([PushContent.deepLink]) and JS only acts on those buttons when it matches, so another
   * app or a web page opening such a link can at most open a room - never answer a call.
   */
  @SuppressLint("ApplySharedPref")
  fun linkKey(): String = synchronized(lock) {
    prefs.getString(LINK_KEY, null)?.let { return it }
    val key = WebPushCrypto.base64UrlEncode(ByteArray(16).also { java.security.SecureRandom().nextBytes(it) })
    prefs.edit().putString(LINK_KEY, key).commit()
    return key
  }

  // --- display config ---

  fun displayConfig(): DisplayConfig {
    val raw = prefs.getString("display", null) ?: return DisplayConfig()
    return try {
      DisplayConfig.fromJson(JSONObject(raw))
    } catch (e: JSONException) {
      DisplayConfig()
    }
  }

  fun setDisplayConfig(config: DisplayConfig) {
    prefs.edit().putString("display", config.toJson().toString()).apply()
  }

  // --- transports ---

  var fcmToken: String?
    get() = prefs.getString("fcm.token", null)
    set(value) = prefs.edit().putString("fcm.token", value).apply()

  fun unifiedPushEndpoint(slot: String): UnifiedPushEndpoint? {
    val raw = prefs.getString("up.$slot", null) ?: return null
    return try {
      val o = JSONObject(raw)
      UnifiedPushEndpoint(slot, o.getString("endpoint"), o.optString("p256dh").ifEmpty { null }, o.optString("auth").ifEmpty { null })
    } catch (e: JSONException) {
      null
    }
  }

  fun setUnifiedPushEndpoint(value: UnifiedPushEndpoint) {
    val o = JSONObject().put("endpoint", value.endpoint)
    value.p256dh?.let { o.put("p256dh", it) }
    value.auth?.let { o.put("auth", it) }
    prefs.edit().putString("up.${value.slot}", o.toString()).apply()
  }

  fun removeUnifiedPushEndpoint(slot: String) {
    prefs.edit().remove("up.$slot").apply()
  }

  /** The slot's instance VAPID key (base64url), passed to distributors that want one. */
  fun vapidKey(slot: String): String? = prefs.getString("vapid.$slot", null)

  fun setVapidKey(slot: String, key: String) {
    prefs.edit().putString("vapid.$slot", key).apply()
  }

  // --- sealing ---

  private fun seal(plain: ByteArray, kind: String, slot: String): ByteArray {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, wrappingKey())
    cipher.updateAAD(aad(kind, slot))
    val iv = cipher.iv
    return byteArrayOf(iv.size.toByte()) + iv + cipher.doFinal(plain)
  }

  private fun open(sealed: ByteArray, kind: String, slot: String): ByteArray {
    if (sealed.isEmpty()) throw GeneralSecurityException("empty")
    val ivLength = sealed[0].toInt() and 0xff
    if (sealed.size < 1 + ivLength + 16) throw GeneralSecurityException("truncated")
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.DECRYPT_MODE, wrappingKey(), GCMParameterSpec(128, sealed, 1, ivLength))
    cipher.updateAAD(aad(kind, slot))
    return cipher.doFinal(sealed, 1 + ivLength, sealed.size - 1 - ivLength)
  }

  private fun aad(kind: String, slot: String) = "strafe-push/1:$kind:$slot".toByteArray()

  private fun wrappingKey(): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    generator.init(
      KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setKeySize(256)
        .setRandomizedEncryptionRequired(true)
        .build(),
    )
    return generator.generateKey()
  }

  companion object {
    private const val TAG = "StrafePush"
    private const val PREFS = "chat.strafe.push"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val KEY_ALIAS = "chat.strafe.push.wrap"
    private const val TRANSFORMATION = "AES/GCM/NoPadding"
    private const val LINK_KEY = "link.key"

    @Volatile private var instance: PushStore? = null

    fun get(context: Context): PushStore =
      instance ?: synchronized(this) {
        instance ?: PushStore(context.applicationContext).also { instance = it }
      }
  }
}
