import CryptoKit
import Foundation
@testable import StrafePushShared

/**
 The instance's side of RFC 8291, written out with plain HMACs rather than through
 WebPushDecryption's key schedule, so the round-trip tests check one against the other.
 */
enum WebPushTestSender {
  static let recordSize: UInt32 = 4096

  static func encrypt(
    _ plaintext: Data,
    to receiverPublicKey: P256.KeyAgreement.PublicKey,
    authSecret: Data,
    paddedLength: Int? = nil,
    delimiter: UInt8 = 0x02,
    salt: Data = WebPushTestSender.randomBytes(16),
    senderKey: P256.KeyAgreement.PrivateKey = P256.KeyAgreement.PrivateKey()
  ) throws -> Data {
    let ecdh = try senderKey.sharedSecretFromKeyAgreement(with: receiverPublicKey).withUnsafeBytes { Data($0) }
    let prkKey = hmac(key: authSecret, ecdh)
    var keyInfo = Data("WebPush: info".utf8) + Data([0])
    keyInfo += receiverPublicKey.x963Representation + senderKey.publicKey.x963Representation
    let ikm = hmac(key: prkKey, keyInfo + Data([1]))
    let prk = hmac(key: salt, ikm)
    let cek = hmac(key: prk, Data("Content-Encoding: aes128gcm".utf8) + Data([0, 1])).prefix(16)
    let nonce = hmac(key: prk, Data("Content-Encoding: nonce".utf8) + Data([0, 1])).prefix(12)

    var record = plaintext + Data([delimiter])
    if let paddedLength {
      record += Data(count: paddedLength - record.count)
    }
    let sealed = try AES.GCM.seal(record, using: SymmetricKey(data: cek), nonce: AES.GCM.Nonce(data: nonce))

    var body = salt
    body += withUnsafeBytes(of: recordSize.bigEndian) { Data($0) }
    body += Data([65])
    body += senderKey.publicKey.x963Representation
    body += sealed.ciphertext + sealed.tag
    return body
  }

  /// The smallest of the payload buckets (record plaintext incl. delimiter) that fits.
  static func bucket(for plaintext: Data) -> Int {
    return [256, 512, 1024, 2048].first { $0 >= plaintext.count + 1 } ?? plaintext.count + 1
  }

  static func randomBytes(_ count: Int) -> Data {
    return SymmetricKey(size: SymmetricKeySize(bitCount: count * 8)).withUnsafeBytes { Data($0) }
  }

  private static func hmac(key: Data, _ data: Data) -> Data {
    return Data(HMAC<SHA256>.authenticationCode(for: data, using: SymmetricKey(data: key)))
  }
}

enum Fixtures {
  static let strings = PushDisplayConfig.Strings(
    appName: "Strafe",
    newMessage: "New message",
    encryptedMessage: "Encrypted message",
    attachment: "Sent an attachment",
    spaceRoom: "#{{room}} · {{space}}",
    threadRoom: "{{thread}} · #{{room}}",
    incomingCall: "Incoming call",
    callFrom: "{{name}} is calling",
    callFromIn: "{{name}} is calling {{room}}",
    markRead: "Mark as read",
    reply: "Reply",
    answer: "Answer",
    decline: "Decline",
    testTitle: "Test notification",
    testBody: "Push notifications work.",
    channelMessages: "Messages",
    channelMessagesSilent: "Messages (silent)",
    channelCalls: "Calls"
  )

  static let alice = PushDisplayConfig.Account(slot: "acct1", userId: "100", label: "@alice", apiBase: "https://a.example/api")
  static let bob = PushDisplayConfig.Account(slot: "acct2", userId: "200", label: "@bob@b.example", apiBase: "https://b.example/api")

  static func config(
    accounts: [PushDisplayConfig.Account] = [alice],
    preview: Bool = true,
    sounds: Bool = true
  ) -> PushDisplayConfig {
    return PushDisplayConfig(strings: strings, accounts: accounts, activeSlot: accounts.first?.slot, preview: preview, sounds: sounds)
  }

  static func payload(_ json: String) -> PushPayload {
    guard case .payload(let payload) = PushPayload.parse(Data(json.utf8)) else {
      fatalError("fixture payload did not parse: \(json)")
    }
    return payload
  }
}
