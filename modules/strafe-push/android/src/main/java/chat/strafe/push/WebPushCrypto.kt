package chat.strafe.push

import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.GeneralSecurityException
import java.security.KeyFactory
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.interfaces.ECPrivateKey
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyAgreement
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** A push body that is not a well-formed aes128gcm message for our keys. */
class WebPushException(message: String, cause: Throwable? = null) : GeneralSecurityException(message, cause)

/** The receiver's half of a Web Push subscription. */
class WebPushKeys(
  val privateKey: ECPrivateKey,
  /** 65-byte uncompressed P-256 point. */
  val publicKey: ByteArray,
  /** 16-byte auth secret. */
  val auth: ByteArray,
)

/**
 * Web Push message encryption, receiver side (RFC 8291 over the RFC 8188 aes128gcm content
 * coding), on plain JCA so it runs (and is tested) on the JVM as well as on Android.
 *
 * The instance encrypts each push to the subscription's P-256 key and auth secret, which
 * only this device holds; the push gateway, Google and UnifiedPush distributors relay bytes
 * they cannot read.
 */
object WebPushCrypto {
  private const val SALT_LENGTH = 16
  private const val KEY_LENGTH = 65
  private const val HEADER_FIXED = SALT_LENGTH + 4 + 1
  private const val TAG_LENGTH = 16
  private const val PAD_DELIMITER_LAST: Byte = 0x02

  // P-256 (secp256r1) curve constants, for checking a sender key is really on the curve
  // before it goes anywhere near ECDH (invalid-curve attacks), whatever the provider does.
  private val P = BigInteger("ffffffff00000001000000000000000000000000ffffffffffffffffffffffff", 16)
  private val A = P.subtract(BigInteger.valueOf(3))
  private val B = BigInteger("5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b", 16)
  // BigInteger.TWO is API 33+ on Android.
  private val TWO = BigInteger.valueOf(2)
  private val THREE = BigInteger.valueOf(3)
  private val ZERO_ONE = byteArrayOf(0x00, 0x01)

  /** A fresh P-256 key pair for a new subscription. */
  fun generateKeyPair(): KeyPair {
    val generator = KeyPairGenerator.getInstance("EC")
    generator.initialize(ECGenParameterSpec("secp256r1"))
    return generator.generateKeyPair()
  }

  /** The uncompressed (0x04 || X || Y) encoding Web Push uses for `p256dh` and `keyid`. */
  fun encodePublicKey(key: ECPublicKey): ByteArray {
    val out = ByteArray(KEY_LENGTH)
    out[0] = 0x04
    unsigned32(key.w.affineX).copyInto(out, 1)
    unsigned32(key.w.affineY).copyInto(out, 33)
    return out
  }

  /**
   * Decrypts an aes128gcm push body (a single record, as RFC 8291 requires) and strips its
   * padding. Throws [WebPushException] for anything malformed or not encrypted to [keys].
   */
  fun decrypt(body: ByteArray, keys: WebPushKeys): ByteArray {
    if (body.size < HEADER_FIXED) throw WebPushException("body shorter than the aes128gcm header")
    val buffer = ByteBuffer.wrap(body)
    val salt = ByteArray(SALT_LENGTH).also { buffer.get(it) }
    val recordSize = buffer.int.toLong() and 0xffffffffL
    val idLength = buffer.get().toInt() and 0xff
    if (idLength != KEY_LENGTH) throw WebPushException("keyid is not a P-256 public key")
    if (body.size < HEADER_FIXED + idLength + TAG_LENGTH + 1) throw WebPushException("no ciphertext")
    val senderKey = ByteArray(idLength).also { buffer.get(it) }
    val ciphertext = ByteArray(buffer.remaining()).also { buffer.get(it) }
    if (recordSize < TAG_LENGTH + 2) throw WebPushException("record size too small")
    if (ciphertext.size > recordSize) throw WebPushException("more than one record")

    val sender = decodePublicKey(senderKey, keys)
    val ecdhSecret = KeyAgreement.getInstance("ECDH").run {
      init(keys.privateKey)
      doPhase(sender, true)
      generateSecret()
    }

    // RFC 8291 section 3.3: combine the ECDH secret with the auth secret...
    val prkKey = hmac(keys.auth, ecdhSecret)
    val keyInfo = "WebPush: info".toByteArray(Charsets.US_ASCII) + byteArrayOf(0x00) + keys.publicKey + senderKey
    val ikm = hmac(prkKey, keyInfo + byteArrayOf(0x01))
    // ...then RFC 8188 section 2.2/2.3 with that as the input keying material.
    val prk = hmac(salt, ikm)
    val cek = hmac(prk, "Content-Encoding: aes128gcm".toByteArray(Charsets.US_ASCII) + ZERO_ONE).copyOf(16)
    val nonce = hmac(prk, "Content-Encoding: nonce".toByteArray(Charsets.US_ASCII) + ZERO_ONE).copyOf(12)

    val padded = try {
      Cipher.getInstance("AES/GCM/NoPadding").run {
        init(Cipher.DECRYPT_MODE, SecretKeySpec(cek, "AES"), GCMParameterSpec(TAG_LENGTH * 8, nonce))
        doFinal(ciphertext)
      }
    } catch (e: GeneralSecurityException) {
      throw WebPushException("authentication failed", e)
    }
    return unpad(padded)
  }

  /** Removes RFC 8188 padding: the data ends at the last non-zero octet, which must be 0x02. */
  fun unpad(padded: ByteArray): ByteArray {
    var end = padded.size - 1
    while (end >= 0 && padded[end] == 0.toByte()) end--
    if (end < 0 || padded[end] != PAD_DELIMITER_LAST) throw WebPushException("bad padding")
    return padded.copyOf(end)
  }

  fun base64UrlDecode(value: String): ByteArray =
    try {
      Base64.getUrlDecoder().decode(value.trim().trimEnd('='))
    } catch (e: IllegalArgumentException) {
      throw WebPushException("not base64url", e)
    }

  fun base64UrlEncode(value: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(value)

  private fun decodePublicKey(encoded: ByteArray, keys: WebPushKeys): ECPublicKey {
    if (encoded[0] != 0x04.toByte()) throw WebPushException("keyid is not an uncompressed point")
    val x = BigInteger(1, encoded.copyOfRange(1, 33))
    val y = BigInteger(1, encoded.copyOfRange(33, 65))
    if (x >= P || y >= P) throw WebPushException("sender key out of range")
    val lhs = y.modPow(TWO, P)
    val rhs = x.modPow(THREE, P).add(A.multiply(x)).add(B).mod(P)
    if (lhs != rhs) throw WebPushException("sender key is not on P-256")
    return try {
      KeyFactory.getInstance("EC").generatePublic(ECPublicKeySpec(ECPoint(x, y), keys.privateKey.params)) as ECPublicKey
    } catch (e: GeneralSecurityException) {
      throw WebPushException("sender key rejected", e)
    }
  }

  private fun hmac(key: ByteArray, data: ByteArray): ByteArray =
    Mac.getInstance("HmacSHA256").run {
      init(SecretKeySpec(key, "HmacSHA256"))
      doFinal(data)
    }

  /** A coordinate as exactly 32 big-endian bytes (BigInteger adds a sign byte or drops zeros). */
  private fun unsigned32(value: BigInteger): ByteArray {
    val raw = value.toByteArray()
    return when {
      raw.size == 32 -> raw
      raw.size > 32 -> raw.copyOfRange(raw.size - 32, raw.size)
      else -> ByteArray(32 - raw.size) + raw
    }
  }
}
