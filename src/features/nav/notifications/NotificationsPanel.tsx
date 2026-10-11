/**
 * The Notifications tab (MobileNotificationsPanel): incoming friend requests with Accept /
 * Decline, then "Recent" - unread or mentioned conversations and mentioned space rooms, mentions
 * first (lib/mobileNotifications, the web's own feed; there is no server inbox).
 *
 * One deliberate difference from the web: tapping a row opens the room but does not ack it.
 * The web marks it read on the tap, before anything was seen; here the room's own read cursor
 * advances as messages are actually shown. "Mark as read" stays one long-press away.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { t } from '@web/i18n/t';
import { removeRelationship } from '@web/api/relationships';
import { removeRelationshipLocally, relationships } from '@web/stores/relationships';
import { ackRoomOptimistic } from '@web/stores/readState';
import { auth } from '@web/stores/auth';
import { popoverSubjectFromParticipant } from '@web/lib/userProfilePopoverHelpers';
import { useIncomingFriendRequests, useNotificationItems, type FriendRequestRow, type NotificationItem } from '@/data';
import { presentProfileSheet } from '@/platform/presenters';
import { openRoom } from '@/shell/state';
import { useTheme } from '@/theme';
import { Avatar, Badge, Button, EmptyState, Header, Icon, ListHeader, Text, Touchable, toast, useLongPressActions, withAlpha } from '@/ui';
import { acceptFriendRequest, errorMessage } from '../actions';
import { openPmWith } from '../navigation';

type Row =
  | { kind: 'header'; key: string; title: string }
  | { kind: 'request'; key: string; request: FriendRequestRow }
  | { kind: 'item'; key: string; item: NotificationItem };

/** The space id a feed row's href names (`/spaces/:sid/rooms/:rid`), null for a PM. */
export function spaceIdFromHref(href: string): string | null {
  return /^\/spaces\/([^/]+)\/rooms\//.exec(href)?.[1] ?? null;
}

/** The feed as list rows: requests, then recent. Pure. */
export function notificationRows(requests: readonly FriendRequestRow[], items: readonly NotificationItem[]): Row[] {
  const out: Row[] = [];
  if (requests.length) {
    out.push({ kind: 'header', key: 'h:requests', title: t('mobile.notifications.friendRequests') });
    for (const r of requests) out.push({ kind: 'request', key: `r:${r.userId}`, request: r });
  }
  if (items.length) {
    out.push({ kind: 'header', key: 'h:recent', title: t('mobile.notifications.recent') });
    for (const i of items) out.push({ kind: 'item', key: `i:${i.roomId}`, item: i });
  }
  return out;
}

const RequestCard = memo(function RequestCard({
  request,
  busy,
  onRespond,
}: {
  request: FriendRequestRow;
  busy: boolean;
  onRespond: (userId: string, accept: boolean) => void;
}) {
  const theme = useTheme();
  const openProfile = () => {
    const rel = relationships.relationships.find((r) => r.user.id === request.userId);
    if (!rel) return;
    presentProfileSheet({
      subject: popoverSubjectFromParticipant(rel.user),
      currentUserId: auth.user?.id,
      onMessageUser: (id) => void openPmWith(id),
    });
  };
  return (
    <View style={[styles.card, { borderColor: withAlpha(theme.colors.border, 0.7), backgroundColor: withAlpha(theme.colors.card, 0.4), borderRadius: theme.radii.lg }]}>
      <Touchable feedback="opacity" onPress={openProfile} accessibilityLabel={request.name} style={styles.cardIdentity}>
        <Avatar name={request.name} uri={request.avatar} size={36} />
        <View style={styles.flex}>
          <Text variant="label" numberOfLines={1}>
            {request.name}
          </Text>
          <Text variant="caption" numberOfLines={1}>
            {t('mobile.notifications.wantsToBeFriends')}
          </Text>
        </View>
      </Touchable>
      <View style={styles.cardActions}>
        <Button title={t('friends.actions.accept')} size="sm" disabled={busy} onPress={() => onRespond(request.userId, true)} />
        <Button title={t('friends.actions.decline')} size="sm" variant="outline" disabled={busy} onPress={() => onRespond(request.userId, false)} />
      </View>
    </View>
  );
});

const FeedRow = memo(function FeedRow({ item }: { item: NotificationItem }) {
  const theme = useTheme();
  const spaceId = spaceIdFromHref(item.href);
  const menu = useLongPressActions(
    () => [
      {
        key: 'open',
        label: t('nav.openConversation'),
        icon: 'fa-arrow-right',
        onSelect: () => openRoom(item.roomId, spaceId),
      },
      !!item.lastMessageId && {
        key: 'mark-read',
        label: t('contextMenu.markAsRead'),
        icon: 'fa-check-double',
        onSelect: () => ackRoomOptimistic(item.roomId, item.lastMessageId!),
      },
    ],
    { title: item.name },
  );
  const line = `${item.mention ? t('mobile.notifications.mentioned', { count: item.count }) : t('mobile.notifications.unread', { count: item.count })}${item.context ? ` · ${item.context}` : ''}`;
  return (
    <Touchable
      onPress={() => openRoom(item.roomId, spaceId)}
      accessibilityLabel={`${item.name}, ${line}`}
      style={[styles.card, styles.feedRow, { borderColor: withAlpha(theme.colors.border, 0.7), backgroundColor: withAlpha(theme.colors.card, 0.4), borderRadius: theme.radii.lg }]}
      {...menu}
    >
      {item.isChannel ? (
        <View style={[styles.channelGlyph, { backgroundColor: withAlpha(theme.colors.muted, 0.6) }]}>
          <Icon name="fa-hashtag" size={13} tone="muted" />
        </View>
      ) : (
        <Avatar name={item.name} uri={item.avatar} size={36} />
      )}
      <View style={styles.flex}>
        <Text variant="label" numberOfLines={1}>
          {item.name}
        </Text>
        <Text variant="caption" numberOfLines={1}>
          {line}
        </Text>
      </View>
      {item.mention ? <Badge count={item.count} /> : null}
    </Touchable>
  );
});

export function NotificationsPanel({ bottomInset = 0 }: { bottomInset?: number }) {
  const theme = useTheme();
  const requests = useIncomingFriendRequests();
  const items = useNotificationItems();
  const [busy, setBusy] = useState('');
  const rows = useMemo(() => notificationRows(requests, items), [requests, items]);

  const respond = useCallback(async (userId: string, accept: boolean) => {
    setBusy(userId);
    try {
      if (accept) {
        await acceptFriendRequest(userId);
      } else {
        await removeRelationship(userId);
        removeRelationshipLocally(userId);
      }
    } catch (err) {
      toast.error(errorMessage(err, 'mobile.nav.requestFailed'));
    } finally {
      setBusy('');
    }
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: Row }) => {
      switch (item.kind) {
        case 'header':
          return <ListHeader title={item.title} style={styles.sectionHeader} />;
        case 'request':
          return <RequestCard request={item.request} busy={busy === item.request.userId} onRespond={(id, ok) => void respond(id, ok)} />;
        case 'item':
          return <FeedRow item={item.item} />;
      }
    },
    [busy, respond],
  );

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.card }]}>
      <Header title={t('mobile.tabs.notifications')} safeTop={false} large />
      {rows.length === 0 ? (
        <EmptyState icon="fa-solid fa-bell" body={t('mobile.notifications.empty')} size="page" />
      ) : (
        <FlashList
          data={rows}
          renderItem={renderItem}
          keyExtractor={(r) => r.key}
          getItemType={(r) => r.kind}
          extraData={busy}
          contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 12 + bottomInset }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  sectionHeader: { paddingStart: 4 },
  card: { borderWidth: StyleSheet.hairlineWidth, padding: 10, marginBottom: 8, gap: 10 },
  cardIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  cardActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  feedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56 },
  channelGlyph: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
});
