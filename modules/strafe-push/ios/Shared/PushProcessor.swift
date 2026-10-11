import Foundation

/**
 A push as the gateway delivers it through APNs: `{"aps": {...}, "s": <slot>, "p": <aes128gcm
 body, base64url>}`. Alerts (`mutable-content`) reach the Notification Service Extension;
 silent ones (`content-available`: read sync, ringing stopped) reach the app delegate.
 */
struct EncryptedPush {
  static let slotKey = "s"
  static let bodyKey = "p"

  let slot: String
  let body: Data

  init?(userInfo: [AnyHashable: Any]) {
    guard let slot = userInfo[Self.slotKey] as? String, PushSlot.isValid(slot),
          let encoded = userInfo[Self.bodyKey] as? String, let body = Base64URL.decode(encoded) else {
      return nil
    }
    self.slot = slot
    self.body = body
  }
}

enum PushProcessor {
  enum Failure: Error, Equatable {
    case noKeys
    case keychain
    case decryption(WebPushDecryption.Failure)
    case malformedPayload
    /// The app hasn't stored a display config yet, so there is nothing to render with.
    case notConfigured
  }

  /// Decrypt, parse and decide. The keys are only read when the slot belongs to a signed-in account.
  static func process(
    _ push: EncryptedPush,
    config: PushDisplayConfig?,
    keyStore: PushKeyStore = PushKeyStore()
  ) -> Result<PushAction, Failure> {
    if let config, config.account(forSlot: push.slot) == nil {
      // Signed out on this device (its keys are gone with it); the instance just hasn't heard yet.
      return .success(.nothing)
    }
    let keys: PushKeyStore.Keys
    do {
      guard let stored = try keyStore.load(slot: push.slot) else { return .failure(.noKeys) }
      keys = stored
    } catch {
      return .failure(.keychain)
    }
    return decide(push, keys: keys, config: config)
  }

  static func decide(_ push: EncryptedPush, keys: PushKeyStore.Keys, config: PushDisplayConfig?) -> Result<PushAction, Failure> {
    let plaintext: Data
    do {
      plaintext = try WebPushDecryption.decrypt(push.body, privateKey: keys.privateKey, authSecret: keys.authSecret)
    } catch let failure as WebPushDecryption.Failure {
      return .failure(.decryption(failure))
    } catch {
      return .failure(.decryption(.authenticationFailed))
    }
    switch PushPayload.parse(plaintext) {
    case .unsupported:
      return .success(.nothing)
    case .malformed:
      return .failure(.malformedPayload)
    case .payload(let payload):
      guard let action = PushRenderer.action(for: payload, slot: push.slot, config: config) else {
        return .failure(.notConfigured)
      }
      return .success(action)
    }
  }
}
