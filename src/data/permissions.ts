/**
 * What the viewer may do in the open room - the gates SpacePage and RoomPage compute inline
 * and pass to the message list and composer, ported as one pure function each and one hook.
 *
 * Every bit decision goes through lib/spacePermissions (effectiveChannelPermissionsForMember,
 * channelOverridesSource for category sync and threads, canSendMessagesInChannel...), never
 * through bit math of our own. The loading behaviour is the web's, gate by gate: while roles or
 * overrides are unknown the mask is null, which is permissive for the viewer's own actions
 * (send, attach, react, pin/delete as the page shows them) and restrictive for anything that
 * could promise more than the server allows (@everyone, thread creation, moderation).
 */
import { useEffect, useState } from 'react';
import type { Space, SpaceMember, SpaceRole, SpaceRoom } from '@web/api/spaces';
import type { Room } from '@web/api/rooms';
import {
  PermAddReactions,
  PermCreatePrivateThreads,
  PermCreatePublicThreads,
  PermManageMessages,
  PermManageRooms,
  PermManageThreads,
  PermMentionEveryone,
  PermReadMessageHistory,
  PermSendMessagesInThreads,
  PermUseExternalEmojis,
  PermViewChannel,
  canAttachFilesInChannel,
  canSendMessagesInChannel,
  channelOverridesSource,
  effectiveChannelPermissionsForMember,
  hasPerm,
} from '@web/lib/spacePermissions';
import { verificationGate, gateApplies, formatWait, type VerificationGate } from '@web/lib/spaceVerification';
import { spaces } from '@web/stores/spaces';
import { auth } from '@web/stores/auth';
import { instance } from '@web/stores/instance';
import { t } from '@web/i18n/t';
import { deepEqual, useDerived } from './derived';
import { spaceAbilities, mySpaceMember } from './spaces';
import { findPmRoom, findSpaceRoom } from './rooms';
import { ROOM_TYPE_GROUP, ROOM_TYPE_PM, ROOM_TYPE_THREAD, isTextLike } from './constants';

/** Why the composer is replaced by a notice instead of an input. */
export type ComposerLock =
  | { kind: 'officialReadOnly' }
  | { kind: 'noPermission' }
  | { kind: 'threadLocked' }
  /** A space verification level; `unlockAt` (ms epoch) for the two age rules. */
  | { kind: 'verification'; requirement: VerificationGate['requirement']; unlockAt?: number };

export interface RoomGates {
  kind: 'pm' | 'space';
  /** The viewer's effective permission bits in the channel; null while unknown, and for PMs. */
  mask: number | null;
  /** Send Messages (threads: Send Messages In Threads, and Manage Threads when locked). */
  canSend: boolean;
  /** "Reply" in the message sheet (spaces: = canSend; PMs: always, as on the web). */
  canReply: boolean;
  /** Attach button, paste and voice notes. */
  canAttach: boolean;
  /** @everyone / @here offered in autocomplete (spaces: false while unknown; groups only). */
  canMentionEveryone: boolean;
  /** Manage Messages in the channel (SpacePage's canManageMessagesInRoom: true while the mask
   * is unknown); always false in PMs, where pins are open to everyone anyway (canPin). */
  canManageMessages: boolean;
  /** Pin/unpin, also in the pinned sheet (PMs: anyone; spaces: Manage Messages). */
  canPin: boolean;
  /** Delete other people's messages (spaces with Manage Messages only). */
  canDeleteOthers: boolean;
  /** Start a new reaction (Add Reactions). */
  canReact: boolean;
  /** Tap an existing reaction to join it (Read Message History). */
  canJoinReactions: boolean;
  /** Restrict emoji pickers to this space's emoji (no Use External Emojis). */
  customEmojiSpaceId?: string;
  canCreatePublicThreads: boolean;
  canCreatePrivateThreads: boolean;
  canManageThreads: boolean;
  /** "Create thread" on a message: a space text channel (not a thread) + Create Public Threads. */
  canOfferCreateThread: boolean;
  canManageRoles: boolean;
  canKickMembers: boolean;
  canBanMembers: boolean;
  /** MAX_SAFE_INTEGER for the owner; kick/ban/role edits only below it. */
  viewerHighestRolePosition: number;
  /** Seconds this viewer waits between messages here (0: off or exempt). */
  slowmodeSeconds: number;
  /** The composer's notice, before the countdown is applied - see useComposerLock. */
  lock: ComposerLock | null;
}

export interface ChannelGatesInput {
  space: Space;
  room: SpaceRoom;
  /** The space's room list (sections and parent channels resolve overrides). */
  allRooms: SpaceRoom[];
  roles: SpaceRole[] | undefined;
  /** The viewer's member row (roles, joined_at), if loaded. */
  member: SpaceMember | undefined;
  userId: string | undefined;
  verifiedEmail: boolean | undefined;
  accountCreatedAt: string | undefined;
  emailEnabled: boolean;
}

/** SpacePage's myChannelMask: null while anything it needs is unknown (permissive). */
export function channelMask(input: Pick<ChannelGatesInput, 'space' | 'room' | 'allRooms' | 'roles' | 'member' | 'userId'>): number | null {
  const { space, room, allRooms, roles, member, userId } = input;
  if (!userId || !isTextLike(room.type)) return null;
  const { overrides, userOverrides } = channelOverridesSource(room, allRooms);
  if (roles === undefined || overrides === undefined || userOverrides === undefined) return null;
  return effectiveChannelPermissionsForMember({
    memberUserId: userId,
    ownerId: space.owner_id,
    everyoneRoleId: space.everyone_role_id,
    memberRoleIds: member?.roles,
    roles,
    overrides,
    userOverrides,
  });
}

/** Every gate for a space text channel or thread (SpacePage, memo by memo). */
export function channelGates(input: ChannelGatesInput): RoomGates {
  const { space, room } = input;
  const mask = channelMask(input);
  const isThread = room.type === ROOM_TYPE_THREAD;
  const textLike = isTextLike(room.type);
  const has = (bit: number) => mask !== null && hasPerm(mask, bit);

  let canSend: boolean;
  if (!isThread) canSend = canSendMessagesInChannel(mask);
  else if (mask === null) canSend = true;
  else if (!hasPerm(mask, PermViewChannel) || !hasPerm(mask, PermSendMessagesInThreads)) canSend = false;
  else canSend = !(room.thread?.locked && !hasPerm(mask, PermManageThreads));

  const canCreatePublicThreads = has(PermViewChannel) && has(PermCreatePublicThreads);
  const canManageMessages = !textLike || mask === null ? true : hasPerm(mask, PermManageMessages);
  const secs = room.slowmode_seconds ?? 0;
  const exempt = mask !== null && (hasPerm(mask, PermManageMessages) || hasPerm(mask, PermManageRooms));
  const abilities = spaceAbilities(space, input.roles, input.member, input.userId);

  let lock: ComposerLock | null = null;
  if (!canSend) lock = isThread && room.thread?.locked ? { kind: 'threadLocked' } : { kind: 'noPermission' };
  else {
    const gate = verificationGate({
      space,
      member: input.member,
      channelMask: mask,
      verifiedEmail: input.verifiedEmail,
      accountCreatedAt: input.accountCreatedAt,
      emailEnabled: input.emailEnabled,
    });
    if (gate) lock = { kind: 'verification', requirement: gate.requirement, ...(gate.unlockAt ? { unlockAt: gate.unlockAt } : {}) };
  }

  return {
    kind: 'space',
    mask,
    canSend,
    canReply: canSend,
    canAttach: canAttachFilesInChannel(mask),
    canMentionEveryone: textLike && has(PermMentionEveryone),
    canManageMessages,
    canPin: canManageMessages,
    canDeleteOthers: canManageMessages,
    canReact: !textLike || mask === null ? true : hasPerm(mask, PermAddReactions),
    canJoinReactions: !textLike || mask === null ? true : hasPerm(mask, PermReadMessageHistory),
    ...(mask === null || hasPerm(mask, PermUseExternalEmojis) ? {} : { customEmojiSpaceId: space.id }),
    canCreatePublicThreads,
    canCreatePrivateThreads: has(PermViewChannel) && has(PermCreatePrivateThreads),
    canManageThreads: has(PermManageThreads),
    canOfferCreateThread: !isThread && textLike && canCreatePublicThreads,
    canManageRoles: abilities.canManageRoles,
    canKickMembers: abilities.canKickMembers,
    canBanMembers: abilities.canBanMembers,
    viewerHighestRolePosition: abilities.viewerHighestRolePosition,
    slowmodeSeconds: secs > 0 && !exempt ? secs : 0,
    lock,
  };
}

/** PMs, groups and Notes (RoomPage): the composer is closed only in a 1:1 with the instance's
 * official account; @everyone only in groups; pins are anyone's; nobody deletes others'. */
export function pmGates(room: Pick<Room, 'type' | 'participants'>, userId: string | undefined): RoomGates {
  const other = room.type === ROOM_TYPE_PM ? room.participants?.find((p) => p.id !== userId) : undefined;
  const official = room.type === ROOM_TYPE_PM && other?.system === true;
  return {
    kind: 'pm',
    mask: null,
    canSend: !official,
    canReply: true,
    canAttach: true,
    canMentionEveryone: room.type === ROOM_TYPE_GROUP,
    canManageMessages: false,
    canPin: true,
    canDeleteOthers: false,
    canReact: true,
    canJoinReactions: true,
    canCreatePublicThreads: false,
    canCreatePrivateThreads: false,
    canManageThreads: false,
    canOfferCreateThread: false,
    canManageRoles: false,
    canKickMembers: false,
    canBanMembers: false,
    viewerHighestRolePosition: -1,
    slowmodeSeconds: 0,
    lock: official ? { kind: 'officialReadOnly' } : null,
  };
}

/** The gates for a room from the stores, PM or space; undefined while the room is unknown. */
export function roomGates(roomId: string, spaceId?: string | null): RoomGates | undefined {
  const uid = auth.user?.id;
  const pmRoom = findPmRoom(roomId);
  if (pmRoom) return pmGates(pmRoom, uid);
  const found = findSpaceRoom(roomId, spaceId);
  if (found) {
    const sp = spaces.spaces.find((s) => s.id === found.spaceId);
    if (!sp) return undefined;
    return channelGates({
      space: sp,
      room: found.room,
      allRooms: spaces.spaceRoomsBySpaceId[found.spaceId] ?? [],
      roles: sp.roles,
      member: mySpaceMember(found.spaceId) as SpaceMember | undefined,
      userId: uid,
      verifiedEmail: auth.user?.verified_email,
      accountCreatedAt: auth.user?.created_at,
      emailEnabled: instance.email.enabled,
    });
  }
  return undefined;
}

/** Re-renders when any gate changes (roles, overrides, the viewer's roles, thread lock...). */
export function useRoomGates(roomId: string | null | undefined, spaceId?: string | null): RoomGates | undefined {
  return useDerived(
    `roomGates:${roomId ?? ''}:${spaceId ?? ''}`,
    () => (roomId ? roomGates(roomId, spaceId) : undefined),
    deepEqual,
  );
}

// ---- the composer's notice -------------------------------------------------------------------------

export interface ComposerLockState {
  lock: ComposerLock | null;
  /** The notice in the web's words (with a live m:ss countdown for the age rules). */
  text: string | null;
}

/** The line the composer shows instead of an input, in the web's strings. */
export function composerLockText(lock: ComposerLock, now: number): string {
  switch (lock.kind) {
    case 'officialReadOnly':
      return t('room.officialReadOnly');
    case 'noPermission':
      return t('space.noSendPermission');
    case 'threadLocked':
      return t('threads.lockedNotice');
    case 'verification': {
      if (lock.requirement === 'email') return t('space.verification.email');
      const time = formatWait((lock.unlockAt ?? now) - now);
      return lock.requirement === 'account_age'
        ? t('space.verification.accountAge', { time })
        : t('space.verification.memberAge', { time });
    }
  }
}

/**
 * The composer's lock with its countdown applied: an age rule ticks once a second until it
 * lifts (then the lock is null and the input comes back), the way SpacePage runs its timer only
 * while a countdown is pending.
 */
export function useComposerLock(roomId: string | null | undefined, spaceId?: string | null): ComposerLockState {
  const gates = useRoomGates(roomId, spaceId);
  const lock = gates?.lock ?? null;
  const unlockAt = lock?.kind === 'verification' ? lock.unlockAt : undefined;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!unlockAt) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= unlockAt) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [unlockAt]);
  if (!lock) return { lock: null, text: null };
  if (lock.kind === 'verification') {
    const gate: VerificationGate = { requirement: lock.requirement, ...(lock.unlockAt ? { unlockAt: lock.unlockAt } : {}) };
    if (!gateApplies(gate, now)) return { lock: null, text: null };
  }
  return { lock, text: composerLockText(lock, now) };
}

// ---- the message action sheet ------------------------------------------------------------------------

export type MessageAction =
  | 'addReaction'
  | 'copyText'
  | 'copyId'
  | 'reply'
  | 'createThread'
  | 'pin'
  | 'unpin'
  | 'report'
  | 'edit'
  | 'delete';

/**
 * The long-press sheet's actions in the web context menu's order and with its gates. System
 * messages have no menu. (Delete always confirms on mobile - there is no Shift-click.)
 */
export function messageActions(
  msg: { sender_id: string; pinned?: boolean; thread_id?: string; system_type?: string },
  currentUserId: string | null | undefined,
  gates: Pick<RoomGates, 'canReact' | 'canReply' | 'canPin' | 'canDeleteOthers' | 'canOfferCreateThread'>,
): MessageAction[] {
  if (msg.system_type) return [];
  const own = !!currentUserId && msg.sender_id === currentUserId;
  const out: MessageAction[] = [];
  if (gates.canReact) out.push('addReaction');
  out.push('copyText', 'copyId');
  if (gates.canReply) out.push('reply');
  if (gates.canOfferCreateThread && !msg.thread_id) out.push('createThread');
  if (gates.canPin) out.push(msg.pinned ? 'unpin' : 'pin');
  if (!own) out.push('report');
  if (own) out.push('edit');
  if (own || gates.canDeleteOthers) out.push('delete');
  return out;
}
