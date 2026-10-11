import Foundation

/**
 What the running app tells the native renderer (`setDisplayConfig`): the localized strings, the
 signed-in accounts and the user's display preferences. Persisted in the App Group's
 UserDefaults so the Notification Service Extension renders pushes the way the app would,
 in the user's language, while the app isn't running.

 Session tokens are deliberately not part of it on iOS: actions on a notification (mark as read,
 decline) open the app and go through JS.
 */
struct PushDisplayConfig: Codable, Equatable {
  struct Strings: Codable, Equatable {
    var appName: String
    var newMessage: String
    var encryptedMessage: String
    var attachment: String
    /// `#{{room}} · {{space}}`
    var spaceRoom: String
    /// `{{thread}} · #{{room}}`
    var threadRoom: String
    var incomingCall: String
    /// `{{name}} is calling`
    var callFrom: String
    /// `{{name}} is calling {{room}}`
    var callFromIn: String
    var markRead: String
    var reply: String
    var answer: String
    var decline: String
    var testTitle: String
    var testBody: String
    var channelMessages: String
    var channelMessagesSilent: String
    var channelCalls: String
  }

  struct Account: Codable, Equatable {
    var slot: String
    var userId: String
    /// e.g. `@alice@example.org`, shown when more than one account is signed in.
    var label: String
    var apiBase: String
  }

  var strings: Strings
  var accounts: [Account]
  /// The account the running app is signed in as.
  var activeSlot: String?
  /// Show message text when the push carries it.
  var preview: Bool
  /// Play the notification sound for messages.
  var sounds: Bool

  func account(forSlot slot: String) -> Account? {
    return accounts.first { $0.slot == slot }
  }
}

extension PushDisplayConfig.Strings {
  /// From the `strings` object JS passes; every key is required.
  init(dictionary: [String: String]) throws {
    let data = try JSONSerialization.data(withJSONObject: dictionary)
    self = try JSONDecoder().decode(Self.self, from: data)
  }
}

enum PushDisplayConfigStore {
  private static let defaultsKey = "strafe.push.displayConfig"

  /// The App Group's defaults; the app's own when the build has no App Group (the extension then
  /// can't see the config and shows the gateway's generic text).
  private static func defaults(_ suiteName: String?) -> UserDefaults {
    return suiteName.flatMap { UserDefaults(suiteName: $0) } ?? .standard
  }

  static func load(suiteName: String? = PushEnvironment.appGroup) -> PushDisplayConfig? {
    guard let data = defaults(suiteName).data(forKey: defaultsKey) else { return nil }
    return try? JSONDecoder().decode(PushDisplayConfig.self, from: data)
  }

  static func save(_ config: PushDisplayConfig, suiteName: String? = PushEnvironment.appGroup) throws {
    defaults(suiteName).set(try JSONEncoder().encode(config), forKey: defaultsKey)
  }
}
