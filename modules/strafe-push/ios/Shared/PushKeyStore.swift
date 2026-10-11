import CryptoKit
import Foundation
import os
import Security

/**
 The Web Push key pair and auth secret of each slot, in the Keychain.

 The items live in the keychain access group the config plugin gives both the app and the
 Notification Service Extension (`$(AppIdentifierPrefix)<bundle id>.push`), so the extension can
 decrypt a push while the app isn't running. They are readable after the first unlock since boot
 (pushes arrive while the phone is locked) and never leave this device: not in backups, not in
 iCloud Keychain. A restored or new phone simply generates new keys and the app re-subscribes.
 */
struct PushKeyStore {
  struct Keys {
    let privateKey: P256.KeyAgreement.PrivateKey
    /// 16 bytes.
    let authSecret: Data

    /// The 65-byte uncompressed point the instance encrypts to.
    var publicKey: Data { privateKey.publicKey.x963Representation }
  }

  enum Failure: Error {
    case keychain(OSStatus)
  }

  private static let service = "chat.strafe.push.keys"
  /// Item layout: version(1) || raw private scalar(32) || auth secret(16).
  private static let itemVersion: UInt8 = 1
  private static let itemLength = 1 + 32 + 16
  private static let log = os.Logger(subsystem: "chat.strafe.push", category: "keys")

  private let accessGroup: String?

  init(accessGroup: String? = PushEnvironment.keychainAccessGroup) {
    self.accessGroup = accessGroup
  }

  /// The slot's keys, or nil when it has none (or the device hasn't been unlocked since boot).
  func load(slot: String) throws -> Keys? {
    var query = baseQuery(slot: slot)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = withAccessGroupFallback(&query) { SecItemCopyMatching($0 as CFDictionary, &result) }
    switch status {
    case errSecSuccess:
      guard let data = result as? Data, let keys = Self.decode(data) else {
        // Unreadable leftovers of some other layout: drop them so ensure() starts over.
        try delete(slot: slot)
        return nil
      }
      return keys
    case errSecItemNotFound:
      return nil
    default:
      throw Failure.keychain(status)
    }
  }

  /// The slot's keys, generated and stored on first use.
  func ensure(slot: String) throws -> Keys {
    if let existing = try load(slot: slot) {
      return existing
    }
    let keys = Keys(
      privateKey: P256.KeyAgreement.PrivateKey(),
      authSecret: SymmetricKey(size: SymmetricKeySize(bitCount: 128)).withUnsafeBytes { Data($0) }
    )
    var query = baseQuery(slot: slot)
    query[kSecValueData as String] = Self.encode(keys)
    query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    let status = withAccessGroupFallback(&query) { SecItemAdd($0 as CFDictionary, nil) }
    switch status {
    case errSecSuccess:
      return keys
    case errSecDuplicateItem:
      // Another caller won the race; theirs are the keys the instance will be told about.
      if let existing = try load(slot: slot) {
        return existing
      }
      throw Failure.keychain(status)
    default:
      throw Failure.keychain(status)
    }
  }

  func delete(slot: String) throws {
    var query = baseQuery(slot: slot)
    let status = withAccessGroupFallback(&query) { SecItemDelete($0 as CFDictionary) }
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw Failure.keychain(status)
    }
  }

  private func baseQuery(slot: String) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: Self.service,
      kSecAttrAccount as String: slot,
      kSecAttrSynchronizable as String: false,
    ]
    if let accessGroup {
      query[kSecAttrAccessGroup as String] = accessGroup
    }
    return query
  }

  /**
   Runs a Keychain call in the shared access group, and once more in the app's own group when the
   build isn't entitled to the shared one (an unsigned simulator build has no team prefix to put
   in front of it). Keys stored that way still work for the app, but the extension can't read
   them and shows the gateway's generic text, so it is logged.
   */
  private func withAccessGroupFallback(_ query: inout [String: Any], _ call: ([String: Any]) -> OSStatus) -> OSStatus {
    let status = call(query)
    guard status == errSecMissingEntitlement, query[kSecAttrAccessGroup as String] != nil else {
      return status
    }
    Self.log.error("not entitled to keychain group \(accessGroup ?? "", privacy: .public); using the app's own")
    query.removeValue(forKey: kSecAttrAccessGroup as String)
    return call(query)
  }

  private static func encode(_ keys: Keys) -> Data {
    var data = Data([itemVersion])
    data.append(keys.privateKey.rawRepresentation)
    data.append(keys.authSecret)
    return data
  }

  private static func decode(_ data: Data) -> Keys? {
    let bytes = [UInt8](data)
    guard bytes.count == itemLength, bytes[0] == itemVersion,
          let privateKey = try? P256.KeyAgreement.PrivateKey(rawRepresentation: Data(bytes[1..<33])) else {
      return nil
    }
    return Keys(privateKey: privateKey, authSecret: Data(bytes[33..<itemLength]))
  }
}
