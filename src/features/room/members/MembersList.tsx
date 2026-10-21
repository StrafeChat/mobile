/**
 * The member list of a group PM or a space channel / thread (the web's RoomMembersSidebar):
 *
 * - a group: "Members — N", online members by name, then offline ones dimmed;
 * - a space: one section per hoisted role (highest first) for the online members whose
 *   highest hoisted role it is, then "Online — N", then "Offline — N" (dimmed) - only the
 *   people who can see the channel.
 *
 * A row: avatar with presence, the name in its role colour (in a space, their space profile's
 * nickname and avatar), BOT tag, the crown for the group's creator or the space's owner, and
 * the custom status (or status) while online. Search matches the nickname, the global name and
 * the username.
 * Tap: the profile sheet (with role editing where allowed). Long press: the user menu plus
 * Remove from group / Kick / Ban. A group's creator also gets a remove button on each row.
 * The list grouping is the data layer's port of the web's (useMemberList).
 */
import { memo, useMemo, useState } from 'react';
import { RefreshControl, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadSpaceMembers } from '@web/stores/spaceMembers';
import { t } from '@web/i18n/t';
import {
  memberRowView,
  useMemberList,
  useMemberRow,
  useMyId,
  usePmRoom,
  useRoomInfo,
  useSpaceMembersLoading,
  type MemberListItem,
  type MemberSource,
} from '@/data';
import { useTheme } from '@/theme';
import {
  BotTag,
  EmptyState,
  Icon,
  IconButton,
  ListRow,
  SearchInput,
  SheetFlashList,
  SkeletonRow,
  Text,
  UserAvatar,
  haptics,
  showActionSheet,
  toast,
  useLongPress,
} from '@/ui';
import { showUserProfile } from '../profile/present';
import { openAddPeopleSheet } from '@/features/nav';
import { removeFromGroup } from '../roomActions';
import { errorMessage } from '../util';
import { memberMenuItems } from './memberActions';

export interface MembersListProps {
  roomId: string;
  spaceId: string | null;
  /** Inside a bottom sheet (uses the sheet's scrollable). */
  inSheet?: boolean;
  /** Pad below the status bar (the shell's drawer). */
  safeTop?: boolean;
}

/** The members a room lists: a group's participants, or who can see a space channel. */
export function memberSourceFor(kind: string | undefined, roomId: string, spaceId: string | null): MemberSource | null {
  if (kind === 'group') return { pmRoomId: roomId };
  if ((kind === 'text' || kind === 'thread') && spaceId) return { spaceId, roomId };
  return null;
}

interface RowProps {
  source: MemberSource;
  userId: string;
  dim: boolean;
  roomId: string;
  spaceId: string | null;
  /** Group creator: offer removing others. */
  canRemove: boolean;
}

const MemberRow = memo(function MemberRow({ source, userId, dim, roomId, spaceId, canRemove }: RowProps) {
  const theme = useTheme();
  const row = useMemberRow(source, userId);
  const me = useMyId();
  const longPress = useLongPress(() => {
    if (!row) return;
    void showActionSheet(memberMenuItems(row, { spaceId, roomId }), { title: row.displayName, subtitle: row.username });
  });
  if (!row) return null;
  const isSelf = row.id === me;
  return (
    <ListRow
      inset
      title={row.displayName}
      titleColor={row.nameColor}
      subtitle={row.subline}
      leading={<UserAvatar userId={row.id} uri={row.avatar} name={row.displayName} size="md" ringColor={theme.colors.card} />}
      titleAccessory={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginStart: 4 }}>
          <BotTag bot={row.bot} size="xs" />
          {row.isOwner ? <Icon name="crown" size={11} color={theme.colors.warning} accessibilityLabel={t('room.members.owner')} /> : null}
        </View>
      }
      trailing={
        canRemove && !isSelf ? (
          <IconButton
            icon="user-minus"
            tone="danger"
            size="sm"
            label={t('room.members.removeNamed', { name: row.displayName })}
            onPress={() => void removeFromGroup(roomId, row.id, row.displayName)}
          />
        ) : undefined
      }
      onPress={() => showUserProfile(row.id, { roomId, spaceId })}
      {...longPress}
      style={dim ? { opacity: 0.6 } : undefined}
      testID={`member-${row.id}`}
    />
  );
});

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <Text variant="overline" style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }} accessibilityRole="header">
      {t('room.members.section', { label, count })}
    </Text>
  );
}

export function MembersList({ roomId, spaceId, inSheet, safeTop }: MembersListProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const info = useRoomInfo(roomId, spaceId);
  const room = usePmRoom(info?.kind === 'group' ? roomId : null);
  const me = useMyId();
  const source = useMemo(() => memberSourceFor(info?.kind, roomId, info?.spaceId ?? spaceId), [info?.kind, roomId, info?.spaceId, spaceId]);
  const items = useMemberList(source ?? { pmRoomId: '' });
  const loading = useSpaceMembersLoading(source && 'spaceId' in source ? source.spaceId : '');
  const [query, setQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const isCreator = info?.kind === 'group' && !!room?.creator_id && room.creator_id !== '0' && room.creator_id === me;
  const sid = source && 'spaceId' in source ? source.spaceId : null;

  const shown: MemberListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    // The list's own heading says "Members — N"; the group list's leading header would repeat it.
    if (!q || !source) return items.filter((it) => !(it.kind === 'header' && it.group === 'members'));
    return items.filter((it) => {
      if (it.kind !== 'member') return false;
      const r = memberRowView(source, it.userId);
      // The shown name is a space nickname when one applies; the global name still finds them.
      return !!r && [r.displayName, r.globalName, r.username].some((n) => !!n && n.toLowerCase().includes(q));
    });
  }, [items, query, source]);

  if (!source) return null;
  const memberCount = items.filter((i) => i.kind === 'member').length;
  const List = (inSheet ? SheetFlashList : FlashList) as typeof FlashList;

  async function refresh() {
    if (!sid) return;
    setRefreshing(true);
    try {
      await loadSpaceMembers(sid);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRefreshing(false);
    }
  }

  const header = (
    <View style={{ paddingTop: safeTop ? insets.top + 8 : 8, paddingHorizontal: 12, gap: 10, paddingBottom: 4 }}>
      <Text variant="heading" accessibilityRole="header" style={{ paddingHorizontal: 4 }}>
        {t('room.members.section', { label: t('room.members.title'), count: memberCount })}
      </Text>
      {memberCount > 8 ? <SearchInput value={query} onValueChange={setQuery} size="sm" /> : null}
      {info?.kind === 'group' ? (
        <ListRow
          inset
          title={t('room.addPeople')}
          icon="user-plus"
          iconColor={theme.colors.primary}
          onPress={() => {
            haptics.selection();
            openAddPeopleSheet(roomId);
          }}
        />
      ) : null}
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <List
        data={shown}
        keyExtractor={(it) => it.key}
        getItemType={(it) => it.kind}
        extraData={isCreator}
        ListHeaderComponent={header}
        ListEmptyComponent={
          loading ? (
            <View style={{ padding: 12, gap: 8 }}>
              <SkeletonRow avatar={32} />
              <SkeletonRow avatar={32} />
              <SkeletonRow avatar={32} />
            </View>
          ) : query ? (
            <EmptyState icon="magnifying-glass" body={t('mobile.room.noMembersMatch')} />
          ) : null
        }
        // Searching: a tap on a member opens them at once (not just puts the keyboard away),
        // and scrolling the results takes the keyboard down.
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={{ paddingBottom: insets.bottom + 16, paddingHorizontal: 4 }}
        refreshControl={sid && !inSheet ? <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={theme.colors.primary} colors={[theme.colors.primary]} /> : undefined}
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <SectionHeader label={item.label} count={item.count} />
          ) : (
            <MemberRow source={source} userId={item.userId} dim={item.dim} roomId={roomId} spaceId={sid} canRemove={isCreator} />
          )
        }
      />
    </View>
  );
}
