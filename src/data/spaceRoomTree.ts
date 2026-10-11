/**
 * A space's room list as one flat, ordered list of rows - the shape a FlashList wants.
 *
 * Pure: SpaceRoomsBar's layout rules with the store reads passed in, so it can be tested
 * against fixtures and memoised by the hook in spaceRoomList.ts. The rules, as the web
 * applies them:
 *
 *  - top-level channels first: text/voice rooms whose parent is not a section, visible to the
 *    viewer, by position;
 *  - then each section the viewer can see, by position: its header, then (unless collapsed)
 *    its visible children by position;
 *  - under every channel: the people in it when it is a voice room (by join time), then its
 *    active threads the viewer joined or is looking at, most recently active first;
 *  - a collapsed section hides its children entirely and instead shows a dot when one of its
 *    text channels (not the open one) has unread messages or mentions.
 */
import { ROOM_TYPE_SECTION, ROOM_TYPE_TEXT, ROOM_TYPE_THREAD, ROOM_TYPE_VOICE } from './constants';

export interface TreeRoom {
  id: string;
  type: number;
  position: number;
  parent_id?: string;
  created_at: string;
  thread?: { archived?: boolean; joined?: boolean; last_active_at?: string };
}

export type SpaceRoomTreeItem =
  | { kind: 'channel'; key: string; roomId: string; roomType: number; sectionId: string | null }
  | { kind: 'voiceUser'; key: string; roomId: string; userId: string; sectionId: string | null }
  | { kind: 'thread'; key: string; roomId: string; channelId: string; sectionId: string | null }
  | { kind: 'section'; key: string; sectionId: string; collapsed: boolean; hasUnread: boolean };

export interface SpaceRoomTreeInput<R extends TreeRoom> {
  rooms: readonly R[];
  /** canViewSpaceChannel for the viewer (the only visibility rule, the server's own). */
  canView: (room: R) => boolean;
  collapsedSectionIds: ReadonlySet<string>;
  activeRoomId: string | null;
  /** Whether a text channel has unread messages or mentions - consulted only for collapsed
   * sections' children, so an open space does not pay for it. */
  hasUnreadOrMention: (room: R) => boolean;
  /** Who is in a voice room, already in join order. Omit to leave occupants out. */
  voiceUserIds?: (roomId: string) => readonly string[];
}

const byPosition = (a: TreeRoom, b: TreeRoom) => a.position - b.position;

/** Joined (or open) active threads of a channel, newest activity first (SpaceRoomsBar.threadsUnder). */
export function threadsUnder<R extends TreeRoom>(all: readonly R[], channelId: string, activeRoomId: string | null): R[] {
  return all
    .filter(
      (r) =>
        r.type === ROOM_TYPE_THREAD &&
        r.parent_id === channelId &&
        !r.thread?.archived &&
        (r.thread?.joined || r.id === activeRoomId),
    )
    .sort((a, b) => (b.thread?.last_active_at ?? b.created_at).localeCompare(a.thread?.last_active_at ?? a.created_at));
}

export function buildSpaceRoomTree<R extends TreeRoom>(input: SpaceRoomTreeInput<R>): SpaceRoomTreeItem[] {
  const { rooms, canView, collapsedSectionIds, activeRoomId } = input;
  const sections = rooms.filter((r) => r.type === ROOM_TYPE_SECTION).sort(byPosition);
  const sectionIds = new Set(sections.map((s) => s.id));
  const out: SpaceRoomTreeItem[] = [];

  const pushChannel = (room: R, sectionId: string | null) => {
    out.push({ kind: 'channel', key: `c:${room.id}`, roomId: room.id, roomType: room.type, sectionId });
    if (room.type === ROOM_TYPE_VOICE && input.voiceUserIds) {
      for (const userId of input.voiceUserIds(room.id)) {
        out.push({ kind: 'voiceUser', key: `v:${room.id}:${userId}`, roomId: room.id, userId, sectionId });
      }
    }
    for (const th of threadsUnder(rooms, room.id, activeRoomId)) {
      out.push({ kind: 'thread', key: `t:${th.id}`, roomId: th.id, channelId: room.id, sectionId });
    }
  };

  const topLevel = rooms
    .filter(
      (r) =>
        (r.type === ROOM_TYPE_TEXT || r.type === ROOM_TYPE_VOICE) &&
        (!r.parent_id || !sectionIds.has(r.parent_id)) &&
        canView(r),
    )
    .sort(byPosition);
  for (const room of topLevel) pushChannel(room, null);

  for (const section of sections) {
    if (!canView(section)) continue;
    const collapsed = collapsedSectionIds.has(section.id);
    const children = rooms.filter((r) => r.parent_id === section.id && canView(r)).sort(byPosition);
    const hasUnread =
      collapsed &&
      children.some((c) => c.type === ROOM_TYPE_TEXT && c.id !== activeRoomId && input.hasUnreadOrMention(c));
    out.push({ kind: 'section', key: `s:${section.id}`, sectionId: section.id, collapsed, hasUnread });
    if (collapsed) continue;
    for (const child of children) pushChannel(child, section.id);
  }
  return out;
}
