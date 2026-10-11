/**
 * Home's list beside the rail (the web's RoomsBar): Home, Friends (with the incoming request
 * count) and Notes, then "Conversations" - every 1:1 and group PM, newest first - with "+" to
 * start a group. The shortcut rows scroll away with the list, as on the web and Discord.
 * Pull to refresh reloads the PM list from the server.
 */
import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { t } from '@web/i18n/t';
import { loadRooms } from '@web/stores/rooms';
import { useSolid } from '@/bridge/solid';
import { useFriendRequestCount, useNotesRoomId, usePmListLoading, usePmRoomIds } from '@/data';
import { openShellView, shell } from '@/shell/state';
import { useTheme } from '@/theme';
import { Header, Icon, ListHeader, ListRow, Text } from '@/ui';
import { openAddFriendSheet, openCreateGroupSheet } from '../sheets/store';
import { PmRow } from './PmRow';

type HomeItem =
  | { kind: 'shortcut'; key: 'home' | 'friends' | 'notes' }
  | { kind: 'section'; key: string }
  | { kind: 'status'; key: string; text: string }
  | { kind: 'pm'; key: string; roomId: string };

/** What the content panel shows, as far as the shortcuts care. */
function useHomeSelection(notesRoomId: string | null): { activeRoomId: string | null; current: 'home' | 'friends' | 'notes' | null } {
  return useSolid(() => {
    const v = shell.view();
    const content = shell.panel() === 'content';
    if (v.kind === 'room') {
      return { activeRoomId: v.roomId, current: notesRoomId && v.roomId === notesRoomId ? 'notes' : null };
    }
    if (v.kind === 'friends') return { activeRoomId: null, current: 'friends' };
    if (v.kind === 'notes') return { activeRoomId: null, current: 'notes' };
    return { activeRoomId: null, current: content ? 'home' : null };
  }, [notesRoomId]);
}

function ShortcutRow({ which, active, badge }: { which: 'home' | 'friends' | 'notes'; active: boolean; badge?: number }) {
  const theme = useTheme();
  const spec = {
    home: { icon: 'fa-house', label: t('nav.home'), go: () => openShellView({ kind: 'empty' }) },
    friends: { icon: 'fa-user-group', label: t('nav.friends'), go: () => openShellView({ kind: 'friends' }) },
    notes: { icon: 'fa-note-sticky', label: t('nav.notes'), go: () => openShellView({ kind: 'notes' }) },
  }[which];
  return (
    <ListRow
      inset
      title={spec.label}
      selected={active}
      badge={badge}
      onPress={spec.go}
      style={styles.inset}
      leading={
        <View style={[styles.shortcutIcon, { backgroundColor: theme.colors.muted }]}>
          <Icon name={spec.icon} size={14} color={theme.colors.mutedForeground} />
        </View>
      }
    />
  );
}

export function HomeList({ bottomInset = 0 }: { bottomInset?: number }) {
  const theme = useTheme();
  const ids = usePmRoomIds();
  const loading = usePmListLoading();
  const requests = useFriendRequestCount();
  const notesRoomId = useNotesRoomId();
  const sel = useHomeSelection(notesRoomId);
  const [refreshing, setRefreshing] = useState(false);

  const data = useMemo<HomeItem[]>(() => {
    const out: HomeItem[] = [
      { kind: 'shortcut', key: 'home' },
      { kind: 'shortcut', key: 'friends' },
      { kind: 'shortcut', key: 'notes' },
      { kind: 'section', key: 'conversations' },
    ];
    // "Loading" only while there is nothing to show yet (a pull to refresh keeps the list).
    if (loading && ids.length === 0) out.push({ kind: 'status', key: 'loading', text: t('common.loading') });
    else if (ids.length === 0) out.push({ kind: 'status', key: 'empty', text: t('nav.noConversations') });
    for (const roomId of ids) out.push({ kind: 'pm', key: `pm:${roomId}`, roomId });
    return out;
  }, [ids, loading]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadRooms()
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: HomeItem }) => {
      switch (item.kind) {
        case 'shortcut':
          return (
            <ShortcutRow
              which={item.key}
              active={sel.current === item.key}
              {...(item.key === 'friends' && requests > 0 ? { badge: requests } : {})}
            />
          );
        case 'section':
          return (
            <ListHeader
              title={t('nav.conversations')}
              action={{ icon: 'fa-plus', label: t('nav.newGroup'), onPress: openCreateGroupSheet }}
              style={styles.sectionHeader}
            />
          );
        case 'status':
          return (
            <Text variant="caption" style={styles.status}>
              {item.text}
            </Text>
          );
        case 'pm':
          return <PmRow roomId={item.roomId} active={sel.activeRoomId === item.roomId} />;
      }
    },
    [sel, requests],
  );

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.card }]}>
      <Header
        title={t('nav.privateMessages')}
        safeTop={false}
        actions={[{ icon: 'fa-user-plus', label: t('friends.addFriend'), onPress: openAddFriendSheet }]}
      />
      <FlashList
        data={data}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
        extraData={sel}
        contentContainerStyle={{ paddingTop: 6, paddingBottom: 12 + bottomInset }}
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
  inset: { marginHorizontal: 8, marginVertical: 1 },
  shortcutIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: { paddingStart: 18, paddingEnd: 8 },
  status: { paddingHorizontal: 18, paddingVertical: 8 },
});
