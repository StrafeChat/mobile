import os
import UserNotifications

/**
 The Notification Service Extension: every alert push from the Strafe push gateway arrives as
 `{"aps": {"alert": {"body": <generic text>}, "mutable-content": 1}, "s": <slot>, "p": <body>}`,
 where `p` is the instance's RFC 8291 ciphertext. This decrypts it with the slot's key from the
 shared keychain group and replaces the generic text with the real notification, rendered from
 the display config the app stored in the App Group. If anything fails - no keys, no config, a
 body that doesn't decrypt - the gateway's generic alert is shown instead, so a push is never lost.

 What JavaScript sees afterwards (expo-notifications, on a tap or while in the foreground):
 `request.content.data` = `{"strafe": {"slot", "t", "rid"?, "sid"?, "mid"?}}` (only `slot` for the
 generic fallback), and `request.trigger.payload` = the whole userInfo minus the ciphertext.

 The sources in modules/strafe-push/ios/Shared are compiled into this target too
 (plugins/withStrafePushIos.js). Nothing else is linked: the extension has a small memory budget.
 */
final class NotificationService: UNNotificationServiceExtension {
  private static let log = os.Logger(subsystem: "chat.strafe.push", category: "service")
  /// expo-notifications reads a remote notification's `content.data` from this userInfo key.
  private static let dataKey = "body"

  private let lock = NSLock()
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var fallback: UNNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    let original = request.content
    guard let push = EncryptedPush(userInfo: original.userInfo) else {
      // Not a Strafe gateway push: leave it as it came.
      contentHandler(original)
      return
    }
    let fallback = Self.fallbackContent(original, slot: push.slot)
    lock.withLock {
      self.contentHandler = contentHandler
      self.fallback = fallback
    }

    switch PushProcessor.process(push, config: PushDisplayConfigStore.load()) {
    case .failure(let failure):
      Self.log.error("showing the generic alert: \(String(describing: failure), privacy: .public)")
      deliver(fallback)

    case .success(.nothing):
      deliver(Self.emptyContent(original))

    case .success(.remove(threadIdentifier: let thread)):
      // Read sync and call_end normally come as silent pushes to the app; handle them here too.
      DeliveredPushNotifications.remove(matching: { $0 == thread }) { _, _ in
        self.deliver(Self.emptyContent(original))
      }

    case .success(.show(let notification)):
      let content = Self.content(for: notification, original: original)
      guard notification.countsTowardsBadge else {
        deliver(content)
        return
      }
      DeliveredPushNotifications.badge(including: notification.threadIdentifier) { count in
        content.badge = NSNumber(value: count)
        self.deliver(content)
      }
    }
  }

  override func serviceExtensionTimeWillExpire() {
    let fallback = lock.withLock { self.fallback }
    deliver(fallback ?? UNMutableNotificationContent())
  }

  /// Hands the content to the system exactly once, whichever of the work and the timeout is first.
  private func deliver(_ content: UNNotificationContent) {
    let handler = lock.withLock { () -> ((UNNotificationContent) -> Void)? in
      let handler = contentHandler
      contentHandler = nil
      return handler
    }
    handler?(content)
  }

  private static func content(for notification: PushNotification, original: UNNotificationContent) -> UNMutableNotificationContent {
    let content = UNMutableNotificationContent()
    content.title = notification.title
    content.subtitle = notification.subtitle
    content.body = notification.body
    content.threadIdentifier = notification.threadIdentifier
    content.categoryIdentifier = notification.categoryIdentifier
    switch notification.sound {
    case .none: content.sound = nil
    case .standard: content.sound = .default
    }
    switch notification.interruption {
    case .active: content.interruptionLevel = .active
    // Honoured when the app has the Time Sensitive Notifications capability; .active otherwise.
    case .timeSensitive: content.interruptionLevel = .timeSensitive
    }
    content.userInfo = userInfo(original.userInfo, routing: notification.routing)
    return content
  }

  /**
   For a push that should show nothing (a signed-out account, another user, an event this build
   doesn't know). An extension can only drop an alert outright with Apple's notification-filtering
   entitlement (`com.apple.developer.usernotifications.filtering`, granted on request); without
   it this is the least iOS will show: no title, body or sound. Rare by design - the app deletes
   its subscription on sign-out. The gateway's `s` stays in userInfo so the app's foreground
   handler still recognises it as one of ours.
   */
  private static func emptyContent(_ original: UNNotificationContent) -> UNNotificationContent {
    let content = UNMutableNotificationContent()
    var userInfo = original.userInfo
    userInfo.removeValue(forKey: EncryptedPush.bodyKey)
    content.userInfo = userInfo
    return content
  }

  private static func fallbackContent(_ original: UNNotificationContent, slot: String) -> UNNotificationContent {
    let content = (original.mutableCopy() as? UNMutableNotificationContent) ?? UNMutableNotificationContent()
    // Its own thread, so clearAll finds it.
    content.threadIdentifier = PushThread.undecrypted(slot: slot)
    content.userInfo = userInfo(original.userInfo, routing: ["slot": slot])
    return content
  }

  private static func userInfo(_ original: [AnyHashable: Any], routing: [String: String]) -> [AnyHashable: Any] {
    var userInfo = original
    // The ciphertext has done its job; nothing downstream needs it.
    userInfo.removeValue(forKey: EncryptedPush.bodyKey)
    userInfo[dataKey] = ["strafe": routing]
    return userInfo
  }
}
