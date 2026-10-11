import CryptoKit
import XCTest
@testable import StrafePushShared

final class WebPushDecryptionTests: XCTestCase {
  // RFC 8291 Appendix A.
  private let receiverPrivate = "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"
  private let receiverPublic = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
  private let senderPublic = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
  private let authSecret = "BTBZMqHH6r4Tts7J_aSIgg"
  private let salt = "DGv6ra1nlYgDCS1FRnbzlw"
  private let body = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"

  private func rfcReceiver() throws -> P256.KeyAgreement.PrivateKey {
    return try P256.KeyAgreement.PrivateKey(rawRepresentation: XCTUnwrap(Base64URL.decode(receiverPrivate)))
  }

  func testRFC8291AppendixA() throws {
    let receiver = try rfcReceiver()
    XCTAssertEqual(Base64URL.encode(receiver.publicKey.x963Representation), receiverPublic)

    let plaintext = try WebPushDecryption.decrypt(
      XCTUnwrap(Base64URL.decode(body)),
      privateKey: receiver,
      authSecret: XCTUnwrap(Base64URL.decode(authSecret))
    )
    XCTAssertEqual(String(decoding: plaintext, as: UTF8.self), "When I grow up, I want to be a watermelon")
  }

  func testRFC8291KeySchedule() throws {
    let (key, nonce) = try WebPushDecryption.deriveKeyAndNonce(
      privateKey: rfcReceiver(),
      senderKey: P256.KeyAgreement.PublicKey(x963Representation: XCTUnwrap(Base64URL.decode(senderPublic))),
      authSecret: XCTUnwrap(Base64URL.decode(authSecret)),
      salt: XCTUnwrap(Base64URL.decode(salt))
    )
    XCTAssertEqual(key.withUnsafeBytes { Base64URL.encode(Data($0)) }, "oIhVW04MRdy2XN9CiKLxTg")
    XCTAssertEqual(Base64URL.encode(nonce), "4h_95klXJ5E_qnoN")
  }

  func testRoundTripThroughEveryPaddingBucket() throws {
    let receiver = P256.KeyAgreement.PrivateKey()
    let auth = WebPushTestSender.randomBytes(16)
    for length in [0, 1, 200, 255, 256, 700, 1500, 2047] {
      let plaintext = WebPushTestSender.randomBytes(max(length, 1)).prefix(length)
      let padded = WebPushTestSender.bucket(for: plaintext)
      let body = try WebPushTestSender.encrypt(Data(plaintext), to: receiver.publicKey, authSecret: auth, paddedLength: padded)
      XCTAssertEqual(body.count, 21 + 65 + padded + 16)
      let decrypted = try WebPushDecryption.decrypt(body, privateKey: receiver, authSecret: auth)
      XCTAssertEqual(decrypted, Data(plaintext), "length \(length)")
    }
  }

  func testRejectsTamperedBody() throws {
    let receiver = P256.KeyAgreement.PrivateKey()
    let auth = WebPushTestSender.randomBytes(16)
    var body = try WebPushTestSender.encrypt(Data("hello".utf8), to: receiver.publicKey, authSecret: auth, paddedLength: 256)
    body[body.count - 20] ^= 0x01
    XCTAssertThrowsError(try WebPushDecryption.decrypt(body, privateKey: receiver, authSecret: auth)) {
      XCTAssertEqual($0 as? WebPushDecryption.Failure, .authenticationFailed)
    }
  }

  func testRejectsWrongAuthSecretAndWrongKey() throws {
    let receiver = P256.KeyAgreement.PrivateKey()
    let auth = WebPushTestSender.randomBytes(16)
    let body = try WebPushTestSender.encrypt(Data("hello".utf8), to: receiver.publicKey, authSecret: auth)
    XCTAssertThrowsError(try WebPushDecryption.decrypt(body, privateKey: receiver, authSecret: WebPushTestSender.randomBytes(16))) {
      XCTAssertEqual($0 as? WebPushDecryption.Failure, .authenticationFailed)
    }
    XCTAssertThrowsError(try WebPushDecryption.decrypt(body, privateKey: P256.KeyAgreement.PrivateKey(), authSecret: auth)) {
      XCTAssertEqual($0 as? WebPushDecryption.Failure, .authenticationFailed)
    }
  }

  func testRejectsMalformedHeaders() throws {
    let receiver = P256.KeyAgreement.PrivateKey()
    let auth = WebPushTestSender.randomBytes(16)
    let body = try WebPushTestSender.encrypt(Data("hello".utf8), to: receiver.publicKey, authSecret: auth)

    XCTAssertThrowsError(try WebPushDecryption.decrypt(body.prefix(40), privateKey: receiver, authSecret: auth)) {
      XCTAssertEqual($0 as? WebPushDecryption.Failure, .truncated)
    }

    var shortKeyId = body
    shortKeyId[20] = 64
    XCTAssertThrowsError(try WebPushDecryption.decrypt(shortKeyId, privateKey: receiver, authSecret: auth)) {
      XCTAssertEqual($0 as? WebPushDecryption.Failure, .unsupportedKeyId)
    }

    // rs smaller than the record: a second record would follow, which Web Push never sends.
    var tinyRecordSize = body
    tinyRecordSize.replaceSubrange(16..<20, with: [0, 0, 0, 18])
    XCTAssertThrowsError(try WebPushDecryption.decrypt(tinyRecordSize, privateKey: receiver, authSecret: auth)) {
      XCTAssertEqual($0 as? WebPushDecryption.Failure, .invalidRecordSize)
    }

    var badSenderKey = body
    badSenderKey[22] ^= 0xFF
    XCTAssertThrowsError(try WebPushDecryption.decrypt(badSenderKey, privateKey: receiver, authSecret: auth)) {
      XCTAssertEqual($0 as? WebPushDecryption.Failure, .invalidSenderKey)
    }
  }

  func testRejectsANonFinalRecordDelimiter() throws {
    let receiver = P256.KeyAgreement.PrivateKey()
    let auth = WebPushTestSender.randomBytes(16)
    let body = try WebPushTestSender.encrypt(Data("hello".utf8), to: receiver.publicKey, authSecret: auth, paddedLength: 256, delimiter: 0x01)
    XCTAssertThrowsError(try WebPushDecryption.decrypt(body, privateKey: receiver, authSecret: auth)) {
      XCTAssertEqual($0 as? WebPushDecryption.Failure, .invalidPadding)
    }
  }

  func testBase64URL() {
    let data = Data([0xFB, 0xFF, 0x3E, 0x00, 0x01])
    XCTAssertEqual(Base64URL.encode(data), "-_8-AAE")
    XCTAssertEqual(Base64URL.decode("-_8-AAE"), data)
    XCTAssertEqual(Base64URL.decode("-_8-AAE="), data)
    XCTAssertEqual(Base64URL.decode(""), Data())
    XCTAssertNil(Base64URL.decode("abcde"))
    XCTAssertNil(Base64URL.decode("ab!d"))
  }
}
