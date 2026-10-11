/**
 * Spaces: the rail, per-space badges and what the viewer may do in a space.
 *
 * Rail order is the store's order (READY order, new spaces appended) - the web has no space
 * folders and no rail reordering, so neither does this. The badge rules are SpaceBar's,
 * unchanged: unread counts text channels and *joined* threads (an unjoined thread never
 * lights a space), excludes the channel on screen, and does not skip muted channels;
 * mentions sum the server's per-room counters.
 */
import { useEffect } from 'react';
import { spaces, spaceRoles, ensureSpaceRoles, ensureSpaceRooms } from '@web/stores/spaces';
import type { Space, SpaceRole, SpaceRoom } from '@web/api/spaces';
import { rooms, isNotesRoom, sortRoomsByLastMessage } from '@web/stores/rooms';
import { readState, getUnreadCountForDisplay } from '@web/stores/readState';
import { messages } from '@web/stores/messages';
import { auth } from '@web/stores/auth';
import { spaceMembers, ensureSpaceMembers } from '@web/stores/spaceMembers';
import { lastSpaceRoom } from '@web/stores/lastSpaceRoom';
import { isRoomMuted } from '@web/lib/roomNotify';
import { incomingFriendRequests } from '@web/lib/mobileNotifications';
import {
  memberCanBanMembers,
  memberCanCreateInvite,
  memberCanKickMembers,
  memberCanManageEmojis,
  memberCanManageRoles,
  memberCanManageRooms,
  memberCanManageSpace,
  memberHighestRolePosition,
} from '@web/lib/spacePermissions';
import { snapshot, useSolid } from '@/bridge/solid';
import { deepEqual, sameArray, useDerived } from './derived';
import { ROOM_TYPE_GROUP, ROOM_TYPE_PM, ROOM_TYPE_TEXT, ROOM_TYPE_THREAD } from './constants';

// ---- selectors (reactive in Solid, plain functions everywhere else) ---------------------------

/** Two uppercase characters for a space without an icon (SpaceBar's spaceInitial). */
export function spaceInitials(space: { name_acronym?: string; name?: string }): string {
  const s = space.name_acronym || space.name || '?';
  return s.slice(0, 2).toUpperCase();
}

/**
 * Unread count behind a space's rail pip: text channels plus joined threads, from both the
 * space's room list and the rooms-store copies of its channels (deduped, space list first),
 * excluding the channel on screen - its cursor is being advanced live by the viewport ack.
 */
export function spaceUnreadCount(spaceId: string, viewingRoomId: string | null): number {
  const uid = auth.user?.id;
  if (!uid) return 0;
  const fromSpaceMap = spaces.spaceRoomsBySpaceId[spaceId] ?? [];
  const fromRoomsStore: SpaceRoom[] = rooms.rooms
    .filter((r) => r.space_id === spaceId)
    .map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name ?? '',
      topic: r.topic,
      thread: undefined,
      position: r.position ?? 0,
      parent_id: r.parent_id,
      last_message_id: r.last_message_id,
      last_read_message_id: r.last_read_message_id,
      mention_count: r.mention_count,
      created_at: r.created_at,
      updated_at: r.updated_at,
      space_id: r.space_id,
    }));
  const seen = new Set<string>();
  let total = 0;
  for (const r of [...fromSpaceMap, ...fromRoomsStore]) {
    if (!r?.id || seen.has(r.id)) continue;
    seen.add(r.id);
    if (!(r.type === ROOM_TYPE_TEXT || (r.type === ROOM_TYPE_THREAD && r.thread?.joined)) || r.id === viewingRoomId) {
      continue;
    }
    const meta = rooms.rooms.find((x) => x.id === r.id) ?? r;
    total += getUnreadCountForDisplay(
      r.id,
      { ...meta, space_id: meta.space_id ?? spaceId },
      messages.byRoom[r.id] ?? [],
      uid,
    );
  }
  return total;
}

/** Sum of the server's mention counters over the space's text channels and joined threads
 * (plus any of its channels mirrored into the rooms store). */
export function spaceMentionCount(spaceId: string): number {
  if (!auth.user?.id) return 0;
  const ids = new Set<string>();
  for (const r of spaces.spaceRoomsBySpaceId[spaceId] ?? []) {
    if (r.type === ROOM_TYPE_TEXT || (r.type === ROOM_TYPE_THREAD && r.thread?.joined)) ids.add(r.id);
  }
  for (const r of rooms.rooms) {
    if (r.space_id === spaceId && (r.type === ROOM_TYPE_TEXT || r.type === ROOM_TYPE_THREAD)) ids.add(r.id);
  }
  let total = 0;
  for (const id of ids) total += readState.byRoom[id]?.mentionCount ?? 0;
  return total;
}

/**
 * The PM avatars under the Home button: unmuted, unread, non-notes PMs and groups, newest
 * first. The open one counts as read, so its avatar leaves the rail as soon as it is opened.
 */
export function railDmRoomIds(activePmRoomId: string | null): string[] {
  const uid = auth.user?.id;
  if (!uid) return [];
  return sortRoomsByLastMessage(
    rooms.rooms.filter((r) => {
      if (!((r.type === ROOM_TYPE_PM || r.type === ROOM_TYPE_GROUP) && !r.space_id)) return false;
      if (isNotesRoom(r, uid)) return false;
      if (isRoomMuted(r) || r.id === activePmRoomId) return false;
      return getUnreadCountForDisplay(r.id, r, messages.byRoom[r.id] ?? [], uid) > 0;
    }),
  ).map((r) => r.id);
}

export interface SpaceAbilities {
  isOwner: boolean;
  canInvite: boolean;
  canManageSpace: boolean;
  canManageRoles: boolean;
  canManageRooms: boolean;
  canManageEmojis: boolean;
  canKickMembers: boolean;
  canBanMembers: boolean;
  /** The settings entry exists (Manage Space or Manage Roles), as in the space menu. */
  showSettings: boolean;
  /** The owner never leaves - they transfer or delete. */
  canLeave: boolean;
  /** Moderation ceiling: the viewer's highest role position, MAX_SAFE_INTEGER for the owner.
   * Kick/ban/role edits apply only to members strictly below it. */
  viewerHighestRolePosition: number;
}

/** Space-wide abilities from roles, exactly the memberCan* gates the web's menus use. */
export function spaceAbilities(
  space: Space | undefined,
  roles: SpaceRole[] | undefined,
  member: { id: string; roles?: string[] } | undefined,
  userId: string | undefined,
): SpaceAbilities {
  const isOwner = !!space && !!userId && space.owner_id === userId;
  const canManageSpace = memberCanManageSpace(space, roles, member, userId);
  const canManageRoles = memberCanManageRoles(space, roles, member, userId);
  return {
    isOwner,
    canInvite: memberCanCreateInvite(space, roles, member, userId),
    canManageSpace,
    canManageRoles,
    canManageRooms: memberCanManageRooms(space, roles, member, userId),
    canManageEmojis: memberCanManageEmojis(space, roles, member, userId),
    canKickMembers: memberCanKickMembers(space, roles, member, userId),
    canBanMembers: memberCanBanMembers(space, roles, member, userId),
    showSettings: canManageSpace || canManageRoles,
    canLeave: !isOwner,
    viewerHighestRolePosition: !userId
      ? -1
      : isOwner
        ? Number.MAX_SAFE_INTEGER
        : memberHighestRolePosition(space?.everyone_role_id, roles, member),
  };
}

/** The viewer's own member row in a space (roles, joined_at), if loaded. */
export function mySpaceMember(spaceId: string): { id: string; roles?: string[]; joined_at?: string } | undefined {
  const uid = auth.user?.id;
  if (!uid) return undefined;
  return spaceMembers.bySpaceId[spaceId]?.find((m) => m.id === uid);
}

// ---- hooks ----------------------------------------------------------------------------------------

/** Rail order. Re-renders only when a space is added, removed or reordered. */
export function useSpaceIds(): string[] {
  return useDerived('spaceIds', () => spaces.spaces.map((s) => s.id), sameArray);
}

export type SpaceView = Omit<Space, 'roles'> & { initials: string };

/** A space's own fields (no roles - see useSpaceRoles). Re-renders on SPACE_UPDATE. */
export function useSpace(spaceId: string | null | undefined): SpaceView | undefined {
  return useDerived(
    `space:${spaceId ?? ''}`,
    () => {
      const s = spaceId ? spaces.spaces.find((x) => x.id === spaceId) : undefined;
      if (!s) return undefined;
      // Role edits re-run this, but the result (without roles) compares equal: no re-render.
      const { roles: _roles, ...rest } = snapshot(s);
      return { ...rest, initials: spaceInitials(s) };
    },
    deepEqual,
  );
}

/** Whether the store has finished hydrating spaces (a missing space then means kicked/left,
 * not "not loaded yet" - SpacePage navigates home on that). */
export function useSpacesHydrated(): boolean {
  return useSolid(() => spaces.hydrated);
}

/** A space's roles, sorted by position ascending (undefined until known). Re-renders on
 * SPACE_ROLE_* events. */
export function useSpaceRoles(spaceId: string | null | undefined): SpaceRole[] | undefined {
  return useDerived(
    `spaceRoles:${spaceId ?? ''}`,
    () => {
      const roles = spaceId ? spaceRoles(spaceId) : undefined;
      return roles ? roles.map((r) => ({ ...r })) : undefined;
    },
    deepEqual,
  );
}

export interface SpaceBadges {
  /** Drives the white pip (no count is shown for plain unread). */
  unread: number;
  /** The red corner badge. */
  mentions: number;
}

/** A space's rail badges. Re-renders only when either number changes. */
export function useSpaceBadges(spaceId: string, viewingRoomId: string | null): SpaceBadges {
  return useDerived(
    `spaceBadges:${spaceId}:${viewingRoomId ?? ''}`,
    () => ({ unread: spaceUnreadCount(spaceId, viewingRoomId), mentions: spaceMentionCount(spaceId) }),
    deepEqual,
  );
}

/** Unread PM/group ids for the rail under Home. Re-renders when that set or its order changes. */
export function useRailDmIds(activePmRoomId: string | null): string[] {
  return useDerived(`railDms:${activePmRoomId ?? ''}`, () => railDmRoomIds(activePmRoomId), sameArray);
}

/** Incoming friend requests (the Home button's and Friends row's red badge). */
export function useFriendRequestCount(): number {
  return useDerived('friendRequestCount', () => incomingFriendRequests().length);
}

/** What the viewer may do in a space. Re-renders when roles, the viewer's roles or the owner change. */
export function useSpaceAbilities(spaceId: string | null | undefined): SpaceAbilities {
  return useDerived(
    `spaceAbilities:${spaceId ?? ''}`,
    () => {
      const sp = spaceId ? spaces.spaces.find((s) => s.id === spaceId) : undefined;
      const uid = auth.user?.id;
      return spaceAbilities(sp, sp?.roles, spaceId ? mySpaceMember(spaceId) : undefined, uid);
    },
    deepEqual,
  );
}

/** The room tapping the space lands in (localStorage 'strafe-last-space-room'), if any. */
export function useLastSpaceRoom(spaceId: string | null | undefined): string | undefined {
  return useSolid(() => (spaceId ? lastSpaceRoom.get(spaceId) : undefined), [spaceId]);
}

/**
 * What the web's space page and channel bar do on entry: roles (only when the space arrived
 * without them), the room list (only when the store has none) and the member list (once per
 * gateway session). All three are idempotent and coalesced, so mounting this in several
 * screens costs nothing extra.
 */
export function useEnsureSpaceData(spaceId: string | null | undefined): void {
  useEffect(() => {
    if (!spaceId) return;
    void ensureSpaceRoles(spaceId);
    void ensureSpaceRooms(spaceId);
    void ensureSpaceMembers(spaceId).catch(() => undefined);
  }, [spaceId]);
}
