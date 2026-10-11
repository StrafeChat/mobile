package chat.strafe.push

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.SecureRandom
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPrivateKeySpec
import java.security.spec.ECPublicKeySpec
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class WebPushCryptoTest {
  private fun b64(s: String) = WebPushCrypto.base64UrlDecode(s.replace(" ", ""))

  private val p256: ECParameterSpec =
    AlgorithmParameters.getInstance("EC").apply { init(ECGenParameterSpec("secp256r1")) }.getParameterSpec(ECParameterSpec::class.java)

  private fun privateKey(raw: ByteArray) =
    KeyFactory.getInstance("EC").generatePrivate(ECPrivateKeySpec(BigInteger(1, raw), p256)) as ECPrivateKey

  private fun publicKey(raw: ByteArray) =
    KeyFactory.getInstance("EC").generatePublic(
      ECPublicKeySpec(ECPoint(BigInteger(1, raw.copyOfRange(1, 33)), BigInteger(1, raw.copyOfRange(33, 65))), p256),
    ) as ECPublicKey

  // RFC 8291 section 5 / Appendix A.
  private val rfcKeys = WebPushKeys(
    privateKey(b64("q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94")),
    b64("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
    b64("BTBZMqHH6r4Tts7J_aSIgg"),
  )
  // The whole 144-octet message of section 5 (86-octet header, then the ciphertext).
  private val rfcBody = b64(
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml" +
      "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT" +
      "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
  )

  @Test
  fun decryptsTheRfc8291Example() {
    // Appendix A: the header carries the sender key, then the ciphertext follows.
    assertArrayEquals(b64("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"), rfcBody.copyOfRange(21, 86))
    assertArrayEquals(b64("8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ"), rfcBody.copyOfRange(86, rfcBody.size))
    val plaintext = WebPushCrypto.decrypt(rfcBody, rfcKeys)
    assertEquals("When I grow up, I want to be a watermelon", String(plaintext))
  }

  @Test
  fun encodesTheRfcPublicKey() {
    assertArrayEquals(rfcKeys.publicKey, WebPushCrypto.encodePublicKey(publicKey(rfcKeys.publicKey)))
  }

  @Test
  fun rejectsATamperedBody() {
    val tampered = rfcBody.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
    assertThrows(WebPushException::class.java) { WebPushCrypto.decrypt(tampered, rfcKeys) }
  }

  @Test
  fun rejectsTheWrongAuthSecret() {
    val other = WebPushKeys(rfcKeys.privateKey, rfcKeys.publicKey, ByteArray(16))
    assertThrows(WebPushException::class.java) { WebPushCrypto.decrypt(rfcBody, other) }
  }

  @Test
  fun rejectsASenderKeyOffTheCurve() {
    val bad = rfcBody.copyOf().also { it[21 + 64] = (it[21 + 64].toInt() xor 1).toByte() }
    assertThrows(WebPushException::class.java) { WebPushCrypto.decrypt(bad, rfcKeys) }
  }

  @Test
  fun rejectsTruncatedAndMultiRecordBodies() {
    assertThrows(WebPushException::class.java) { WebPushCrypto.decrypt(rfcBody.copyOf(40), rfcKeys) }
    // rs smaller than the ciphertext would mean a second record.
    val multi = rfcBody.copyOf().also { ByteBuffer.wrap(it, 16, 4).putInt(20) }
    assertThrows(WebPushException::class.java) { WebPushCrypto.decrypt(multi, rfcKeys) }
  }

  @Test
  fun roundTripsThroughEveryPaddingBucket() {
    val pair = WebPushCrypto.generateKeyPair()
    val keys = WebPushKeys(pair.private as ECPrivateKey, WebPushCrypto.encodePublicKey(pair.public as ECPublicKey), ByteArray(16).also { SecureRandom().nextBytes(it) })
    for (size in listOf(0, 1, 100, 255, 256, 600, 1023, 2047)) {
      val message = ByteArray(size) { ('a' + it % 26).code.toByte() }
      val bucket = listOf(256, 512, 1024, 2048).first { it >= size + 1 }
      val body = encrypt(message, keys, bucket)
      assertArrayEquals("size $size", message, WebPushCrypto.decrypt(body, keys))
    }
  }

  @Test
  fun unpadRequiresTheLastRecordDelimiter() {
    assertArrayEquals(byteArrayOf(7, 0, 9), WebPushCrypto.unpad(byteArrayOf(7, 0, 9, 2, 0, 0)))
    assertThrows(WebPushException::class.java) { WebPushCrypto.unpad(byteArrayOf(7, 1, 0)) }
    assertThrows(WebPushException::class.java) { WebPushCrypto.unpad(byteArrayOf(0, 0)) }
  }

  /** The instance's side (as equinox does it): one record, padded to [recordPlaintext] bytes including the delimiter. */
  private fun encrypt(message: ByteArray, to: WebPushKeys, recordPlaintext: Int): ByteArray {
    val sender = WebPushCrypto.generateKeyPair()
    val senderPublic = WebPushCrypto.encodePublicKey(sender.public as ECPublicKey)
    val secret = KeyAgreement.getInstance("ECDH").run {
      init(sender.private)
      doPhase(publicKey(to.publicKey), true)
      generateSecret()
    }
    val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }
    val prkKey = hmac(to.auth, secret)
    val ikm = hmac(prkKey, "WebPush: info".toByteArray() + byteArrayOf(0) + to.publicKey + senderPublic + byteArrayOf(1))
    val prk = hmac(salt, ikm)
    val cek = hmac(prk, "Content-Encoding: aes128gcm".toByteArray() + byteArrayOf(0, 1)).copyOf(16)
    val nonce = hmac(prk, "Content-Encoding: nonce".toByteArray() + byteArrayOf(0, 1)).copyOf(12)
    val padded = message + byteArrayOf(2) + ByteArray(recordPlaintext - message.size - 1)
    val ciphertext = Cipher.getInstance("AES/GCM/NoPadding").run {
      init(Cipher.ENCRYPT_MODE, SecretKeySpec(cek, "AES"), GCMParameterSpec(128, nonce))
      doFinal(padded)
    }
    return ByteBuffer.allocate(16 + 4 + 1 + 65 + ciphertext.size)
      .put(salt).putInt(4096).put(65.toByte()).put(senderPublic).put(ciphertext)
      .array()
  }

  private fun hmac(key: ByteArray, data: ByteArray) =
    Mac.getInstance("HmacSHA256").run {
      init(SecretKeySpec(key, "HmacSHA256"))
      doFinal(data)
    }
}
