/**
 * People: presence, relationships, and how a user is shown in a given room.
 *
 * A user's display data comes from wherever the room knows them: a space's member list, a
 * PM's participants, or - for someone the client never cached (left the space, a bot, an
 * uncached member) - the author/mention/reply users the server embeds on messages. That is the
 * web's augmentParticipants rule, applied per user instead of rebuilding the whole pool.
 * Profile subjects always come from the web's two canonical builders
 * (lib/userProfilePopoverHelpers) so badges, roles and home domain match the web exactly.
 *
 * Inside a space, the person's space profile (nickname, space avatar...) overlays their global
 * one - for yourself too, from your own member row. The web's builders do that themselves
 * (getSenderDisplay over the member row, popoverSubjectFromParticipant /
 * popoverSubjectFromSender given the space), so every surface that names a person through
 * userDisplay or profileSubject gets it.
 */
import type { RoomParticipant } from '@web/api/rooms';
import type { UserProfilePopoverSubject } from '@web/stores/userProfilePopover';
import type { Relationship } from '@web/api/relationships';
import { auth } from '@web/stores/auth';
import { presence, isPresentStatus, isVisibleStatus, type UserPresence } from '@web/stores/presence';
import { relationships, relationshipType, RelType } from '@web/stores/relationships';
import { rooms } from '@web/stores/rooms';
import { spaceRoles } from '@web/stores/spaces';
import { spaceMembers } from '@web/stores/spaceMembers';
import { messages } from '@web/stores/messages';
import { getSenderDisplay, type SenderDisplay } from '@web/components/messageList/utils';
import { popoverSubjectFromParticipant, popoverSubjectFromSender } from '@web/lib/userProfilePopoverHelpers';
import { memberNameColorHex } from '@web/lib/spacePermissions';
import { badgesFor, type BadgeDef } from '@web/lib/badges';
import { snapshot } from '@/bridge/solid';
import { deepEqual, sameArray, useDerived } from './derived';
import { spaceIdOfRoom } from './rooms';
import { spaceMemberOf } from './spaceProfileCompat';

export { badgesFor, type BadgeDef };

// ---- presence ---------------------------------------------------------------------------------------

/** A user's presence as the status dot shows it: 'offline' when unknown (PresenceDot's rule). */
export function presenceOf(userId: string): UserPresence {
  const p = presence.byUser[userId];
  return { status: p?.status ?? 'offline', ...(p?.custom_status ? { custom_status: p.custom_status } : {}) };
}

/** Re-renders on that user's PRESENCE_UPDATE only. */
export function usePresence(userId: string | null | undefined): UserPresence {
  return useDerived(`presence:${userId ?? ''}`, () => (userId ? presenceOf(userId) : { status: 'offline' as const }), deepEqual);
}

/** The custom status line - shown only while the person is online/idle/dnd (an offline user's
 * status reads as if they were around). `fallback` is a participant's embedded presence, used
 * when the live map has nothing. */
export function presentCustomStatus(userId: string, fallback?: UserPresence): string | undefined {
  const st = presence.byUser[userId]?.status ?? fallback?.status;
  if (!isPresentStatus(st)) return undefined;
  return presence.byUser[userId]?.custom_status ?? fallback?.custom_status ?? undefined;
}

// ---- relationships -------------------------------------------------------------------------------------

/** RelType of the viewer to `userId` (None 0, Friend 1, Blocked 2, Incoming 3, Outgoing 4...). */
export function useRelationshipType(userId: string | null | undefined): number {
  return useDerived(`relType:${userId ?? ''}`, () => (userId ? relationshipType(userId) : RelType.None));
}

export function useIsBlocked(userId: string | null | undefined): boolean {
  return useDerived(`blocked:${userId ?? ''}`, () => (userId ? relationshipType(userId) === RelType.Blocked : false));
}

export type FriendsFilter = 'online' | 'all' | 'pending' | 'blocked';

/** The Friends screen's tabs: ids (the other user's) in the store's order. 'pending' holds
 * incoming then outgoing requests; 'online' is FriendsPage's onlineFriends: online or idle
 * (isVisibleStatus - dnd is not listed) by the live presence or the relationship's own. */
export function friendIds(filter: FriendsFilter): string[] {
  const list = relationships.relationships;
  const ids = (pred: (r: Relationship) => boolean) => list.filter(pred).map((r) => r.user.id);
  switch (filter) {
    case 'all':
      return ids((r) => r.type === RelType.Friend);
    case 'online':
      return ids(
        (r) =>
          r.type === RelType.Friend &&
          (isVisibleStatus(presence.byUser[r.user.id]?.status) || isVisibleStatus(r.user.presence?.status)),
      );
    case 'pending':
      return [
        ...ids((r) => r.type === RelType.IncomingRequest),
        ...ids((r) => r.type === RelType.OutgoingRequest),
      ];
    case 'blocked':
      return ids((r) => r.type === RelType.Blocked);
  }
}

/** Re-renders when the tab's membership or order changes. */
export function useFriendIds(filter: FriendsFilter): string[] {
  return useDerived(`friends:${filter}`, () => friendIds(filter), sameArray);
}

/** One relationship row (the other user, type, since). Re-renders on that row's changes. */
export function useRelationship(userId: string): Relationship | undefined {
  return useDerived(
    `relationship:${userId}`,
    () => {
      const r = relationships.relationships.find((x) => x.user.id === userId || x.id === userId);
      return r ? snapshot(r) : undefined;
    },
    deepEqual,
  );
}

// ---- who a user is in a room -----------------------------------------------------------------------

/** Where to look a user up: a room (its space's members or its participants) and/or a space. */
export interface UserContext {
  roomId?: string | null;
  spaceId?: string | null;
}

/**
 * The richest participant record for `userId` in a context: space member, then room
 * participant, then a user embedded on that room's loaded messages (author, mention_users,
 * referenced_message.author - first found, oldest message first, as augmentParticipants adds them).
 */
export function findParticipant(userId: string, ctx: UserContext): (RoomParticipant & { roles?: string[]; joined_at?: string }) | undefined {
  const spaceId = ctx.spaceId ?? (ctx.roomId ? spaceIdOfRoom(ctx.roomId) : undefined);
  if (spaceId) {
    const m = spaceMembers.bySpaceId[spaceId]?.find((x) => x.id === userId);
    if (m) return m;
  }
  if (ctx.roomId) {
    const p = rooms.rooms.find((r) => r.id === ctx.roomId)?.participants?.find((x) => x.id === userId);
    if (p) return p;
    for (const m of messages.byRoom[ctx.roomId] ?? []) {
      if (m.author?.id === userId) return m.author;
      const mu = m.mention_users?.find((u) => u.id === userId);
      if (mu) return mu;
      if (m.referenced_message?.author?.id === userId) return m.referenced_message.author;
    }
  }
  const rel = relationships.relationships.find((r) => r.user.id === userId);
  return rel ? (rel.user as RoomParticipant) : undefined;
}

/** SenderDisplay (whose `name` is the space nickname when one applies, `globalName` their
 * global name and `nick` the nickname) plus the role colour. */
export interface UserDisplay extends SenderDisplay {
  /** Highest coloured role in the context's space (hoisted first). */
  nameColor?: string;
}

/** How a message author / mention / typer is shown: getSenderDisplay over the resolved
 * participant (yourself comes from auth.user), which in a space is the member row and so
 * carries their space profile, plus their role colour in a space. */
export function userDisplay(userId: string, ctx: UserContext): UserDisplay {
  const me = auth.user?.id;
  const spaceId = ctx.spaceId ?? (ctx.roomId ? spaceIdOfRoom(ctx.roomId) : undefined);
  // The space member is what findParticipant returns first anyway.
  const p = spaceMemberOf(spaceId, userId) ?? findParticipant(userId, ctx);
  const s = getSenderDisplay(userId, p ? [p] : [], me);
  const nameColor = spaceId ? memberNameColorHex(p?.roles, spaceRoles(spaceId)) : undefined;
  return { ...s, ...(nameColor ? { nameColor } : {}) };
}

/** Re-renders when that person's name, avatar, badges or role colour change. */
export function useUserDisplay(userId: string | null | undefined, ctx: UserContext = {}): UserDisplay | undefined {
  const roomId = ctx.roomId ?? null;
  const spaceId = ctx.spaceId ?? null;
  return useDerived(
    `userDisplay:${userId ?? ''}:${roomId ?? ''}:${spaceId ?? ''}`,
    () => (userId ? userDisplay(userId, { roomId, spaceId }) : undefined),
    deepEqual,
  );
}

/** The profile sheet's subject, built by the web's canonical builders, which in a space show
 * the space profile (from the member row) and set `spaceId` - what the sheet's Edit Space
 * Profile / Change Nickname hang on (selectors.test.ts guards it) - and `globalName` when a
 * nickname replaces the name. */
export function profileSubject(userId: string, ctx: UserContext): UserProfilePopoverSubject {
  const spaceId = ctx.spaceId ?? (ctx.roomId ? spaceIdOfRoom(ctx.roomId) : undefined);
  const roles = spaceId ? spaceRoles(spaceId) : undefined;
  const p = spaceMemberOf(spaceId, userId) ?? findParticipant(userId, ctx);
  return p && userId !== auth.user?.id
    ? popoverSubjectFromParticipant(p, roles, spaceId ? { spaceId } : undefined)
    : popoverSubjectFromSender(getSenderDisplay(userId, p ? [p] : [], auth.user?.id), {
        ...(p ? { participant: p } : {}),
        ...(roles ? { spaceRoles: roles } : {}),
        ...(spaceId ? { spaceId } : {}),
      });
}

/** Re-renders when anything the profile sheet shows changes. */
export function useProfileSubject(userId: string | null | undefined, ctx: UserContext = {}): UserProfilePopoverSubject | undefined {
  const roomId = ctx.roomId ?? null;
  const spaceId = ctx.spaceId ?? null;
  return useDerived(
    `profileSubject:${userId ?? ''}:${roomId ?? ''}:${spaceId ?? ''}`,
    () => (userId ? profileSubject(userId, { roomId, spaceId }) : undefined),
    deepEqual,
  );
}
