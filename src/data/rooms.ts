/**
 * Rooms: the Home tab's PM list, one room's header facts, mute/notify state, and the
 * space-channel mirror the send path needs.
 *
 * PMs and groups live in stores/rooms; space channels in stores/spaces (a channel being viewed
 * is also mirrored into stores/rooms - see useSpaceChannelMirror). findPmRoom, findSpaceRoom and
 * spaceIdOfRoom answer "which kind is this id" without the caller knowing.
 */
import { useEffect } from 'react';
import {
  rooms,
  addOrUpdateRoom,
  isNotesRoom,
  roomDisplayName,
  sortRoomsByLastMessage,
} from '@web/stores/rooms';
import type { Room } from '@web/api/rooms';
import { spaces } from '@web/stores/spaces';
import type { SpaceRoom, ThreadInfo } from '@web/api/spaces';
import { getUnreadCountForDisplay } from '@web/stores/readState';
import { messages } from '@web/stores/messages';
import { auth } from '@web/stores/auth';
import { presence, activityOf, customStatusOf, isPresentStatus } from '@web/stores/presence';
import { lastSpaceRoom } from '@web/stores/lastSpaceRoom';
import { effectiveNotifyMode, isRoomMuted } from '@web/lib/roomNotify';
import { t } from '@web/i18n/t';
import { snapshot, useSolid } from '@/bridge/solid';
import { deepEqual, sameArray, useDerived } from './derived';
import {
  ROOM_TYPE_GROUP,
  ROOM_TYPE_PM,
  ROOM_TYPE_SECTION,
  ROOM_TYPE_THREAD,
  ROOM_TYPE_VOICE,
  isTextLike,
  latestSnowflakeId,
} from './constants';

// ---- lookups ---------------------------------------------------------------------------------------

/** A space channel by id, searched across every space (callers often only have the room id). */
export function findSpaceRoom(roomId: string, spaceId?: string | null): { spaceId: string; room: SpaceRoom } | undefined {
  if (spaceId) {
    const room = spaces.spaceRoomsBySpaceId[spaceId]?.find((r) => r.id === roomId);
    if (room) return { spaceId, room };
  }
  for (const [sid, list] of Object.entries(spaces.spaceRoomsBySpaceId)) {
    const room = list.find((r) => r.id === roomId);
    if (room) return { spaceId: sid, room };
  }
  return undefined;
}

/**
 * The space a room belongs to, or undefined for a PM/group. Answers from the rooms store when it
 * can, so asking about a PM does not scan (and track) every space's room list.
 */
export function spaceIdOfRoom(roomId: string): string | undefined {
  const r = rooms.rooms.find((x) => x.id === roomId);
  if (r && !r.space_id && (r.type === ROOM_TYPE_PM || r.type === ROOM_TYPE_GROUP)) return undefined;
  if (r?.space_id) return r.space_id;
  return findSpaceRoom(roomId)?.spaceId;
}

/** A PM or group from stores/rooms (never a mirrored space channel). */
export function findPmRoom(roomId: string): Room | undefined {
  const r = rooms.rooms.find((x) => x.id === roomId);
  return r && (r.type === ROOM_TYPE_PM || r.type === ROOM_TYPE_GROUP) && !r.space_id ? r : undefined;
}

/**
 * A room's display name. roomDisplayName's two fallbacks ('Notes', 'Unknown') are hard-coded
 * English in the web; here they go through the web's own translated keys.
 */
export function pmDisplayName(room: Room, currentUserId: string): string {
  if (room.name?.trim()) return room.name;
  if (isNotesRoom(room, currentUserId)) return t('nav.notes');
  const name = roomDisplayName(room, currentUserId);
  return name === 'Unknown' ? t('common.unknown') : name;
}

/** The PM list on Home: 1:1 and group PMs, not space channels, not Notes, newest first. */
export function pmRoomIds(): string[] {
  const uid = auth.user?.id ?? '';
  return sortRoomsByLastMessage(
    rooms.rooms.filter(
      (r) => (r.type === ROOM_TYPE_PM || r.type === ROOM_TYPE_GROUP) && !r.space_id && !isNotesRoom(r, uid),
    ),
  ).map((r) => r.id);
}

/** The newest known message in a room - what "Mark as read" acks to. */
export function latestMessageIdForRoom(roomId: string): string | null {
  const known = rooms.rooms.find((r) => r.id === roomId);
  const fallback = known ? known.last_message_id : findSpaceRoom(roomId)?.room.last_message_id;
  return latestSnowflakeId(messages.byRoom[roomId], fallback);
}

// ---- PM list row ------------------------------------------------------------------------------------

export interface PmRowView {
  id: string;
  isGroup: boolean;
  name: string;
  /** The other person in a 1:1 (presence dot, avatar); undefined for groups. */
  otherUserId?: string;
  avatar: string | null;
  bot: boolean;
  /** 1:1 with the instance's official account (OFFICIAL tag, read-only composer). */
  system: boolean;
  /** The other person's custom status, only while they are online/idle/dnd. */
  subtitle?: string;
  /** What the other person is playing, when there is no custom status (RoomsBar's rule). */
  playing?: string;
  /** 0 for the room on screen (it is read as it arrives). */
  unread: number;
  muted: boolean;
  /** What "Mark as read" acks to; null when nothing is known. */
  latestMessageId: string | null;
  /** RoomsBar offers Mark as read only with something to ack and something unread. */
  canMarkRead: boolean;
}

/**
 * One PM list row, as RoomsBar's ConvItem derives it. `onScreenRoomId`: the conversation on
 * screen (shell/state.ts roomOnScreen), whose unread is not shown - not merely the selected
 * one, which collects unread like any other while the rails or another screen cover it.
 */
export function pmRowView(roomId: string, onScreenRoomId: string | null): PmRowView | undefined {
  const uid = auth.user?.id ?? '';
  const room = rooms.rooms.find((r) => r.id === roomId);
  if (!room) return undefined;
  const isGroup = room.type === ROOM_TYPE_GROUP;
  const other = room.participants?.find((p) => p.id !== uid);
  const list = messages.byRoom[room.id] ?? [];
  const unread = onScreenRoomId === room.id || !uid ? 0 : getUnreadCountForDisplay(room.id, room, list, uid);
  let subtitle: string | undefined;
  let playing: string | undefined;
  if (!isGroup && other) {
    const st = presence.byUser[other.id]?.status ?? other.presence?.status;
    if (isPresentStatus(st)) {
      // The store's whenever it knows them: one cleared since the room list was fetched must
      // not come back from the participant snapshot (and hide what they are playing).
      subtitle = customStatusOf(other.id, other.presence);
    }
    // Only from the store, and only while they are around (activityOf).
    if (!subtitle) playing = activityOf(other.id)?.name;
  }
  const latestMessageId = latestSnowflakeId(list, room.last_message_id);
  return {
    id: room.id,
    isGroup,
    name: pmDisplayName(room, uid),
    ...(isGroup || !other ? {} : { otherUserId: other.id }),
    avatar: isGroup ? null : (other?.avatar ?? null),
    bot: !isGroup && other?.bot === true,
    system: !isGroup && other?.system === true,
    ...(subtitle ? { subtitle } : {}),
    ...(playing ? { playing } : {}),
    unread,
    muted: isRoomMuted(room),
    latestMessageId,
    canMarkRead: !!latestMessageId && unread > 0,
  };
}

/** Home's PM list. Re-renders when a conversation is added/removed or the order changes. */
export function usePmRoomIds(): string[] {
  return useDerived('pmRoomIds', pmRoomIds, sameArray);
}

/** Whether the PM list is still loading (REST fallback only; READY fills it at once). */
export function usePmListLoading(): boolean {
  return useSolid(() => rooms.loading);
}

/** One PM row. Re-renders only when something the row shows changes. */
export function usePmRow(roomId: string, onScreenRoomId: string | null): PmRowView | undefined {
  return useDerived(`pmRow:${roomId}:${onScreenRoomId ?? ''}`, () => pmRowView(roomId, onScreenRoomId), deepEqual);
}

/** The signed-in user's Notes room id, when READY carried it. */
export function useNotesRoomId(): string | null {
  return useDerived('notesRoomId', () => {
    const uid = auth.user?.id;
    if (!uid) return null;
    return rooms.rooms.find((r) => !r.space_id && isNotesRoom(r, uid))?.id ?? null;
  });
}

// ---- one room's header facts ---------------------------------------------------------------------

export type RoomKind = 'pm' | 'group' | 'notes' | 'text' | 'voice' | 'thread' | 'section';

export interface RoomInfo {
  id: string;
  type: number;
  kind: RoomKind;
  name: string;
  spaceId?: string;
  parentId?: string;
  /** A thread's channel name (the breadcrumb). */
  parentName?: string;
  topic?: string;
  /** The lock badge: always for a 1:1, groups unless turned off, channels only when opted in. */
  e2ee: boolean;
  /** 1:1 PMs: the other person. */
  otherUserId?: string;
  bot: boolean;
  /** 1:1 with the official account: OFFICIAL tag, and the composer is read-only. */
  official: boolean;
  /** Group PMs: the creator may rename / change E2EE ('0' and missing mean nobody). */
  isCreator: boolean;
  creatorId?: string;
  participantCount: number;
  muted: boolean;
  /** 0 default, 1 all, 2 mentions, 3 nothing (lib/roomNotify NotifyMode*). */
  notifyMode: number;
  /** The mode that actually applies once "default" is resolved against notification prefs. */
  effectiveNotifyMode: 'all' | 'mentions' | 'none';
  slowmodeSeconds: number;
  userLimit: number;
  thread?: ThreadInfo;
  /** The header's member toggle exists (group PMs and space text channels/threads). */
  hasMemberList: boolean;
  /** Calls are offered (PM or group, not Notes, not the official account's one-way PM); still
   * subject to instance.voiceEnabled. */
  callable: boolean;
}

function kindOf(type: number, isNotes: boolean): RoomKind {
  if (type === ROOM_TYPE_PM) return isNotes ? 'notes' : 'pm';
  if (type === ROOM_TYPE_GROUP) return 'group';
  if (type === ROOM_TYPE_VOICE) return 'voice';
  if (type === ROOM_TYPE_THREAD) return 'thread';
  if (type === ROOM_TYPE_SECTION) return 'section';
  return 'text';
}

/** Everything a room header shows, for PMs and space rooms alike (RoomPage + SpacePage). */
export function roomInfo(roomId: string, spaceId?: string | null): RoomInfo | undefined {
  const uid = auth.user?.id ?? '';
  const inSpace = findPmRoom(roomId) ? undefined : findSpaceRoom(roomId, spaceId);
  if (inSpace) {
    const r = inSpace.room;
    const parent = r.parent_id ? spaces.spaceRoomsBySpaceId[inSpace.spaceId]?.find((x) => x.id === r.parent_id) : undefined;
    return {
      id: r.id,
      type: r.type,
      kind: kindOf(r.type, false),
      name: r.name || t('space.defaultRoom'),
      spaceId: inSpace.spaceId,
      ...(r.parent_id ? { parentId: r.parent_id } : {}),
      ...(r.type === ROOM_TYPE_THREAD && parent ? { parentName: parent.name } : {}),
      ...(r.topic ? { topic: r.topic } : {}),
      e2ee: r.e2ee_enabled === true,
      bot: false,
      official: false,
      isCreator: false,
      participantCount: 0,
      // The space page reads mute and notify mode off the space's copy of the room.
      muted: isRoomMuted(r),
      notifyMode: r.notify_mode ?? 0,
      effectiveNotifyMode: effectiveNotifyMode(r),
      slowmodeSeconds: r.slowmode_seconds ?? 0,
      userLimit: r.user_limit ?? 0,
      ...(r.thread ? { thread: { ...r.thread } } : {}),
      hasMemberList: isTextLike(r.type),
      callable: false,
    };
  }
  const r = rooms.rooms.find((x) => x.id === roomId);
  if (!r) return undefined;
  const notes = !!uid && isNotesRoom(r, uid);
  const other = r.type === ROOM_TYPE_PM ? r.participants?.find((p) => p.id !== uid) : undefined;
  return {
    id: r.id,
    type: r.type,
    kind: kindOf(r.type, notes),
    name: pmDisplayName(r, uid),
    ...(r.space_id ? { spaceId: r.space_id } : {}),
    ...(r.parent_id ? { parentId: r.parent_id } : {}),
    ...(r.topic ? { topic: r.topic } : {}),
    e2ee: r.type === ROOM_TYPE_PM || (r.type === ROOM_TYPE_GROUP && r.e2ee_enabled !== false),
    ...(other ? { otherUserId: other.id } : {}),
    bot: other?.bot === true,
    official: other?.system === true,
    isCreator: r.type === ROOM_TYPE_GROUP && !!r.creator_id && r.creator_id !== '0' && r.creator_id === uid,
    ...(r.creator_id && r.creator_id !== '0' ? { creatorId: r.creator_id } : {}),
    participantCount: r.participants?.length ?? 0,
    muted: isRoomMuted(r),
    notifyMode: r.notify_mode ?? 0,
    effectiveNotifyMode: effectiveNotifyMode(r),
    slowmodeSeconds: 0,
    userLimit: 0,
    hasMemberList: r.type === ROOM_TYPE_GROUP,
    // Nobody answers in the official account's PM (the server refuses that call too).
    callable: (r.type === ROOM_TYPE_PM || r.type === ROOM_TYPE_GROUP) && !!uid && !notes && other?.system !== true,
  };
}

/** A room's header facts. Re-renders when any of them change (rename, mute, E2EE flip...). */
export function useRoomInfo(roomId: string | null | undefined, spaceId?: string | null): RoomInfo | undefined {
  return useDerived(
    `roomInfo:${roomId ?? ''}:${spaceId ?? ''}`,
    () => (roomId ? roomInfo(roomId, spaceId) : undefined),
    deepEqual,
  );
}

/** The raw PM/group from stores/rooms (participants included). Re-renders on any change to it. */
export function usePmRoom(roomId: string | null | undefined): Room | undefined {
  return useDerived(
    `pmRoom:${roomId ?? ''}`,
    () => {
      const r = roomId ? rooms.rooms.find((x) => x.id === roomId) : undefined;
      return r ? snapshot(r) : undefined;
    },
    deepEqual,
  );
}

/** Mute + notify mode for a room's notification sheet. */
export function useRoomNotifySettings(roomId: string, spaceId?: string | null): { muted: boolean; notifyMode: number; effective: 'all' | 'mentions' | 'none' } {
  return useDerived(
    `roomNotify:${roomId}:${spaceId ?? ''}`,
    () => {
      const info = roomInfo(roomId, spaceId);
      return {
        muted: info?.muted ?? false,
        notifyMode: info?.notifyMode ?? 0,
        effective: info?.effectiveNotifyMode ?? 'all',
      };
    },
    deepEqual,
  );
}

// ---- the space-channel mirror ----------------------------------------------------------------------

/**
 * Port of SpacePage's spaceRoomToRoom. sendMessage/editMessage only send to rooms present in
 * stores/rooms and read e2ee_enabled off that copy to pick Megolm vs plaintext, so the channel
 * being viewed is mirrored there. It must carry the read cursor and mention count through:
 * addOrUpdateRoom re-syncs read state from it, and dropping them used to rewind the cursor and
 * resurrect the NEW divider on every visit.
 */
export function spaceRoomToRoom(r: SpaceRoom, spaceId: string): Room {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    topic: r.topic,
    position: r.position,
    space_id: spaceId,
    parent_id: r.parent_id,
    last_message_id: r.last_message_id,
    last_read_message_id: r.last_read_message_id,
    mention_count: r.mention_count,
    e2ee_enabled: r.e2ee_enabled,
    created_at: r.created_at,
    updated_at: r.updated_at,
    recipients: [],
    participants: [],
  };
}

/**
 * Keep the open space channel mirrored into stores/rooms (and remember it as the space's last
 * room), as SpacePage does. Keyed on id, type, E2EE flag and space - NOT on the room object,
 * which is replaced on every incoming message; re-mirroring per message pushed the page-load
 * read snapshot back into the store and fought the live viewport ack.
 *
 * Mount it on the conversation screen of every space text channel and thread. Without it a
 * send to a space channel silently returns null.
 */
export function useSpaceChannelMirror(spaceId: string | null | undefined, roomId: string | null | undefined): void {
  const key = useDerived(
    `mirrorKey:${spaceId ?? ''}:${roomId ?? ''}`,
    () => {
      if (!spaceId || !roomId) return '';
      const r = spaces.spaceRoomsBySpaceId[spaceId]?.find((x) => x.id === roomId);
      if (!r || !isTextLike(r.type)) return '';
      return `${r.id}|${r.type}|${r.e2ee_enabled ? 1 : 0}|${spaceId}`;
    },
  );
  useEffect(() => {
    if (!key || !spaceId || !roomId) return;
    const r = spaces.spaceRoomsBySpaceId[spaceId]?.find((x) => x.id === roomId);
    if (!r) return;
    addOrUpdateRoom(spaceRoomToRoom(r, spaceId));
    lastSpaceRoom.set(spaceId, r.id);
  }, [key, spaceId, roomId]);
}
