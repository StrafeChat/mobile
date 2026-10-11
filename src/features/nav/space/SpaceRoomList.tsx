/**
 * A space's rooms beside the rail (SpaceRoomsBar): the header, then one flat list of top-level
 * rooms, each visible section with its rooms (unless collapsed), the people in each voice room
 * and the joined threads under each room - the tree src/data builds with the web's visibility
 * rule (canViewSpaceChannel), so a private room or section never shows to someone who cannot
 * view it. Each row subscribes to its own badges; a message in one room re-renders one row.
 * Pull to refresh re-fetches the room list.
 */
import { useCallback, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { t } from '@web/i18n/t';
import { refreshSpaceRooms } from '@web/stores/spaces';
import { useSolid } from '@/bridge/solid';
import {
  useEnsureSpaceData,
  useSpaceAbilities,
  useSpaceRoomTree,
  useSpaceRoomsLoaded,
  type SpaceRoomTreeItem,
} from '@/data';
import { shell } from '@/shell/state';
import { useTheme } from '@/theme';
import { Button, EmptyState, Spinner } from '@/ui';
import { VoiceOccupantRow } from '../links';
import { openCreateRoomSheet } from '../sheets/store';
import { ChannelRow } from './ChannelRow';
import { SectionRow } from './SectionRow';
import { SpaceHeader } from './SpaceHeader';
import { ThreadRow } from './ThreadRow';

function useActiveRoomId(): string | null {
  return useSolid(() => {
    const v = shell.view();
    return v.kind === 'room' ? v.roomId : null;
  });
}

export function SpaceRoomList({ spaceId, bottomInset = 0 }: { spaceId: string; bottomInset?: number }) {
  const theme = useTheme();
  useEnsureSpaceData(spaceId);
  const activeRoomId = useActiveRoomId();
  const tree = useSpaceRoomTree(spaceId, activeRoomId);
  const loaded = useSpaceRoomsLoaded(spaceId);
  const abilities = useSpaceAbilities(spaceId);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refreshSpaceRooms(spaceId)
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, [spaceId]);

  const renderItem = useCallback(
    ({ item }: { item: SpaceRoomTreeItem }) => {
      switch (item.kind) {
        case 'channel':
          return <ChannelRow spaceId={spaceId} roomId={item.roomId} active={activeRoomId === item.roomId} />;
        case 'thread':
          return <ThreadRow spaceId={spaceId} roomId={item.roomId} active={activeRoomId === item.roomId} />;
        case 'voiceUser':
          return <VoiceOccupantRow spaceId={spaceId} roomId={item.roomId} userId={item.userId} indent={38} />;
        case 'section':
          return <SectionRow spaceId={spaceId} sectionId={item.sectionId} collapsed={item.collapsed} hasUnread={item.hasUnread} />;
      }
    },
    [spaceId, activeRoomId],
  );

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.card }]}>
      <SpaceHeader spaceId={spaceId} />
      <FlashList
        data={loaded ? tree : []}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
        extraData={activeRoomId}
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 12 + bottomInset }}
        ListEmptyComponent={
          loaded ? (
            <EmptyState
              icon="fa-solid fa-hashtag"
              title={t('mobile.nav.noRooms')}
              action={
                abilities.canManageRooms ? (
                  <Button title={t('createRoom.submit')} size="sm" onPress={() => openCreateRoomSheet(spaceId, null)} />
                ) : undefined
              }
            />
          ) : (
            <Spinner label={t('common.loading')} style={styles.loading} />
          )
        }
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
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  loading: { paddingVertical: 32 },
});
