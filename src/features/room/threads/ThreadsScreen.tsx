/**
 * The thread browser of a space text channel (the web's RoomThreadsPanel) as a pushed screen:
 * the channel's active threads (joined first, then by last activity) with their lock, Joined
 * chip and "N messages · N members · time" line, and on request the archived ones, which are
 * read from the server since the live room list does not keep them. Private / New start the
 * create form; tapping a thread opens it; a long press offers the thread's own actions. Pull
 * to refresh re-reads the channel list (and the archived page when it is open).
 */
import { useCallback, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SpaceRoom } from '@web/api/spaces';
import { listArchivedThreads } from '@web/api/threads';
import { refreshSpaceRooms, spaceRoomFromPayload, upsertSpaceRoomFromPayload } from '@web/stores/spaces';
import { formatMessageTimestamp } from '@web/lib/utils/datetime';
import { t } from '@web/i18n/t';
import { useRoomGates, useRoomInfo } from '@/data';
import { useTheme } from '@/theme';
import { Button, EmptyState, Header, Icon, ListRow, Spinner, Text, showActionSheet, toast, useLongPress, withAlpha } from '@/ui';
import { goBack, openThreadScreen } from '../navigation';
import { openCreateThread } from '../presenters';
import { errorMessage } from '../util';
import { threadActionEntries } from './threadActions';
import { useChannelThreadIds, useStoredThread } from './data';
import { ReadableWidth } from '../shared/ReadableWidth';

function ThreadRowView({
  thread,
  onPress,
  onLongPress,
}: {
  thread: SpaceRoom;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const theme = useTheme();
  const th = thread.thread;
  const parts = [
    t('threads.messageCount', { count: th?.message_count ?? 0 }),
    t('threads.memberCount', { count: th?.member_count ?? 0 }),
  ];
  if (th?.archived && th.archived_at) parts.push(t('threads.archivedAt', { time: formatMessageTimestamp(new Date(th.archived_at)) }));
  else if (th?.last_active_at) parts.push(formatMessageTimestamp(new Date(th.last_active_at)));
  const longPress = useLongPress(() => onLongPress?.(), { disabled: !onLongPress });
  return (
    <ListRow
      title={thread.name}
      subtitle={parts.join(' · ')}
      leading={
        <View style={{ width: 32, height: 32, borderRadius: theme.radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(theme.colors.muted, 0.7) }}>
          <Icon name={th?.private ? 'lock' : 'comments'} size={14} tone="muted" />
        </View>
      }
      titleAccessory={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginStart: 6 }}>
          {th?.locked ? <Icon name="lock" size={10} tone="muted" accessibilityLabel={t('threads.lock')} /> : null}
          {th?.joined ? (
            <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 999, backgroundColor: withAlpha(theme.colors.primary, 0.15) }}>
              <Text variant="caption" tone="primary" weight="medium">
                {t('threads.joined')}
              </Text>
            </View>
          ) : null}
        </View>
      }
      chevron
      onPress={onPress}
      {...(onLongPress ? longPress : null)}
    />
  );
}

function ActiveThreadRow({ spaceId, threadId, canManageThreads }: { spaceId: string; threadId: string; canManageThreads: boolean }) {
  const thread = useStoredThread(spaceId, threadId);
  if (!thread) return null;
  return (
    <ThreadRowView
      thread={thread}
      onPress={() => openThreadScreen(thread.id, spaceId)}
      onLongPress={() =>
        void showActionSheet(threadActionEntries(thread, { spaceId, canManageThreads, onDeleted: () => undefined }), { title: thread.name })
      }
    />
  );
}

interface ArchivedThread {
  room: SpaceRoom;
  /** The server's record, for putting it in the store when it is opened. */
  raw: Record<string, unknown>;
}

type Row =
  | { kind: 'active'; id: string }
  | { kind: 'empty' }
  | { kind: 'archivedToggle' }
  | { kind: 'archived'; item: ArchivedThread }
  | { kind: 'archivedNote'; text: string }
  | { kind: 'archivedLoading' };

export function ThreadsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ roomId: string; spaceId?: string }>();
  const roomId = String(params.roomId ?? '');
  const info = useRoomInfo(roomId, typeof params.spaceId === 'string' ? params.spaceId : null);
  const spaceId = (typeof params.spaceId === 'string' && params.spaceId) || info?.spaceId || '';
  const gates = useRoomGates(roomId, spaceId);
  const ids = useChannelThreadIds(spaceId, roomId);
  const [showArchived, setShowArchived] = useState(false);
  const [archived, setArchived] = useState<ArchivedThread[] | null>(null);
  const [loadingArchived, setLoadingArchived] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadArchived = useCallback(async () => {
    setLoadingArchived(true);
    try {
      const res = await listArchivedThreads(roomId, { limit: 25 });
      const out: ArchivedThread[] = [];
      for (const raw of res.threads) {
        const room = spaceRoomFromPayload(raw);
        if (room) out.push({ room, raw });
      }
      setArchived(out);
    } catch (e) {
      console.warn('[threads] loading archived threads failed', e);
      setArchived([]);
    } finally {
      setLoadingArchived(false);
    }
  }, [roomId]);

  function toggleArchived() {
    const next = !showArchived;
    setShowArchived(next);
    if (next && archived === null && !loadingArchived) void loadArchived();
  }

  async function refresh() {
    setRefreshing(true);
    try {
      if (spaceId) await refreshSpaceRooms(spaceId);
      if (showArchived) await loadArchived();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  function openArchived(item: ArchivedThread) {
    // Not in the live list: put it there so the thread screen has its record.
    upsertSpaceRoomFromPayload(spaceId, item.raw);
    openThreadScreen(item.room.id, spaceId);
  }

  const canCreate = !!gates?.canCreatePublicThreads;
  const canCreatePrivate = !!gates?.canCreatePrivateThreads;
  const canManageThreads = !!gates?.canManageThreads;

  const rows: Row[] = [
    ...(ids.length ? ids.map((id) => ({ kind: 'active' as const, id })) : [{ kind: 'empty' as const }]),
    { kind: 'archivedToggle' },
    ...(showArchived
      ? loadingArchived
        ? [{ kind: 'archivedLoading' as const }]
        : (archived ?? []).length
          ? (archived ?? []).map((item) => ({ kind: 'archived' as const, item }))
          : [{ kind: 'archivedNote' as const, text: t('threads.archivedEmpty') }]
      : []),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header
        title={t('threads.title')}
        subtitle={info?.name ? `#${info.name}` : undefined}
        leadingIcon="comments"
        onBack={goBack}
        actions={[
          ...(canCreatePrivate
            ? [{ icon: 'lock', label: t('threads.newPrivate'), onPress: () => openCreateThread({ spaceId, roomId, privateDefault: true }) }]
            : []),
          ...(canCreate ? [{ icon: 'plus', label: t('threads.new'), onPress: () => openCreateThread({ spaceId, roomId }) }] : []),
        ]}
      />
      <ReadableWidth>
        <FlashList
          data={rows}
          keyExtractor={(r, i) => (r.kind === 'active' ? r.id : r.kind === 'archived' ? `a:${r.item.room.id}` : `${r.kind}:${i}`)}
          getItemType={(r) => r.kind}
          extraData={`${showArchived}:${loadingArchived}:${canManageThreads}:${canCreate}`}
          contentContainerStyle={{ paddingVertical: 8, paddingBottom: insets.bottom + 16 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.colors.primary} colors={[theme.colors.primary]} />}
          renderItem={({ item }) => {
            switch (item.kind) {
              case 'active':
                return <ActiveThreadRow spaceId={spaceId} threadId={item.id} canManageThreads={canManageThreads} />;
              case 'empty':
                return (
                  <EmptyState
                    icon="comments"
                    body={t('threads.empty')}
                    action={canCreate ? <Button title={t('threads.new')} icon="plus" size="sm" onPress={() => openCreateThread({ spaceId, roomId })} /> : undefined}
                  />
                );
              case 'archivedToggle':
                return (
                  <ListRow
                    title={t('threads.archived')}
                    icon="box-archive"
                    trailing={<Icon name={showArchived ? 'chevron-up' : 'chevron-down'} size={12} tone="muted" />}
                    accessibilityHint={showArchived ? undefined : t('mobile.room.showArchived')}
                    onPress={toggleArchived}
                    style={{ marginTop: 8 }}
                  />
                );
              case 'archivedLoading':
                return (
                  <View style={{ paddingVertical: 12 }}>
                    <Spinner label={t('common.loading')} />
                  </View>
                );
              case 'archivedNote':
                return (
                  <Text tone="muted" variant="caption" style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
                    {item.text}
                  </Text>
                );
              case 'archived':
                return <ThreadRowView thread={item.item.room} onPress={() => openArchived(item.item)} />;
            }
          }}
        />
      </ReadableWidth>
    </View>
  );
}
