/**
 * Member lists for the right-hand drawer: a space channel's members (grouped by hoisted role
 * and presence, like the web sidebar) or a group PM's participants.
 *
 * The list hook returns ids and section headers only; each row reads its own view with
 * useMemberRow, so a presence change re-renders that row - and the list only when the person
 * moves between sections.
 */
import { useEffect } from 'react';
import type { RoomParticipant } from '@web/api/rooms';
import type { SpaceMember } from '@web/api/spaces';
import { spaces, spaceRoles } from '@web/stores/spaces';
import { spaceMembers, ensureSpaceMembers } from '@web/stores/spaceMembers';
import { rooms } from '@web/stores/rooms';
import { presence } from '@web/stores/presence';
import { channelOverridesSource, memberNameColorHex } from '@web/lib/spacePermissions';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { deepEqual, useDerived } from './derived';
import { buildMemberList, isOnlineStatus, membersWhoCanView, type MemberListItem } from './memberList';
import { isTextLike } from './constants';

/** Whose members: a space (optionally narrowed to who can see one of its channels), or a group PM. */
export type MemberSource = { spaceId: string; roomId?: string | null } | { pmRoomId: string };

function sourceKey(source: MemberSource): string {
  return 'pmRoomId' in source ? `pm:${source.pmRoomId}` : `space:${source.spaceId}:${source.roomId ?? ''}`;
}

/**
 * The people a source lists: a group's participants, or the space's members filtered to those
 * with View Channel in the open text channel/thread (SpacePage.visibleMembers).
 */
export function sourceMembers(source: MemberSource): (RoomParticipant & { roles?: string[]; joined_at?: string })[] {
  if ('pmRoomId' in source) return rooms.rooms.find((r) => r.id === source.pmRoomId)?.participants ?? [];
  const { spaceId, roomId } = source;
  const members: SpaceMember[] = spaceMembers.bySpaceId[spaceId] ?? [];
  const sp = spaces.spaces.find((s) => s.id === spaceId);
  const all = spaces.spaceRoomsBySpaceId[spaceId];
  const room = roomId ? all?.find((r) => r.id === roomId) : undefined;
  if (!roomId || !sp || !room || !isTextLike(room.type)) return members;
  const { overrides, userOverrides } = channelOverridesSource(room, all);
  return membersWhoCanView(members, {
    ownerId: sp.owner_id,
    everyoneRoleId: sp.everyone_role_id,
    roles: spaceRoles(spaceId),
    overrides,
    userOverrides,
  });
}

function statusOf(m: RoomParticipant): string | undefined {
  return presence.byUser[m.id]?.status ?? m.presence?.status;
}

/** The grouped list for a source (see memberList.ts for the rules). */
export function memberListItems(source: MemberSource): MemberListItem[] {
  const isSpace = !('pmRoomId' in source);
  return buildMemberList({
    members: sourceMembers(source),
    roles: isSpace ? spaceRoles(source.spaceId) : undefined,
    statusOf,
    labels: { online: t('presence.online'), offline: t('presence.offline'), members: t('room.members.title') },
    showMembersHeader: !isSpace,
  });
}

/**
 * The drawer's list: section headers and member ids, flat for a FlashList. Fetches a space's
 * members on first use (once per gateway session, as the web's space page does). Re-renders
 * when someone joins, leaves, changes role, or crosses online/offline.
 */
export function useMemberList(source: MemberSource): MemberListItem[] {
  const key = sourceKey(source);
  const spaceId = 'pmRoomId' in source ? null : source.spaceId;
  useEffect(() => {
    if (spaceId) void ensureSpaceMembers(spaceId).catch(() => undefined);
  }, [spaceId]);
  return useDerived(`memberList:${key}`, () => memberListItems(source), deepEqual);
}

/** Ids of the people who can see a channel (or a group's participants) - for mention
 * autocomplete and similar. Re-renders when that set changes. */
export function useMemberIds(source: MemberSource): string[] {
  return useDerived(`memberIds:${sourceKey(source)}`, () => sourceMembers(source).map((m) => m.id), deepEqual);
}

/** Whether a space's member list is loading for the first time (nothing cached yet). */
export function useSpaceMembersLoading(spaceId: string): boolean {
  return useSolid(
    () => !!spaceMembers.loading[spaceId] && (spaceMembers.bySpaceId[spaceId]?.length ?? 0) === 0,
    [spaceId],
  );
}

export interface MemberRowView {
  id: string;
  displayName: string;
  username: string;
  avatar?: string;
  homeDomain?: string;
  /** Highest coloured role (hoisted first); undefined = normal foreground. */
  nameColor?: string;
  bot: boolean;
  system: boolean;
  /** Crown: the group's creator or the space's owner. */
  isOwner: boolean;
  status: string;
  online: boolean;
  /** Custom status, else the status label - only while online/idle/dnd. */
  subline?: string;
  roleIds: string[];
}

export function memberRowView(source: MemberSource, userId: string): MemberRowView | undefined {
  let p: (RoomParticipant & { roles?: string[] }) | undefined;
  let ownerId: string | undefined;
  let roles = undefined as ReturnType<typeof spaceRoles>;
  if ('pmRoomId' in source) {
    const room = rooms.rooms.find((r) => r.id === source.pmRoomId);
    p = room?.participants?.find((x) => x.id === userId);
    ownerId = room?.creator_id;
  } else {
    p = spaceMembers.bySpaceId[source.spaceId]?.find((x) => x.id === userId);
    ownerId = spaces.spaces.find((s) => s.id === source.spaceId)?.owner_id;
    roles = spaceRoles(source.spaceId);
  }
  if (!p) return undefined;
  const st = statusOf(p);
  const online = isOnlineStatus(st);
  const custom = presence.byUser[p.id]?.custom_status ?? p.presence?.custom_status;
  const roleIds = p.roles?.length ? [...p.roles] : [];
  const nameColor = memberNameColorHex(roleIds.length ? roleIds : undefined, roles);
  return {
    id: p.id,
    displayName: p.display_name || p.username || t('common.unknown'),
    username: p.username,
    ...(p.avatar ? { avatar: p.avatar } : {}),
    ...(p.home_domain ? { homeDomain: p.home_domain } : {}),
    ...(nameColor ? { nameColor } : {}),
    bot: p.bot === true,
    system: p.system === true,
    isOwner: ownerId != null && ownerId !== '' && ownerId === p.id,
    status: st ?? 'offline',
    online,
    ...(online ? { subline: custom || t(`presence.${st}`) } : {}),
    roleIds,
  };
}

/** One member row. Re-renders on that person's profile, roles or presence changing. */
export function useMemberRow(source: MemberSource, userId: string): MemberRowView | undefined {
  return useDerived(`memberRow:${sourceKey(source)}:${userId}`, () => memberRowView(source, userId), deepEqual);
}
