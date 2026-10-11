import CryptoKit
import Foundation

/**
 RFC 8291 (Message Encryption for Web Push), receiver side: the `aes128gcm` content coding of
 RFC 8188 with a key agreed between the sender's one-time P-256 key (carried in the header's
 `keyid`) and this device's subscription key, mixed with the subscription's auth secret.

 The instance encrypts every push to the slot's key pair, so the gateway, Apple and anyone else
 in the middle only ever see this ciphertext. Compiled into both the StrafePush module and the
 Notification Service Extension (one source, two targets).
 */
enum WebPushDecryption {
  enum Failure: Error, Equatable {
    case truncated
    case unsupportedKeyId
    case invalidRecordSize
    case invalidSenderKey
    case authenticationFailed
    case invalidPadding
  }

  /// salt(16) || rs(4, big endian) || idlen(1), then keyid(idlen).
  private static let headerLength = 21
  private static let senderKeyLength = 65
  private static let tagLength = 16

  static func decrypt(_ body: Data, privateKey: P256.KeyAgreement.PrivateKey, authSecret: Data) throws -> Data {
    let bytes = [UInt8](body)
    guard bytes.count >= headerLength else { throw Failure.truncated }
    let salt = Data(bytes[0..<16])
    let recordSize = bytes[16..<20].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    // Web Push always puts the sender's uncompressed public key in keyid (RFC 8291 §4).
    guard Int(bytes[20]) == senderKeyLength else { throw Failure.unsupportedKeyId }
    let ciphertextStart = headerLength + senderKeyLength
    // At least the padding delimiter and the tag.
    guard bytes.count >= ciphertextStart + 1 + tagLength else { throw Failure.truncated }
    let ciphertext = Data(bytes[ciphertextStart...])
    // Web Push sends exactly one record; a body longer than rs would be a second one.
    guard recordSize >= 18, ciphertext.count <= Int(recordSize) else { throw Failure.invalidRecordSize }

    let senderKey: P256.KeyAgreement.PublicKey
    do {
      senderKey = try P256.KeyAgreement.PublicKey(x963Representation: Data(bytes[headerLength..<ciphertextStart]))
    } catch {
      throw Failure.invalidSenderKey
    }
    let (key, nonce) = try deriveKeyAndNonce(
      privateKey: privateKey,
      senderKey: senderKey,
      authSecret: authSecret,
      salt: salt
    )

    let padded: Data
    do {
      let box = try AES.GCM.SealedBox(
        nonce: AES.GCM.Nonce(data: nonce),
        ciphertext: ciphertext.prefix(ciphertext.count - tagLength),
        tag: ciphertext.suffix(tagLength)
      )
      padded = try AES.GCM.open(box, using: key)
    } catch {
      throw Failure.authenticationFailed
    }
    return try unpad(padded)
  }

  /**
   RFC 8291 §3.3-3.4. The first HKDF (salt = auth secret, info = "WebPush: info" || 0 || ua_public ||
   as_public) gives the IKM; RFC 8188's HKDF over that (salt = the record salt) gives the content
   encryption key and the nonce.
   */
  static func deriveKeyAndNonce(
    privateKey: P256.KeyAgreement.PrivateKey,
    senderKey: P256.KeyAgreement.PublicKey,
    authSecret: Data,
    salt: Data
  ) throws -> (key: SymmetricKey, nonce: Data) {
    let sharedSecret = try privateKey.sharedSecretFromKeyAgreement(with: senderKey)
    var keyInfo = Data("WebPush: info".utf8)
    keyInfo.append(0)
    keyInfo.append(privateKey.publicKey.x963Representation)
    keyInfo.append(senderKey.x963Representation)
    let ikm = sharedSecret.hkdfDerivedSymmetricKey(
      using: SHA256.self,
      salt: authSecret,
      sharedInfo: keyInfo,
      outputByteCount: 32
    )
    let key = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: ikm,
      salt: salt,
      info: Data("Content-Encoding: aes128gcm\u{0}".utf8),
      outputByteCount: 16
    )
    let nonce = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: ikm,
      salt: salt,
      info: Data("Content-Encoding: nonce\u{0}".utf8),
      outputByteCount: 12
    )
    return (key, nonce.withUnsafeBytes { Data($0) })
  }

  /// RFC 8188 §2: the plaintext is followed by a delimiter (2 for the last record) and zeros.
  static func unpad(_ padded: Data) throws -> Data {
    guard let delimiter = padded.lastIndex(where: { $0 != 0 }), padded[delimiter] == 0x02 else {
      throw Failure.invalidPadding
    }
    return Data(padded[padded.startIndex..<delimiter])
  }
}

/// base64url without padding (RFC 4648 §5), the encoding of every key and body on the push wire.
enum Base64URL {
  static func encode(_ data: Data) -> String {
    return data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  static func decode(_ string: String) -> Data? {
    var base64 = string
      .replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
      .trimmingCharacters(in: CharacterSet(charactersIn: "="))
    switch base64.count % 4 {
    case 1: return nil
    case 2: base64 += "=="
    case 3: base64 += "="
    default: break
    }
    return Data(base64Encoded: base64)
  }
}
