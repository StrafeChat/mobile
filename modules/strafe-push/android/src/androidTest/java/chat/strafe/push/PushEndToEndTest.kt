package chat.strafe.push

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * The native push path on a real device: slot keys sealed in the AndroidKeyStore, a push
 * encrypted to them as the instance does, the same entry point FCM and the debug receiver
 * use, and the notifications that come out. Runs in the module's own test APK, so it never
 * touches the app's data.
 */
@RunWith(AndroidJUnit4::class)
class PushEndToEndTest {
  private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext
  private val manager = context.getSystemService(NotificationManager::class.java)
  private val store = PushStore.get(context)
  private val slot = "e2e"

  @Before
  fun setUp() {
    if (Build.VERSION.SDK_INT >= 33) {
      InstrumentationRegistry.getInstrumentation().uiAutomation
        .grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
    }
    manager.cancelAll()
    store.deleteKeys(slot)
    store.setDisplayConfig(
      DisplayConfig(
        accounts = listOf(DisplayAccount(slot, "100", "@alice", "http://127.0.0.1:9")),
        activeSlot = null,
      ),
    )
  }

  @After
  fun tearDown() {
    manager.cancelAll()
    store.deleteKeys(slot)
  }

  @Test
  fun keysSurviveTheKeystoreRoundTrip() {
    val first = store.ensureKeys(slot)
    val again = store.loadKeys(slot)!!
    assertTrue(first.publicKey.contentEquals(again.publicKey))
    assertTrue(first.auth.contentEquals(again.auth))
    assertEquals(65, first.publicKey.size)
    assertEquals(16, first.auth.size)
  }

  @Test
  fun messagesStackAndReadsClearThem() {
    push("""{"v":1,"t":"msg","uid":"100","ts":1,"rid":"7","rt":3,"sid":"9","mid":"1001","a":{"id":"5","n":"Bob"},"rn":"general","sn":"HQ","b":"first"}""")
    push("""{"v":1,"t":"msg","uid":"100","ts":2,"rid":"7","rt":3,"sid":"9","mid":"1002","a":{"id":"5","n":"Bob"},"rn":"general","sn":"HQ","b":"second"}""")

    val room = active("strafe:$slot:room:7")!!
    val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(room.notification)!!
    assertEquals(listOf("first", "second"), style.messages.map { it.text.toString() })
    assertEquals("#general · HQ", style.conversationTitle.toString())
    assertEquals("strafe:$slot", room.notification.group)
    assertNotNull(active("strafe:$slot:summary"))

    // Read up to the first message: the second stays.
    push("""{"v":1,"t":"read","uid":"100","ts":3,"rid":"7","rt":3,"mid":"1001"}""")
    val after = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(active("strafe:$slot:room:7")!!.notification)!!
    assertEquals(listOf("second"), after.messages.map { it.text.toString() })

    push("""{"v":1,"t":"read","uid":"100","ts":4,"rid":"7","rt":3,"mid":"1002"}""")
    assertGone("strafe:$slot:room:7")
    assertGone("strafe:$slot:summary")
  }

  @Test
  fun encryptedRoomsNeverShowABody() {
    push("""{"v":1,"t":"msg","uid":"100","ts":1,"rid":"8","rt":1,"mid":"1","a":{"id":"5","n":"Bob"},"e":true,"b":"secret"}""")
    val style = NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(active("strafe:$slot:room:8")!!.notification)!!
    assertEquals(PushStrings().encryptedMessage, style.messages.single().text.toString())
  }

  @Test
  fun callsRingUntilCallEnd() {
    push("""{"v":1,"t":"call","uid":"100","ts":${System.currentTimeMillis()},"rid":"8","rt":2,"a":{"id":"5","n":"Bob"},"rn":"Weekend plans"}""")
    val call = active("strafe:$slot:call:8")!!
    assertEquals("Bob is calling Weekend plans", call.notification.extras.getCharSequence(NotificationCompat.EXTRA_TEXT).toString())
    assertEquals(2, call.notification.actions.size)
    push("""{"v":1,"t":"call_end","uid":"100","ts":2,"rid":"8","rt":2}""")
    assertGone("strafe:$slot:call:8")
  }

  @Test
  fun ignoresPushesForAnotherAccountOrNotForUs() {
    push("""{"v":1,"t":"msg","uid":"999","ts":1,"rid":"7","rt":1,"mid":"1","a":{"id":"5","n":"Bob"}}""")
    assertGone("strafe:$slot:room:7")
    // Encrypted to someone else's keys.
    val stranger = WebPushCrypto.generateKeyPair()
    val other = WebPushKeys(
      stranger.private as java.security.interfaces.ECPrivateKey,
      WebPushCrypto.encodePublicKey(stranger.public as ECPublicKey),
      ByteArray(16),
    )
    val body = encrypt("""{"v":1,"t":"test","uid":"100","ts":1}""".toByteArray(), other)
    PushHandler.handleEncoded(context, slot, WebPushCrypto.base64UrlEncode(body))
    assertGone("strafe:$slot:test")
  }

  @Test
  fun showsTheTestNotification() {
    push("""{"v":1,"t":"test","uid":"100","ts":1}""")
    assertNotNull(active("strafe:$slot:test"))
    PushNotifier(context).clearAll(slot)
    assertGone("strafe:$slot:test")
  }

  private fun push(json: String) {
    val body = encrypt(json.toByteArray(), store.ensureKeys(slot))
    PushHandler.handleEncoded(context, slot, WebPushCrypto.base64UrlEncode(body))
  }

  /** The notification with [tag]; posting goes through the system server asynchronously, so give it a moment. */
  private fun active(tag: String): StatusBarNotification? = poll { manager.activeNotifications.firstOrNull { it.tag == tag } }

  /** Asserts nothing with [tag] is showing (a cancel also takes a moment to land). */
  private fun assertGone(tag: String) {
    val gone = poll { if (manager.activeNotifications.none { it.tag == tag }) true else null }
    assertTrue("$tag still showing", gone == true)
  }

  private fun <T> poll(read: () -> T?): T? {
    val deadline = System.currentTimeMillis() + 3000
    while (true) {
      read()?.let { return it }
      if (System.currentTimeMillis() > deadline) return null
      Thread.sleep(50)
    }
  }

  /** The instance's side: RFC 8291, one record padded to the smallest bucket. */
  private fun encrypt(message: ByteArray, to: WebPushKeys): ByteArray {
    val sender = WebPushCrypto.generateKeyPair()
    val senderPublic = WebPushCrypto.encodePublicKey(sender.public as ECPublicKey)
    val receiver = KeyFactory.getInstance("EC").generatePublic(
      ECPublicKeySpec(
        ECPoint(BigInteger(1, to.publicKey.copyOfRange(1, 33)), BigInteger(1, to.publicKey.copyOfRange(33, 65))),
        to.privateKey.params,
      ),
    )
    val secret = KeyAgreement.getInstance("ECDH").run {
      init(sender.private)
      doPhase(receiver, true)
      generateSecret()
    }
    val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
    val ikm = hmac(hmac(to.auth, secret), "WebPush: info".toByteArray() + byteArrayOf(0) + to.publicKey + senderPublic + byteArrayOf(1))
    val prk = hmac(salt, ikm)
    val cek = hmac(prk, "Content-Encoding: aes128gcm".toByteArray() + byteArrayOf(0, 1)).copyOf(16)
    val nonce = hmac(prk, "Content-Encoding: nonce".toByteArray() + byteArrayOf(0, 1)).copyOf(12)
    val bucket = listOf(256, 512, 1024, 2048).first { it >= message.size + 1 }
    val padded = message + byteArrayOf(2) + ByteArray(bucket - message.size - 1)
    val ciphertext = Cipher.getInstance("AES/GCM/NoPadding").run {
      init(Cipher.ENCRYPT_MODE, SecretKeySpec(cek, "AES"), GCMParameterSpec(128, nonce))
      doFinal(padded)
    }
    return ByteBuffer.allocate(86 + ciphertext.size).put(salt).putInt(4096).put(65.toByte()).put(senderPublic).put(ciphertext).array()
  }

  private fun hmac(key: ByteArray, data: ByteArray) =
    Mac.getInstance("HmacSHA256").run {
      init(SecretKeySpec(key, "HmacSHA256"))
      doFinal(data)
    }
}
