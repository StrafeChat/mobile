import Foundation

/// A notification to show, in plain values; the extension maps it onto UNMutableNotificationContent.
struct PushNotification: Equatable {
  enum Sound: Equatable {
    case none
    case standard
  }

  enum Interruption: Equatable {
    case active
    case timeSensitive
  }

  var title: String
  var subtitle: String
  var body: String
  var threadIdentifier: String
  var categoryIdentifier: String
  var sound: Sound
  var interruption: Interruption
  /// Room messages count towards the app icon badge; calls and tests don't.
  var countsTowardsBadge: Bool
  /// What a tap routes by. expo-notifications hands JS `userInfo["body"]` of a remote
  /// notification as `content.data`, so this goes there as `{"strafe": routing}`.
  var routing: [String: String]
}

/// What a decrypted push asks of the device.
enum PushAction: Equatable {
  case show(PushNotification)
  /// Remove the delivered notifications of this thread (read elsewhere, ringing stopped).
  case remove(threadIdentifier: String)
  case nothing
}

/**
 The rendering rules of docs/PUSH.md ("Rendering"), as a pure function of the payload and the
 display config, so the app, the extension and the tests all agree.
 */
enum PushRenderer {
  static let messageCategory = "strafe.message"
  static let callCategory = "strafe.call"

  /**
   `config` is nil when the app hasn't stored one yet; removals still work then, but there are no
   strings to show anything with, which the caller handles like a failure (the gateway's text).
   */
  static func action(for payload: PushPayload, slot: String, config: PushDisplayConfig?) -> PushAction? {
    if let config {
      // A push for an account that isn't (or is no longer) signed in here, or meant for another
      // user than the slot's: not ours to show.
      guard let account = config.account(forSlot: slot), account.userId == payload.userId else {
        return .nothing
      }
    }

    switch payload.kind {
    case .read:
      guard let roomId = payload.roomId else { return .nothing }
      return .remove(threadIdentifier: PushThread.room(slot: slot, roomId: roomId))
    case .callEnd:
      guard let roomId = payload.roomId else { return .nothing }
      return .remove(threadIdentifier: PushThread.call(slot: slot, roomId: roomId))
    case .message, .call, .test:
      guard let config else { return nil }
      guard let notification = render(payload, slot: slot, config: config) else { return .nothing }
      return .show(notification)
    }
  }

  private static func render(_ payload: PushPayload, slot: String, config: PushDisplayConfig) -> PushNotification? {
    let strings = config.strings
    // Several accounts on one phone: say which one this is for.
    let accountLabel = config.accounts.count > 1 ? config.account(forSlot: slot)?.label : nil
    var routing = ["slot": slot, "t": payload.kind.rawValue]
    routing["rid"] = payload.roomId
    routing["sid"] = payload.spaceId
    routing["mid"] = payload.messageId

    switch payload.kind {
    case .message:
      guard let roomId = payload.roomId, let author = payload.author else { return nil }
      let name = ["name": author.name]
      let body: String
      // An end-to-end encrypted room never shows text, whatever the push carries: the instance
      // has no plaintext for it, so a body there would not be the message (Android drops it too).
      if !payload.encrypted, let preview = payload.body, !preview.isEmpty, config.preview {
        body = preview
      } else if payload.encrypted {
        body = fill(strings.encryptedMessage, name)
      } else if payload.attachments > 0 {
        body = fill(strings.attachment, name)
      } else {
        body = fill(strings.newMessage, name)
      }
      let title = conversationTitle(payload, author: author, strings: strings)
      // A 1:1 PM is titled by the sender already; everywhere else the subtitle says who wrote.
      let sender = payload.roomType == 1 ? nil : author.name
      return PushNotification(
        title: title,
        subtitle: joined(sender, accountLabel),
        body: body,
        threadIdentifier: PushThread.room(slot: slot, roomId: roomId),
        categoryIdentifier: messageCategory,
        sound: config.sounds ? .standard : .none,
        interruption: .active,
        countsTowardsBadge: true,
        routing: routing
      )

    case .call:
      guard let roomId = payload.roomId, let author = payload.author else { return nil }
      let body: String
      if payload.roomType == 2, let room = nonEmpty(payload.roomName) {
        body = fill(strings.callFromIn, ["name": author.name, "room": room])
      } else {
        body = fill(strings.callFrom, ["name": author.name])
      }
      return PushNotification(
        title: fill(strings.incomingCall, ["name": author.name]),
        subtitle: accountLabel ?? "",
        body: body,
        threadIdentifier: PushThread.call(slot: slot, roomId: roomId),
        categoryIdentifier: callCategory,
        // A ringing call always sounds; the sounds preference is about messages.
        sound: .standard,
        interruption: .timeSensitive,
        countsTowardsBadge: false,
        routing: routing
      )

    case .test:
      return PushNotification(
        title: strings.testTitle,
        subtitle: accountLabel ?? "",
        body: strings.testBody,
        threadIdentifier: PushThread.test(slot: slot),
        categoryIdentifier: "",
        sound: config.sounds ? .standard : .none,
        interruption: .active,
        countsTowardsBadge: false,
        routing: routing
      )

    case .read, .callEnd:
      return nil
    }
  }

  /// PM: the sender. Group PM: its name. Space room: `#room · Space`. Thread: `thread · #room`.
  private static func conversationTitle(_ payload: PushPayload, author: PushPayload.Author, strings: PushDisplayConfig.Strings) -> String {
    let room = nonEmpty(payload.roomName)
    switch payload.roomType {
    case 1:
      return author.name
    case 3, 4:
      switch (room, nonEmpty(payload.spaceName)) {
      case let (room?, space?): return fill(strings.spaceRoom, ["room": room, "space": space])
      case let (room?, nil): return "#\(room)"
      case let (nil, space?): return space
      case (nil, nil): return strings.appName
      }
    case 6:
      switch (room, nonEmpty(payload.parentName)) {
      case let (thread?, parent?): return fill(strings.threadRoom, ["thread": thread, "room": parent])
      case let (thread?, nil): return thread
      case let (nil, parent?): return "#\(parent)"
      case (nil, nil): return strings.appName
      }
    default:
      // Group PMs, and any room type newer than this build.
      return room ?? author.name
    }
  }

  /**
   Replaces `{{key}}` placeholders in one pass, so a value that itself contains `{{...}}` (a
   display name is anyone's to choose) is never expanded. Unknown placeholders stay as they are.
   */
  static func fill(_ template: String, _ values: [String: String]) -> String {
    var result = ""
    var rest = template[...]
    while let open = rest.range(of: "{{"), let close = rest[open.upperBound...].range(of: "}}") {
      result.append(contentsOf: rest[..<open.lowerBound])
      if let value = values[String(rest[open.upperBound..<close.lowerBound])] {
        result.append(contentsOf: value)
      } else {
        result.append(contentsOf: rest[open.lowerBound..<close.upperBound])
      }
      rest = rest[close.upperBound...]
    }
    result.append(contentsOf: rest)
    return result
  }

  private static func nonEmpty(_ value: String?) -> String? {
    guard let value, !value.isEmpty else { return nil }
    return value
  }

  private static func joined(_ parts: String?...) -> String {
    return parts.compactMap { nonEmpty($0) }.joined(separator: " · ")
  }
}
