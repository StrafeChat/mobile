package chat.strafe.push

import android.content.Context
import android.content.Intent
import android.util.Log
import org.unifiedpush.android.connector.FailedReason
import org.unifiedpush.android.connector.MessagingReceiver
import org.unifiedpush.android.connector.data.PublicKeySet
import org.unifiedpush.android.connector.data.PushEndpoint
import org.unifiedpush.android.connector.data.PushMessage
import org.unifiedpush.android.connector.keys.KeyManager
import java.security.GeneralSecurityException
import java.util.concurrent.Executors

/**
 * The UnifiedPush connector's key manager, backed by our slot keys: the connector reports
 * our `p256dh`/`auth` with each endpoint and decrypts through [WebPushCrypto], so FCM and
 * UnifiedPush share one set of keys and one decryption path, and the connector's own
 * (Tink-backed) key store is never used.
 *
 * Key lifetime belongs to `ensureKeys`/`deleteKeys`: unregistering a slot from UnifiedPush
 * leaves its keys alone ([delete] is a no-op).
 *
 * The connector calls these from its receiver and catches nothing but a
 * GeneralSecurityException out of [decrypt]: a keystore fault anywhere else (a
 * ProviderException, or keys [PushStore.loadKeys] keeps because the fault may pass) would
 * escape its onReceive and kill the process, the message unacknowledged, so redelivered into
 * the same crash. Each answers "no keys" instead, logged by type only: that push is dropped
 * (`decrypted = false`, which [StrafeUnifiedPushReceiver.onMessage] ignores) and the next is
 * tried afresh.
 */
internal class SlotKeyManager(context: Context) : KeyManager {
  private val store = PushStore.get(context)

  override fun decrypt(instance: String, sealed: ByteArray): ByteArray? = orElse(null) {
    val keys = store.loadKeys(instance) ?: return@orElse null
    try {
      WebPushCrypto.decrypt(sealed, keys)
    } catch (e: WebPushException) {
      Log.w(TAG, "UnifiedPush message could not be decrypted: ${e.message}")
      null
    }
  }

  override fun generate(instance: String) = orElse(Unit) {
    store.ensureKeys(instance)
    Unit
  }

  override fun getPublicKeySet(instance: String): PublicKeySet? = orElse(null) {
    val keys = store.loadKeys(instance) ?: return@orElse null
    PublicKeySet(WebPushCrypto.base64UrlEncode(keys.publicKey), WebPushCrypto.base64UrlEncode(keys.auth))
  }

  override fun exists(instance: String): Boolean = orElse(false) { store.hasKeys(instance) }

  override fun delete(instance: String) = Unit

  private inline fun <T> orElse(fallback: T, block: () -> T): T =
    try {
      block()
    } catch (e: RuntimeException) {
      Log.w(TAG, "slot keys unavailable: ${e.javaClass.simpleName}")
      fallback
    } catch (e: GeneralSecurityException) {
      Log.w(TAG, "slot keys unavailable: ${e.javaClass.simpleName}")
      fallback
    }

  private companion object {
    const val TAG = "StrafePush"
  }
}

/**
 * Receives UnifiedPush events from the distributor (connector 3.x `MessagingReceiver`; the
 * slot is the connector's `instance`). Declared at the default priority, which also stands
 * down the connector's own MessagingReceiverImpl so only our key manager is ever used.
 */
class StrafeUnifiedPushReceiver : MessagingReceiver() {
  override fun getKeyManager(context: Context): KeyManager = SlotKeyManager(context)

  override fun onReceive(context: Context, intent: Intent) {
    // Decrypting and rendering (an avatar fetch included) is too much for the main thread.
    val pending = goAsync()
    executor.execute {
      try {
        super.onReceive(context, intent)
      } catch (e: RuntimeException) {
        // Uncaught on this thread it would kill the process (and the open app with it); the
        // key manager and our callbacks guard themselves, this is for whatever else throws.
        Log.w(TAG, "UnifiedPush event dropped: ${e.javaClass.simpleName}")
      } finally {
        pending.finish()
      }
    }
  }

  override fun onNewEndpoint(context: Context, endpoint: PushEndpoint, instance: String) {
    if (!Slots.isValid(instance)) return
    val keys = endpoint.pubKeySet
    val saved = UnifiedPushEndpoint(instance, endpoint.url, keys?.pubKey, keys?.auth)
    PushStore.get(context).setUnifiedPushEndpoint(saved)
    PushEvents.emit(PushEvents.UNIFIED_PUSH_ENDPOINT, saved.toEvent())
  }

  override fun onMessage(context: Context, message: PushMessage, instance: String) {
    // Plaintext from a distributor would mean the instance didn't encrypt it, or someone
    // else sent it: never shown.
    if (!message.decrypted || !Slots.isValid(instance)) return
    PushHandler.handlePlaintext(context, instance, message.content)
  }

  override fun onRegistrationFailed(context: Context, reason: FailedReason, instance: String) {
    PushEvents.emit(PushEvents.UNIFIED_PUSH_FAILED, mapOf("slot" to instance, "reason" to reason.name))
  }

  override fun onUnregistered(context: Context, instance: String) {
    PushStore.get(context).removeUnifiedPushEndpoint(instance)
    PushEvents.emit(PushEvents.UNIFIED_PUSH_UNREGISTERED, mapOf("slot" to instance))
  }

  private companion object {
    const val TAG = "StrafePush"
    val executor = Executors.newSingleThreadExecutor()
  }
}

/** The `unifiedPushEndpoint` event / `getUnifiedPushEndpoint` result shape. */
internal fun UnifiedPushEndpoint.toEvent(): Map<String, Any?> = buildMap {
  put("slot", slot)
  put("endpoint", endpoint)
  if (p256dh != null && auth != null) put("keys", mapOf("p256dh" to p256dh, "auth" to auth))
}
