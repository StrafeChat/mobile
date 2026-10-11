import ExpoModulesCore
import Security
import UserNotifications

/**
 The iOS half of `modules/strafe-push/index.ts`.

 iOS has one transport, APNs: JS gets the device token from expo-notifications and registers it
 with the push gateway; the instance encrypts each push to the slot's keys kept here, and the
 Notification Service Extension (plugins/withStrafePushIos.js) decrypts and renders it. FCM and
 UnifiedPush are Android's, so their functions answer null / do nothing, as index.ts documents.
 */
public final class StrafePushModule: Module {
  public func definition() -> ModuleDefinition {
    Name("StrafePush")

    // Android's transport events; declared so addListener behaves the same on both platforms.
    Events("fcmToken", "unifiedPushEndpoint", "unifiedPushUnregistered", "unifiedPushFailed")

    AsyncFunction("getCapabilities") { () -> [String: Any] in
      return [
        "fcm": false,
        "apns": true,
        "unifiedPush": false,
        "distributors": [[String: String]](),
        "selectedDistributor": NSNull(),
      ]
    }

    AsyncFunction("ensureKeys") { (slot: String) -> [String: String] in
      let keys = try Self.keychain { try PushKeyStore().ensure(slot: try Self.validSlot(slot)) }
      return [
        "p256dh": Base64URL.encode(keys.publicKey),
        "auth": Base64URL.encode(keys.authSecret),
      ]
    }

    AsyncFunction("deleteKeys") { (slot: String) in
      try Self.keychain { try PushKeyStore().delete(slot: try Self.validSlot(slot)) }
    }

    AsyncFunction("getFcmToken") { () -> String? in
      return nil
    }

    AsyncFunction("releaseFcm") {
      // Android only.
    }

    AsyncFunction("getApnsEnvironment") { () -> String in
      return ProvisioningProfile.currentApnsEnvironment().rawValue
    }

    AsyncFunction("registerUnifiedPush") { (_: String, _: String?) in
      // Android only.
    }

    AsyncFunction("unregisterUnifiedPush") { (_: String) in
      // Android only.
    }

    AsyncFunction("getUnifiedPushEndpoint") { (_: String) -> [String: String]? in
      return nil
    }

    AsyncFunction("setDisplayConfig") { (record: DisplayConfigRecord) in
      try PushDisplayConfigStore.save(try record.toDisplayConfig())
    }

    AsyncFunction("clearRoom") { (slot: String, roomId: String) in
      let thread = PushThread.room(slot: try Self.validSlot(slot), roomId: roomId)
      // The badge is left alone: the app calling this is running and keeps the exact count.
      await Self.removeDelivered { $0 == thread }
    }

    AsyncFunction("clearAll") { (slot: String?) in
      let scope = try slot.map { try Self.validSlot($0) }
      await Self.removeDelivered { PushThread.belongs($0, toSlot: scope) }
    }
  }

  private static func validSlot(_ slot: String) throws -> String {
    guard PushSlot.isValid(slot) else {
      throw InvalidSlotException(slot)
    }
    return slot
  }

  private static func keychain<T>(_ operation: () throws -> T) throws -> T {
    do {
      return try operation()
    } catch PushKeyStore.Failure.keychain(let status) {
      throw PushKeychainException(status)
    }
  }

  private static func removeDelivered(matching shouldRemove: @escaping (String) -> Bool) async {
    await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
      DeliveredPushNotifications.remove(matching: shouldRemove) { _, _ in
        continuation.resume()
      }
    }
  }
}

internal struct DisplayAccountRecord: Record {
  @Field var slot: String = ""
  @Field var userId: String = ""
  @Field var label: String = ""
  @Field var apiBase: String = ""
  // `token` is Android's (native mark-as-read / decline); iOS never reads or stores it.
}

internal struct DisplayConfigRecord: Record {
  @Field var strings: [String: String] = [:]
  @Field var accounts: [DisplayAccountRecord] = []
  @Field var activeSlot: String? = nil
  @Field var preview: Bool = true
  @Field var sounds: Bool = true

  func toDisplayConfig() throws -> PushDisplayConfig {
    let strings: PushDisplayConfig.Strings
    do {
      strings = try PushDisplayConfig.Strings(dictionary: self.strings)
    } catch {
      throw InvalidDisplayConfigException("strings: \(error.localizedDescription)")
    }
    let accounts = try self.accounts.map { account -> PushDisplayConfig.Account in
      guard PushSlot.isValid(account.slot), !account.userId.isEmpty else {
        throw InvalidDisplayConfigException("account slot \(account.slot)")
      }
      return PushDisplayConfig.Account(
        slot: account.slot,
        userId: account.userId,
        label: account.label,
        apiBase: account.apiBase
      )
    }
    return PushDisplayConfig(
      strings: strings,
      accounts: accounts,
      activeSlot: activeSlot,
      preview: preview,
      sounds: sounds
    )
  }
}

internal final class InvalidSlotException: GenericException<String> {
  override var reason: String {
    "Invalid push slot '\(param)': expected 1-32 characters of [A-Za-z0-9_-]"
  }
}

internal final class InvalidDisplayConfigException: GenericException<String> {
  override var reason: String {
    "Invalid push display config: \(param)"
  }
}

internal final class PushKeychainException: GenericException<OSStatus> {
  override var reason: String {
    let message = SecCopyErrorMessageString(param, nil) as String? ?? "unknown error"
    return "Keychain error \(param): \(message)"
  }
}
