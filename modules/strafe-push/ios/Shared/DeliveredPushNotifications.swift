import Foundation
import UserNotifications

/// The Strafe notifications sitting in Notification Center, found by their thread identifiers.
enum DeliveredPushNotifications {
  /**
   Removes the delivered notifications whose thread matches, then reports how many were removed
   and how many room conversations are left (what the badge approximates).
   */
  static func remove(
    matching shouldRemove: @escaping (_ threadIdentifier: String) -> Bool,
    center: UNUserNotificationCenter = .current(),
    completion: @escaping (_ removed: Int, _ remainingRooms: Int) -> Void
  ) {
    center.getDeliveredNotifications { notifications in
      var identifiers: [String] = []
      var rooms = Set<String>()
      for notification in notifications {
        let thread = notification.request.content.threadIdentifier
        if shouldRemove(thread) {
          identifiers.append(notification.request.identifier)
        } else if PushThread.isRoom(thread) {
          rooms.insert(thread)
        }
      }
      if !identifiers.isEmpty {
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
      }
      completion(identifiers.count, rooms.count)
    }
  }

  /**
   The badge for a new message: the room conversations with a notification showing, this one
   included. An approximation of unread rooms (the server keeps no badge count); the running app
   replaces it with the exact number whenever it is in the foreground.
   */
  static func badge(
    including threadIdentifier: String,
    center: UNUserNotificationCenter = .current(),
    completion: @escaping (Int) -> Void
  ) {
    center.getDeliveredNotifications { notifications in
      var rooms = Set(notifications.map(\.request.content.threadIdentifier).filter(PushThread.isRoom))
      rooms.insert(threadIdentifier)
      completion(rooms.count)
    }
  }
}
