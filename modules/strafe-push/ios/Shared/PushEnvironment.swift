import Foundation

/**
 Where the app and its Notification Service Extension meet: the App Group (display config) and
 the keychain access group (keys). The config plugin derives both from the bundle id and writes
 them into the Info.plist of both targets, so a rebranded build needs no code change.
 */
enum PushEnvironment {
  static let appGroupInfoKey = "StrafePushAppGroup"
  static let keychainGroupInfoKey = "StrafePushKeychainGroup"

  static var appGroup: String? { infoString(appGroupInfoKey) }
  static var keychainAccessGroup: String? { infoString(keychainGroupInfoKey) }

  private static func infoString(_ key: String) -> String? {
    guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
          !value.isEmpty, !value.contains("$(") else {
      return nil
    }
    return value
  }
}

/// A slot names one signed-in account's keys and endpoint; JS picks it.
enum PushSlot {
  static func isValid(_ slot: String) -> Bool {
    return (1...32).contains(slot.utf8.count) && slot.utf8.allSatisfy { byte in
      switch byte {
      case UInt8(ascii: "A")...UInt8(ascii: "Z"),
           UInt8(ascii: "a")...UInt8(ascii: "z"),
           UInt8(ascii: "0")...UInt8(ascii: "9"),
           UInt8(ascii: "_"), UInt8(ascii: "-"):
        return true
      default:
        return false
      }
    }
  }
}

/**
 Every Strafe notification carries a `threadIdentifier` of this shape; it groups a room's messages
 in Notification Center and is how read sync, clearRoom and clearAll find what to remove.
 */
enum PushThread {
  static let prefix = "strafe:"

  static func room(slot: String, roomId: String) -> String { "\(prefix)\(slot):room:\(roomId)" }
  static func call(slot: String, roomId: String) -> String { "\(prefix)\(slot):call:\(roomId)" }
  static func test(slot: String) -> String { "\(prefix)\(slot):test" }
  /// The gateway's generic alert, shown when a push couldn't be decrypted.
  static func undecrypted(slot: String) -> String { "\(prefix)\(slot):push" }

  /// Matches every thread of `slot`, or of every slot when nil.
  static func belongs(_ threadIdentifier: String, toSlot slot: String?) -> Bool {
    guard let slot else { return threadIdentifier.hasPrefix(prefix) }
    return threadIdentifier.hasPrefix("\(prefix)\(slot):")
  }

  /// A room conversation (what the badge counts), as opposed to a call or a test.
  static func isRoom(_ threadIdentifier: String) -> Bool {
    return threadIdentifier.hasPrefix(prefix) && threadIdentifier.contains(":room:")
  }
}
