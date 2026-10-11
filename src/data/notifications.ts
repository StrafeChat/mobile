/**
 * The Notifications tab - lib/mobileNotifications, the web's own feed, unchanged.
 *
 * There is no server inbox: the feed is assembled from state the client keeps current anyway
 * (per-room mention counters, unread cursors, incoming friend requests). PMs and groups appear
 * when unread or mentioned, space channels and threads only when mentioned; muted rooms and
 * Notes never; mentions first, then by count. Tapping a row acks it (ackRoomOptimistic to
 * `lastMessageId`) and opens it; accepting/declining a request is putRelationship /
 * removeRelationship + removeRelationshipLocally.
 */
import { notificationItems, notificationBadgeCount, incomingFriendRequests, type NotificationItem } from '@web/lib/mobileNotifications';
import { friendDisplayName } from '@web/stores/relationships';
import { deepEqual, useDerived } from './derived';

export type { NotificationItem };

/** The "Recent" rows. Re-renders when an item appears, goes, or changes count. */
export function useNotificationItems(): NotificationItem[] {
  return useDerived('notificationItems', () => notificationItems().map((i) => ({ ...i })), deepEqual);
}

export interface FriendRequestRow {
  userId: string;
  name: string;
  username: string;
  avatar?: string;
  homeDomain?: string;
  since?: string;
}

/** Incoming friend requests (the tab's first section). */
export function useIncomingFriendRequests(): FriendRequestRow[] {
  return useDerived(
    'incomingFriendRequests',
    () =>
      incomingFriendRequests().map((r) => ({
        userId: r.user.id,
        name: friendDisplayName(r),
        username: r.user.username,
        ...(r.user.avatar ? { avatar: r.user.avatar } : {}),
        ...(r.user.home_domain ? { homeDomain: r.user.home_domain } : {}),
        ...(r.since ? { since: r.since } : {}),
      })),
    deepEqual,
  );
}

/** The tab badge (and a good app-icon badge): item counts plus incoming requests. */
export function useNotificationBadgeCount(): number {
  return useDerived('notificationBadgeCount', () => notificationBadgeCount());
}
