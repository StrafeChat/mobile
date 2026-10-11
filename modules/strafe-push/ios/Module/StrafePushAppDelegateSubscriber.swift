import ExpoModulesCore
import UIKit
import UserNotifications

/**
 Silent pushes (`content-available`) wake the app, not the Notification Service Extension: the
 gateway sends `read` (the room was read on another device) and `call_end` (ringing stopped) that
 way. They are handled here natively, without starting JavaScript, by removing the notifications
 they make stale. Alert pushes may arrive here too while the app is in the foreground; they were
 already rendered by the extension and are left alone.

 Registered through expo-module.config.json's `appDelegateSubscribers`; expo-notifications'
 own subscriber receives the same call and both completions are aggregated by ExpoAppDelegate.
 */
public final class StrafePushAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    guard let push = EncryptedPush(userInfo: userInfo) else {
      completionHandler(.noData)
      return
    }
    // The exact badge is the running app's to set; only approximate it while nobody is looking.
    let updateBadge = application.applicationState != .active

    DispatchQueue.global(qos: .userInitiated).async {
      guard case .success(.remove(threadIdentifier: let thread)) = PushProcessor.process(
        push,
        config: PushDisplayConfigStore.load()
      ) else {
        completionHandler(.noData)
        return
      }
      DeliveredPushNotifications.remove(matching: { $0 == thread }) { removed, remainingRooms in
        guard removed > 0 else {
          completionHandler(.noData)
          return
        }
        guard updateBadge else {
          completionHandler(.newData)
          return
        }
        UNUserNotificationCenter.current().setBadgeCount(remainingRooms) { _ in
          completionHandler(.newData)
        }
      }
    }
  }
}
