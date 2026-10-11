import CryptoKit
import XCTest
@testable import StrafePushShared

final class PushProcessorTests: XCTestCase {
  private let keys = PushKeyStore.Keys(privateKey: P256.KeyAgreement.PrivateKey(), authSecret: WebPushTestSender.randomBytes(16))

  /// What the gateway hands APNs: the slot and the instance's ciphertext, base64url.
  private func userInfo(_ json: String, slot: String = "acct1") throws -> [AnyHashable: Any] {
    let plaintext = Data(json.utf8)
    let body = try WebPushTestSender.encrypt(
      plaintext,
      to: keys.privateKey.publicKey,
      authSecret: keys.authSecret,
      paddedLength: WebPushTestSender.bucket(for: plaintext)
    )
    return ["aps": ["mutable-content": 1], "s": slot, "p": Base64URL.encode(body)]
  }

  func testDecryptsAndRendersAPush() throws {
    let push = try XCTUnwrap(EncryptedPush(userInfo: userInfo(
      #"{"v":1,"t":"msg","uid":"100","rid":"5","rt":3,"sid":"8","mid":"9","a":{"id":"7","n":"Alice"},"rn":"general","sn":"HQ","b":"hello"}"#
    )))
    guard case .success(.show(let notification)) = PushProcessor.decide(push, keys: keys, config: Fixtures.config()) else {
      return XCTFail("expected a notification")
    }
    XCTAssertEqual(notification.title, "#general · HQ")
    XCTAssertEqual(notification.body, "hello")
  }

  func testReadSyncDecidesARemoval() throws {
    let push = try XCTUnwrap(EncryptedPush(userInfo: userInfo(#"{"v":1,"t":"read","uid":"100","rid":"5","rt":1,"mid":"9"}"#)))
    XCTAssertEqual(try PushProcessor.decide(push, keys: keys, config: nil).get(), .remove(threadIdentifier: "strafe:acct1:room:5"))
  }

  func testFailuresFallBackToTheGatewayText() throws {
    let message = #"{"v":1,"t":"msg","uid":"100","rid":"5","rt":1,"mid":"9","a":{"id":"7","n":"Alice"}}"#
    let push = try XCTUnwrap(EncryptedPush(userInfo: userInfo(message)))

    let otherKeys = PushKeyStore.Keys(privateKey: P256.KeyAgreement.PrivateKey(), authSecret: keys.authSecret)
    XCTAssertEqual(PushProcessor.decide(push, keys: otherKeys, config: Fixtures.config()), .failure(.decryption(.authenticationFailed)))
    XCTAssertEqual(PushProcessor.decide(push, keys: keys, config: nil), .failure(.notConfigured))

    let garbage = try XCTUnwrap(EncryptedPush(userInfo: userInfo("{]")))
    XCTAssertEqual(PushProcessor.decide(garbage, keys: keys, config: Fixtures.config()), .failure(.malformedPayload))
  }

  func testUnknownEventTypesAreDropped() throws {
    let push = try XCTUnwrap(EncryptedPush(userInfo: userInfo(#"{"v":1,"t":"typing","uid":"100"}"#)))
    XCTAssertEqual(PushProcessor.decide(push, keys: keys, config: Fixtures.config()), .success(.nothing))
  }

  func testSignedOutSlotNeedsNoKeys() throws {
    let push = try XCTUnwrap(EncryptedPush(userInfo: userInfo(#"{"v":1,"t":"test","uid":"100"}"#, slot: "gone")))
    // A config without that slot answers before the keychain is touched.
    XCTAssertEqual(PushProcessor.process(push, config: Fixtures.config()), .success(.nothing))
  }

  func testRejectsForeignUserInfo() {
    XCTAssertNil(EncryptedPush(userInfo: ["aps": ["alert": "hi"]]))
    XCTAssertNil(EncryptedPush(userInfo: ["s": "bad slot!", "p": "AAAA"]))
    XCTAssertNil(EncryptedPush(userInfo: ["s": "acct1", "p": "not*base64"]))
  }
}

final class PushDisplayConfigTests: XCTestCase {
  func testStringsFromJSRequireEveryKey() throws {
    let encoded = try JSONEncoder().encode(Fixtures.strings)
    var dictionary = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: String])
    XCTAssertEqual(try PushDisplayConfig.Strings(dictionary: dictionary), Fixtures.strings)
    dictionary.removeValue(forKey: "callFromIn")
    XCTAssertThrowsError(try PushDisplayConfig.Strings(dictionary: dictionary))
  }

  func testStoreRoundTrip() throws {
    let suite = "chat.strafe.push.tests.\(UUID().uuidString)"
    defer { UserDefaults.standard.removePersistentDomain(forName: suite) }
    XCTAssertNil(PushDisplayConfigStore.load(suiteName: suite))
    let config = Fixtures.config(accounts: [Fixtures.alice, Fixtures.bob], preview: false, sounds: true)
    try PushDisplayConfigStore.save(config, suiteName: suite)
    XCTAssertEqual(PushDisplayConfigStore.load(suiteName: suite), config)
  }
}

final class ProvisioningProfileTests: XCTestCase {
  /// A profile as Apple ships it: the XML plist sits inside a DER-encoded CMS envelope.
  private func profile(apsEnvironment: String?) -> Data {
    let entitlements = apsEnvironment.map { "<key>aps-environment</key><string>\($0)</string>" } ?? ""
    let plist = """
    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0"><dict><key>Name</key><string>Strafe Dev</string>
    <key>Entitlements</key><dict>\(entitlements)<key>application-identifier</key><string>T.chat.strafe.mobile</string></dict>
    </dict></plist>
    """
    return Data([0x30, 0x82, 0x0F, 0x00, 0x06, 0x09, 0x2A, 0x86]) + Data(plist.utf8) + Data([0xA0, 0x82, 0x00, 0x10, 0xFF])
  }

  func testReadsTheApsEnvironment() {
    XCTAssertEqual(ProvisioningProfile.apnsEnvironment(fromProfile: profile(apsEnvironment: "development")), .sandbox)
    XCTAssertEqual(ProvisioningProfile.apnsEnvironment(fromProfile: profile(apsEnvironment: "production")), .production)
    XCTAssertNil(ProvisioningProfile.apnsEnvironment(fromProfile: profile(apsEnvironment: nil)))
    XCTAssertNil(ProvisioningProfile.apnsEnvironment(fromProfile: Data([0x30, 0x82, 0x00])))
  }
}
