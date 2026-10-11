/**
 * A space's room list: the flattened tree and the per-row views its rows render.
 *
 * The list reads ids and structure only (useSpaceRoomTree); each row reads its own badge state
 * (useChannelRow / useThreadRow / useSectionRow), so a message in one channel re-renders that
 * one row - not the list, not its neighbours. Row rules are SpaceChannelRow's and
 * SpaceThreadRow's: unread is 0 for the room on screen; muted rooms show the bell-slash and
 * suppress the pip, the bold name and the mention pill.
 */
import { spaces } from '@web/stores/spaces';
import type { SpaceRoom } from '@web/api/spaces';
import { rooms } from '@web/stores/rooms';
import { readState, getUnreadCountForDisplay } from '@web/stores/readState';
import { messages } from '@web/stores/messages';
import { auth } from '@web/stores/auth';
import { voiceStatesForRoom } from '@web/stores/voice';
import { isRoomMuted } from '@web/lib/roomNotify';
import { canViewSpaceChannel, isRoomPrivate } from '@web/lib/spacePermissions';
import { useSolid } from '@/bridge/solid';
import { deepEqual, useDerived } from './derived';
import { collapsedSectionIds } from './collapsedSections';
import { buildSpaceRoomTree, type SpaceRoomTreeItem } from './spaceRoomTree';
import { mySpaceMember } from './spaces';
import { ROOM_TYPE_SECTION, ROOM_TYPE_TEXT, ROOM_TYPE_VOICE, latestSnowflakeId } from './constants';

/** canViewSpaceChannel for the signed-in user (permissive until roles/overrides are known). */
export function viewerCanSeeRoom(spaceId: string, room: SpaceRoom): boolean {
  const sp = spaces.spaces.find((s) => s.id === spaceId);
  return canViewSpaceChannel({
    room,
    allRooms: spaces.spaceRoomsBySpaceId[spaceId],
    memberUserId: auth.user?.id,
    ownerId: sp?.owner_id,
    everyoneRoleId: sp?.everyone_role_id,
    memberRoleIds: mySpaceMember(spaceId)?.roles,
    roles: sp?.roles,
  });
}

/** Unread count as a channel row computes it: the rooms-store copy's metadata when the channel
 * is mirrored there, else the space's copy (getUnreadCountForDisplay with the space id set). */
function channelUnread(spaceId: string, room: SpaceRoom): number {
  const uid = auth.user?.id;
  if (!uid) return 0;
  const meta = rooms.rooms.find((x) => x.id === room.id) ?? room;
  return getUnreadCountForDisplay(room.id, { ...meta, space_id: meta.space_id ?? spaceId }, messages.byRoom[room.id] ?? [], uid);
}

/** A thread or section child's unread as SpaceRoomsBar computes it (the space copy's metadata). */
function spaceCopyUnread(spaceId: string, room: SpaceRoom): number {
  const uid = auth.user?.id;
  if (!uid) return 0;
  return getUnreadCountForDisplay(room.id, { ...room, space_id: room.space_id ?? spaceId }, messages.byRoom[room.id] ?? [], uid);
}

function mentionCount(roomId: string): number {
  return readState.byRoom[roomId]?.mentionCount ?? 0;
}

/** The flattened room list (see spaceRoomTree.ts for the layout rules). */
export function spaceRoomTree(spaceId: string, activeRoomId: string | null, withVoiceUsers: boolean): SpaceRoomTreeItem[] {
  const all = spaces.spaceRoomsBySpaceId[spaceId] ?? [];
  return buildSpaceRoomTree({
    rooms: all,
    canView: (r) => viewerCanSeeRoom(spaceId, r),
    collapsedSectionIds: collapsedSectionIds(),
    activeRoomId,
    hasUnreadOrMention: (r) => mentionCount(r.id) > 0 || spaceCopyUnread(spaceId, r) > 0,
    ...(withVoiceUsers
      ? {
          voiceUserIds: (roomId: string) =>
            [...voiceStatesForRoom(roomId)].sort((a, b) => a.joined_at.localeCompare(b.joined_at)).map((s) => s.user_id),
        }
      : {}),
  });
}

/**
 * The space's room list, flattened for a FlashList (`key` for keyExtractor, `kind` for
 * getItemType). Voice occupants are rows of their own unless `withVoiceUsers` is false (then
 * render them inside the voice row with useVoiceOccupants). Re-renders when the structure
 * changes: rooms added/moved/renumbered, visibility, collapse, joined threads, voice joins -
 * and a collapsed section's dot - but not on ordinary messages.
 */
export function useSpaceRoomTree(
  spaceId: string,
  activeRoomId: string | null,
  opts: { withVoiceUsers?: boolean } = {},
): SpaceRoomTreeItem[] {
  const withVoice = opts.withVoiceUsers !== false;
  return useDerived(
    `spaceTree:${spaceId}:${activeRoomId ?? ''}:${withVoice ? 1 : 0}`,
    () => spaceRoomTree(spaceId, activeRoomId, withVoice),
    deepEqual,
  );
}

/** Whether the space's room list is known yet (the web shows "Loading…" until it is). */
export function useSpaceRoomsLoaded(spaceId: string): boolean {
  return useSolid(() => spaces.spaceRoomsBySpaceId[spaceId] !== undefined, [spaceId]);
}

// ---- rows ---------------------------------------------------------------------------------------------

export interface ChannelRowView {
  id: string;
  /** Raw name; '' when unnamed (the web shows a placeholder). */
  name: string;
  type: number;
  isVoice: boolean;
  /** Lock badge in the brand colour. */
  e2ee: boolean;
  /** Lock badge in the muted colour: @everyone is denied View (own or synced overrides). */
  isPrivate: boolean;
  muted: boolean;
  /** Text channels only; 0 for the room on screen. */
  unread: number;
  /** Text channels only; the server's counter. */
  mentions: number;
  showUnreadPip: boolean;
  bold: boolean;
  showMentionBadge: boolean;
  /** Voice rooms: people in it, and the cap (0 = none). */
  voiceCount: number;
  userLimit: number;
  showVoiceCount: boolean;
  /** For the long-press sheet: the menu's own unread test (not excluding the open room). */
  hasUnreadOrMentions: boolean;
  latestMessageId: string | null;
}

export function channelRowView(spaceId: string, roomId: string, activeRoomId: string | null): ChannelRowView | undefined {
  const room = spaces.spaceRoomsBySpaceId[spaceId]?.find((r) => r.id === roomId);
  if (!room) return undefined;
  const isText = room.type === ROOM_TYPE_TEXT;
  const isVoice = room.type === ROOM_TYPE_VOICE;
  const sp = spaces.spaces.find((s) => s.id === spaceId);
  const mentions = isText ? mentionCount(room.id) : 0;
  const unread = !isText || activeRoomId === room.id ? 0 : channelUnread(spaceId, room);
  const muted = isRoomMuted(room);
  const voiceCount = isVoice ? voiceStatesForRoom(room.id).length : 0;
  const userLimit = room.user_limit ?? 0;
  const menuMentions = mentionCount(room.id);
  return {
    id: room.id,
    name: room.name ?? '',
    type: room.type,
    isVoice,
    e2ee: room.e2ee_enabled === true,
    isPrivate: isRoomPrivate(room, spaces.spaceRoomsBySpaceId[spaceId], sp?.everyone_role_id),
    muted,
    unread,
    mentions,
    showUnreadPip: unread > 0 && mentions === 0 && !muted,
    bold: (unread > 0 || mentions > 0) && !muted,
    showMentionBadge: mentions > 0 && !muted,
    voiceCount,
    userLimit,
    showVoiceCount: isVoice && (voiceCount > 0 || userLimit > 0),
    hasUnreadOrMentions: menuMentions > 0 || spaceCopyUnread(spaceId, room) > 0,
    latestMessageId: latestSnowflakeId(messages.byRoom[room.id], room.last_message_id),
  };
}

/** One text/voice channel row. Re-renders only when what it shows changes. */
export function useChannelRow(spaceId: string, roomId: string, activeRoomId: string | null): ChannelRowView | undefined {
  return useDerived(
    `channelRow:${spaceId}:${roomId}:${activeRoomId ?? ''}`,
    () => channelRowView(spaceId, roomId, activeRoomId),
    deepEqual,
  );
}

export interface ThreadRowView {
  id: string;
  name: string;
  locked: boolean;
  archived: boolean;
  joined: boolean;
  muted: boolean;
  mentions: number;
  /** 0 for the thread on screen. */
  unread: number;
  /** Pip + bold name: unread or mentions, not open, not muted. */
  highlight: boolean;
  /** Mention pill (hidden on the open thread). */
  showMentionBadge: boolean;
  hasUnreadOrMentions: boolean;
  latestMessageId: string | null;
}

export function threadRowView(spaceId: string, roomId: string, activeRoomId: string | null): ThreadRowView | undefined {
  const room = spaces.spaceRoomsBySpaceId[spaceId]?.find((r) => r.id === roomId);
  if (!room) return undefined;
  const active = activeRoomId === room.id;
  const mentions = mentionCount(room.id);
  const anyUnread = spaceCopyUnread(spaceId, room);
  const unread = active ? 0 : anyUnread;
  const muted = isRoomMuted(room);
  return {
    id: room.id,
    name: room.name ?? '',
    locked: room.thread?.locked === true,
    archived: room.thread?.archived === true,
    joined: room.thread?.joined === true,
    muted,
    mentions,
    unread,
    highlight: !active && !muted && (unread > 0 || mentions > 0),
    showMentionBadge: mentions > 0 && !active,
    hasUnreadOrMentions: mentions > 0 || anyUnread > 0,
    latestMessageId: latestSnowflakeId(messages.byRoom[room.id], room.last_message_id),
  };
}

/** One thread row nested under its channel. */
export function useThreadRow(spaceId: string, roomId: string, activeRoomId: string | null): ThreadRowView | undefined {
  return useDerived(
    `threadRow:${spaceId}:${roomId}:${activeRoomId ?? ''}`,
    () => threadRowView(spaceId, roomId, activeRoomId),
    deepEqual,
  );
}

export interface SectionRowView {
  id: string;
  name: string;
  /** The long-press sheet's Mark as read: a text child (not the open one) is unread or mentioned. */
  hasUnread: boolean;
  /** Mute toggles the whole section: "Mute section" while any child is unmuted. */
  anyUnmuted: boolean;
  /** What Mark as read acks - each text child's last_message_id, as the web does. */
  markReadTargets: Array<{ roomId: string; messageId: string }>;
  childIds: string[];
}

export function sectionRowView(spaceId: string, sectionId: string, activeRoomId: string | null): SectionRowView | undefined {
  const all = spaces.spaceRoomsBySpaceId[spaceId] ?? [];
  const section = all.find((r) => r.id === sectionId && r.type === ROOM_TYPE_SECTION);
  if (!section) return undefined;
  const kids = all.filter((r) => r.parent_id === section.id);
  const textKids = kids.filter((r) => r.type === ROOM_TYPE_TEXT);
  return {
    id: section.id,
    name: section.name ?? '',
    hasUnread: textKids.some(
      (r) => r.id !== activeRoomId && (mentionCount(r.id) > 0 || spaceCopyUnread(spaceId, r) > 0),
    ),
    anyUnmuted: kids.some((r) => !isRoomMuted(r)),
    markReadTargets: textKids
      .filter((r) => !!r.last_message_id)
      .map((r) => ({ roomId: r.id, messageId: r.last_message_id! })),
    childIds: kids.map((r) => r.id),
  };
}

/** A section header's long-press facts (its collapsed state and dot come with the tree). */
export function useSectionRow(spaceId: string, sectionId: string, activeRoomId: string | null): SectionRowView | undefined {
  return useDerived(
    `sectionRow:${spaceId}:${sectionId}:${activeRoomId ?? ''}`,
    () => sectionRowView(spaceId, sectionId, activeRoomId),
    deepEqual,
  );
}
