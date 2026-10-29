/**
 * Friends (FriendsPage), shown on the content side: Online / All / Pending / Blocked, with
 * "Add friend" in the header (by handle, `name@instance` for someone on another instance).
 *
 * Rows: tap for the profile sheet, long-press for Message / Copy username / Remove friend.
 * Friends get a Message button; incoming requests Accept / Decline; outgoing Cancel; blocked
 * Unblock (DELETE the relationship, as the web does). Failures say so (the web swallows them),
 * removing a friend asks first, and the list pulls to refresh.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { t } from '@web/i18n/t';
import { removeRelationship } from '@web/api/relationships';
import { friendDisplayName, loadRelationships, relationships, removeRelationshipLocally } from '@web/stores/relationships';
import { presence } from '@web/stores/presence';
import { formatHandle } from '@web/stores/instance';
import { auth } from '@web/stores/auth';
import { confirmDialog } from '@web/stores/confirmDialog';
import { popoverSubjectFromParticipant } from '@web/lib/userProfilePopoverHelpers';
import { useSolid } from '@/bridge/solid';
import { deepEqual, playingLabel, useDerived, usePresence, useRelationship } from '@/data';
import { presentProfileSheet } from '@/platform/presenters';
import { useTheme } from '@/theme';
import {
  Avatar,
  Button,
  EmptyState,
  IconButton,
  ListHeader,
  PresenceDot,
  SegmentedControl,
  SentenceWithName,
  Spinner,
  Text,
  Touchable,
  toast,
  useLongPressActions,
} from '@/ui';
import { acceptFriendRequest, copyText, errorMessage } from './actions';
import { ContentHeader } from './ContentHeader';
import { FRIENDS_TABS, friendLine, friendSections, hasAnyRelationship, incomingCount, type FriendsSection, type FriendsTab } from './friendsModel';
import { openPmWith } from './navigation';
import { openAddFriendSheet } from './sheets/store';

type Row =
  | { kind: 'header'; key: string; titleKey: string; count: number }
  | { kind: 'person'; key: string; userId: string; rowKind: FriendsSection['kind'] };

function rowsOf(sections: readonly FriendsSection[]): Row[] {
  const out: Row[] = [];
  for (const s of sections) {
    out.push({ kind: 'header', key: `h:${s.titleKey}`, titleKey: s.titleKey, count: s.userIds.length });
    for (const id of s.userIds) out.push({ kind: 'person', key: `${s.kind}:${id}`, userId: id, rowKind: s.kind });
  }
  return out;
}

function openProfile(userId: string): void {
  const rel = relationships.relationships.find((r) => r.user.id === userId);
  if (!rel) return;
  presentProfileSheet({
    subject: popoverSubjectFromParticipant(rel.user),
    currentUserId: auth.user?.id,
    onMessageUser: (id) => void openPmWith(id),
  });
}

async function removeFriend(userId: string, name: string): Promise<void> {
  const ok = await confirmDialog({
    title: t('friends.actions.removeFriend'),
    body: t('mobile.nav.removeFriendConfirm', { name }),
    confirmLabel: t('friends.actions.removeFriend'),
    tone: 'danger',
    icon: 'fa-solid fa-user-minus',
  });
  if (!ok) return;
  try {
    await removeRelationship(userId);
    removeRelationshipLocally(userId);
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

const PersonRow = memo(function PersonRow({
  userId,
  kind,
  busy,
  setBusy,
}: {
  userId: string;
  kind: FriendsSection['kind'];
  busy: boolean;
  setBusy: (id: string | null) => void;
}) {
  const theme = useTheme();
  const rel = useRelationship(userId);
  const live = usePresence(userId);
  const name = rel ? friendDisplayName(rel) : '';
  const handle = rel ? formatHandle(rel.user) : '';
  const menu = useLongPressActions(
    kind === 'friend'
      ? () => [
          { key: 'message', label: t('friends.actions.message'), icon: 'fa-message', onSelect: () => void openPmWith(userId) },
          { key: 'copy', label: t('userArea.copyUsername'), icon: 'fa-copy', onSelect: () => void copyText(handle) },
          {
            key: 'remove',
            label: t('friends.actions.removeFriend'),
            icon: 'fa-user-minus',
            danger: true,
            onSelect: () => void removeFriend(userId, name),
          },
        ]
      : null,
    { title: name, subtitle: handle },
  );
  if (!rel) return null;

  async function run(fn: () => Promise<unknown>) {
    setBusy(userId);
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  // Presence (a custom status, the game) only for friends: requests and blocks show the handle.
  const line = kind === 'friend' ? friendLine(rel, presence.byUser[userId] ? live : undefined, handle) : { text: handle };
  const subtitle = line.text;
  const dim = kind === 'outgoing' || kind === 'blocked';
  return (
    <Touchable
      onPress={() => openProfile(userId)}
      accessibilityLabel={[name, subtitle].join(', ')}
      style={[styles.person, { borderRadius: theme.radii.md }]}
      {...menu}
    >
      <View style={dim ? styles.dim : undefined}>
        <Avatar
          name={name}
          uri={rel.user.avatar}
          size="lg"
          overlay={kind === 'friend' ? <PresenceDot status={live.status} size={12} ringColor={theme.colors.background} /> : undefined}
        />
      </View>
      <View style={styles.flex}>
        <Text variant="label" numberOfLines={1}>
          {name}
        </Text>
        {line.playing ? (
          <SentenceWithName sentence={playingLabel} name={line.playing} />
        ) : (
          <Text variant="caption" numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {kind === 'friend' ? (
        <IconButton
          icon="fa-message"
          label={`${t('friends.actions.message')} ${name}`}
          disabled={busy}
          onPress={() => void run(() => openPmWith(userId))}
        />
      ) : kind === 'incoming' ? (
        <View style={styles.actions}>
          <Button title={t('friends.actions.accept')} size="sm" loading={busy} disabled={busy} onPress={() => void run(() => acceptFriendRequest(userId))} />
          <Button
            title={t('friends.actions.decline')}
            size="sm"
            variant="outline"
            disabled={busy}
            onPress={() =>
              void run(async () => {
                await removeRelationship(userId);
                removeRelationshipLocally(userId);
              })
            }
          />
        </View>
      ) : (
        <Button
          title={kind === 'blocked' ? t('friends.actions.unblock') : t('common.cancel')}
          size="sm"
          variant="outline"
          loading={busy}
          disabled={busy}
          onPress={() =>
            void run(async () => {
              await removeRelationship(userId);
              removeRelationshipLocally(userId);
            })
          }
        />
      )}
    </Touchable>
  );
});

const EMPTY_ICON: Record<FriendsTab, string> = {
  online: 'fa-solid fa-user-group',
  all: 'fa-solid fa-user-group',
  pending: 'fa-solid fa-envelope-open',
  blocked: 'fa-solid fa-ban',
};

export function FriendsView() {
  const theme = useTheme();
  const [tab, setTab] = useState<FriendsTab>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Only the first load replaces the list with a spinner: a reload (pull to refresh, a sent
  // request) keeps the list on screen - unmounting it would drop the pull-to-refresh too.
  const loading = useSolid(() => relationships.loading && !relationships.hydrated);
  const sections = useDerived(
    `friendsSections:${tab}`,
    () => friendSections(relationships.relationships, tab, (id) => presence.byUser[id]),
    deepEqual,
  );
  const anyAtAll = useDerived('friendsAny', () => hasAnyRelationship(relationships.relationships));
  const pending = useDerived('friendsIncoming', () => incomingCount(relationships.relationships));
  const rows = useMemo(() => rowsOf(sections), [sections]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadRelationships()
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, []);

  const addButton = <Button title={t('friends.addFriend')} icon="fa-user-plus" onPress={openAddFriendSheet} />;

  const renderItem = useCallback(
    ({ item }: { item: Row }) =>
      item.kind === 'header' ? (
        <ListHeader title={t(item.titleKey, { count: item.count })} style={styles.sectionHeader} />
      ) : (
        <PersonRow userId={item.userId} kind={item.rowKind} busy={busy === item.userId} setBusy={setBusy} />
      ),
    [busy],
  );

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <ContentHeader
        title={t('nav.friends')}
        icon="fa-user-group"
        actions={[{ icon: 'fa-user-plus', label: t('friends.addFriend'), onPress: openAddFriendSheet }]}
      />
      <View style={[styles.tabs, { borderBottomColor: theme.colors.border, backgroundColor: theme.colors.card }]}>
        <SegmentedControl<FriendsTab>
          value={tab}
          onChange={setTab}
          size="sm"
          accessibilityLabel={t('friends.listAria')}
          items={FRIENDS_TABS.map((id) => ({
            id,
            label: id === 'pending' && pending > 0 ? t('friends.tabs.pendingCount', { count: pending }) : t(`friends.tabs.${id}`),
          }))}
        />
      </View>
      <View style={styles.body}>
        {loading ? (
          <Spinner fill />
        ) : !anyAtAll ? (
          <EmptyState
            size="page"
            icon="fa-solid fa-user-group"
            title={t('friends.empty.noneTitle')}
            body={t('friends.empty.noneBody')}
            action={addButton}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            size="page"
            icon={EMPTY_ICON[tab]}
            title={t(`friends.empty.${tab}Title`)}
            body={t(`friends.empty.${tab}Body`)}
            action={tab !== 'online' && tab !== 'blocked' ? addButton : undefined}
          />
        ) : (
          <FlashList
            data={rows}
            renderItem={renderItem}
            keyExtractor={(r) => r.key}
            getItemType={(r) => r.kind}
            extraData={busy}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.mutedForeground}
                colors={[theme.colors.primary]}
                progressBackgroundColor={theme.colors.card}
              />
            }
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  /** Tablets: a readable column rather than rows stretched across the screen. */
  body: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' },
  flex: { flex: 1, minWidth: 0 },
  tabs: { paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  listContent: { paddingHorizontal: 8, paddingBottom: 24 },
  sectionHeader: { paddingStart: 12 },
  person: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingHorizontal: 10, paddingVertical: 8 },
  dim: { opacity: 0.7 },
  actions: { flexDirection: 'row', gap: 6 },
});
