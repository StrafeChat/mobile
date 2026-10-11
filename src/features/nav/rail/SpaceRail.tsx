/**
 * The space rail (the web's SpaceBar): Home with the friend-request count, the unread PMs
 * under it, every space, then "add a space" and Discover.
 *
 * Badge rules are the web's (src/data useSpaceBadges / useRailDmIds): a space shows a white
 * edge pip for plain unread and a red count for mentions; a PM avatar appears here only while
 * it has unread messages and is not the one on screen. Tapping a space selects it - its rooms
 * show beside the rail - without opening a room, so nothing is marked read behind your back.
 * Long-press opens the space's menu (invite, settings, mark read, copy id, leave).
 */
import { memo, useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import {
  useFriendRequestCount,
  usePmRow,
  useRailDmIds,
  useSpace,
  useSpaceBadges,
  useSpaceIds,
} from '@/data';
import { openRoom, setSelectedSpaceId, shell } from '@/shell/state';
import { useTheme } from '@/theme';
import {
  Avatar,
  Badge,
  Icon,
  Touchable,
  UserAvatar,
  haptics,
  useLongPressActions,
  withAlpha,
} from '@/ui';
import { pmMenuEntries, spaceMenuEntries } from '../menus';
import { openCreateSpace, openDiscover } from '../navigation';
import { SpaceIcon } from '../SpaceIcon';
import { SpaceSheetHeader } from '../space/SpaceHeader';

export const RAIL_WIDTH = 72;
const ICON = 48;

type RailItem =
  | { kind: 'home'; key: string }
  | { kind: 'dm'; key: string; roomId: string }
  | { kind: 'divider'; key: string }
  | { kind: 'space'; key: string; spaceId: string }
  | { kind: 'add'; key: string }
  | { kind: 'discover'; key: string };

/** The rail's rows, in order. Pure, so the layout is testable. */
export function railItems(dmIds: readonly string[], spaceIds: readonly string[]): RailItem[] {
  return [
    { kind: 'home', key: 'home' },
    ...dmIds.map((roomId) => ({ kind: 'dm' as const, key: `dm:${roomId}`, roomId })),
    { kind: 'divider', key: 'divider-1' },
    ...spaceIds.map((spaceId) => ({ kind: 'space' as const, key: `space:${spaceId}`, spaceId })),
    ...(spaceIds.length > 0 ? [{ kind: 'divider' as const, key: 'divider-2' }] : []),
    { kind: 'add', key: 'add' },
    { kind: 'discover', key: 'discover' },
  ];
}

/** The PM on screen (it never shows on the rail), and the room on screen in general. */
function useActiveRoom(): { roomId: string | null; pmRoomId: string | null } {
  return useSolid(() => {
    const v = shell.view();
    if (v.kind !== 'room') return { roomId: null, pmRoomId: null };
    return { roomId: v.roomId, pmRoomId: v.spaceId ? null : v.roomId };
  });
}

/** The white pill at the rail's edge: tall when selected, short when unread. */
function EdgePill({ state }: { state: 'active' | 'unread' | 'none' }) {
  const theme = useTheme();
  if (state === 'none') return null;
  const height = state === 'active' ? 40 : 8;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.pill,
        { height, marginTop: -height / 2, backgroundColor: theme.colors.foreground },
      ]}
    />
  );
}

function RailSlot({ children, pill }: { children: React.ReactNode; pill: 'active' | 'unread' | 'none' }) {
  return (
    <View style={styles.slot}>
      <EdgePill state={pill} />
      {children}
    </View>
  );
}

const HomeButton = memo(function HomeButton() {
  const theme = useTheme();
  const selected = useSolid(() => shell.selectedSpaceId() === null);
  const requests = useFriendRequestCount();
  const label = [
    t('nav.privateMessages'),
    requests > 0 ? t('friends.pendingRequests', { count: requests }) : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <RailSlot pill={selected ? 'active' : 'none'}>
      <Touchable
        feedback="opacity"
        onPress={() => {
          haptics.selection();
          setSelectedSpaceId(null);
        }}
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        style={[
          styles.iconButton,
          {
            borderRadius: selected ? 16 : 24,
            backgroundColor: selected ? withAlpha(theme.colors.primary, 0.3) : withAlpha(theme.colors.primary, 0.12),
          },
        ]}
      >
        <Icon name="fa-house" size={20} color={selected ? theme.colors.foreground : theme.colors.mutedForeground} />
        {requests > 0 ? (
          <Badge count={requests} ringColor={theme.colors.background} style={styles.cornerBadge} accessibilityLabel={label} />
        ) : null}
      </Touchable>
    </RailSlot>
  );
});

const DmRailItem = memo(function DmRailItem({ roomId, activeRoomId }: { roomId: string; activeRoomId: string | null }) {
  const theme = useTheme();
  const row = usePmRow(roomId, activeRoomId);
  const menu = useLongPressActions(() => pmMenuEntries(roomId), { title: row?.name });
  if (!row) return null;
  const label = [row.name, t('mobile.notifications.unread', { count: row.unread })].join(', ');
  return (
    <RailSlot pill={row.unread > 0 ? 'unread' : 'none'}>
      <Touchable
        feedback="opacity"
        onPress={() => openRoom(roomId, null)}
        accessibilityLabel={label}
        style={styles.iconButton}
        {...menu}
      >
        {row.isGroup ? (
          <View style={[styles.groupIcon, { backgroundColor: theme.colors.muted, borderColor: withAlpha(theme.colors.border, 0.5) }]}>
            <Icon name="fa-user-group" size={18} tone="muted" />
          </View>
        ) : row.otherUserId ? (
          <UserAvatar userId={row.otherUserId} name={row.name} uri={row.avatar} size={ICON} ringColor={theme.colors.background} />
        ) : (
          <Avatar name={row.name} uri={row.avatar} size={ICON} />
        )}
        <Badge count={row.unread} ringColor={theme.colors.background} style={styles.cornerBadge} />
      </Touchable>
    </RailSlot>
  );
});

const SpaceRailItem = memo(function SpaceRailItem({ spaceId, viewingRoomId }: { spaceId: string; viewingRoomId: string | null }) {
  const theme = useTheme();
  const space = useSpace(spaceId);
  const badges = useSpaceBadges(spaceId, viewingRoomId);
  const selected = useSolid(() => shell.selectedSpaceId() === spaceId, [spaceId]);
  const name = space?.name || t('space.unnamed');
  const menu = useLongPressActions(() => spaceMenuEntries(spaceId, 'rail'), {
    header: <SpaceSheetHeader spaceId={spaceId} />,
  });
  if (!space) return null;
  const label = [
    name,
    badges.mentions > 0 ? t('mobile.notifications.mentioned', { count: badges.mentions }) : null,
    badges.mentions === 0 && badges.unread > 0 ? t('mobile.nav.unread') : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <RailSlot pill={selected ? 'active' : badges.unread > 0 ? 'unread' : 'none'}>
      <Touchable
        feedback="opacity"
        onPress={() => {
          haptics.selection();
          setSelectedSpaceId(spaceId);
        }}
        accessibilityLabel={label}
        accessibilityState={{ selected }}
        style={styles.iconButton}
        {...menu}
      >
        <SpaceIcon name={name} initials={space.initials} icon={space.icon} size={ICON} radius={selected ? 16 : 24} />
        {badges.mentions > 0 ? (
          <Badge count={badges.mentions} ringColor={theme.colors.background} style={styles.cornerBadge} />
        ) : null}
      </Touchable>
    </RailSlot>
  );
});

function RailAction({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <RailSlot pill="none">
      <Touchable
        feedback="opacity"
        onPress={onPress}
        accessibilityLabel={label}
        style={[styles.iconButton, { borderRadius: 24, backgroundColor: withAlpha(theme.colors.primary, 0.12) }]}
      >
        <Icon name={icon} size={20} color={theme.colors.primary} />
      </Touchable>
    </RailSlot>
  );
}

function RailDivider() {
  const theme = useTheme();
  return (
    <View style={styles.dividerSlot}>
      <View style={[styles.divider, { backgroundColor: theme.colors.border }]} />
    </View>
  );
}

export function SpaceRail({ bottomInset = 0 }: { bottomInset?: number }) {
  const theme = useTheme();
  const active = useActiveRoom();
  const dmIds = useRailDmIds(active.pmRoomId);
  const spaceIds = useSpaceIds();
  const data = useMemo(() => railItems(dmIds, spaceIds), [dmIds, spaceIds]);

  const renderItem = useCallback(
    ({ item }: { item: RailItem }) => {
      switch (item.kind) {
        case 'home':
          return <HomeButton />;
        case 'dm':
          return <DmRailItem roomId={item.roomId} activeRoomId={active.pmRoomId} />;
        case 'divider':
          return <RailDivider />;
        case 'space':
          return <SpaceRailItem spaceId={item.spaceId} viewingRoomId={active.roomId} />;
        case 'add':
          return <RailAction icon="fa-plus" label={t('space.addSpace')} onPress={openCreateSpace} />;
        case 'discover':
          return <RailAction icon="fa-compass" label={t('discover.title')} onPress={openDiscover} />;
      }
    },
    [active.pmRoomId, active.roomId],
  );

  return (
    <View style={[styles.rail, { backgroundColor: theme.colors.background }]}>
      <FlashList
        data={data}
        renderItem={renderItem}
        keyExtractor={(item) => item.key}
        getItemType={(item) => item.kind}
        extraData={active}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 8 + bottomInset }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { width: RAIL_WIDTH, flexShrink: 0 },
  slot: { width: RAIL_WIDTH, height: ICON + 8, alignItems: 'center', justifyContent: 'center' },
  pill: {
    position: 'absolute',
    start: 0,
    top: '50%',
    width: 4,
    borderTopEndRadius: 4,
    borderBottomEndRadius: 4,
  },
  iconButton: { width: ICON, height: ICON, alignItems: 'center', justifyContent: 'center' },
  groupIcon: {
    width: ICON,
    height: ICON,
    borderRadius: ICON / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  cornerBadge: { position: 'absolute', top: -4, end: -4 },
  dividerSlot: { width: RAIL_WIDTH, height: 10, alignItems: 'center', justifyContent: 'center' },
  divider: { width: 32, height: StyleSheet.hairlineWidth * 2, borderRadius: 1 },
});
