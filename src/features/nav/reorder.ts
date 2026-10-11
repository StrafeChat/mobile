/**
 * Reordering a space's rooms from a touch screen: "Move up", "Move down" and "Move to section"
 * in a row's long-press sheet, in place of the web's pointer drag.
 *
 * The commits are the web's own (createRoomReorder.ts):
 *  - same scope (sections among themselves, or channels within one parent): POST
 *    /spaces/:sid/rooms/reorder with the scope's full new order;
 *  - into another parent: POST /spaces/:sid/rooms/move {channel_id, parent_section_id,
 *    before_room_id}, appending when before_room_id is null;
 * each followed by refreshSpaceRooms (no optimistic reorder, as on the web). The scope lists
 * are built the way SpaceRoomsBar's orderedIdsForScope builds them: sections by position;
 * top-level and in-section channels visible to the viewer, by position.
 */
import type { SpaceRoom } from '@web/api/spaces';
import { moveSpaceChannel, reorderSpaceRooms } from '@web/api/spaces';
import { spaces, refreshSpaceRooms } from '@web/stores/spaces';
import { auth } from '@web/stores/auth';
import { memberCanManageRooms } from '@web/lib/spacePermissions';
import { mySpaceMember, ROOM_TYPE_SECTION, ROOM_TYPE_TEXT, ROOM_TYPE_VOICE, viewerCanSeeRoom } from '@/data';

/** 'sections', 'top', or 'sec:<sectionId>' - the web's scope keys. */
export type ReorderScope = 'sections' | 'top' | `sec:${string}`;

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

/** Ids of a scope in display order. `canView` is the viewer's visibility rule. */
export function scopeIds(all: readonly SpaceRoom[], scope: ReorderScope, canView: (r: SpaceRoom) => boolean): string[] {
  const sections = all.filter((r) => r.type === ROOM_TYPE_SECTION).sort(byPosition);
  if (scope === 'sections') return sections.map((s) => s.id);
  const sectionIds = new Set(sections.map((s) => s.id));
  if (scope === 'top') {
    return all
      .filter(
        (r) =>
          (r.type === ROOM_TYPE_TEXT || r.type === ROOM_TYPE_VOICE) &&
          (!r.parent_id || !sectionIds.has(r.parent_id)) &&
          canView(r),
      )
      .sort(byPosition)
      .map((r) => r.id);
  }
  const secId = scope.slice(4);
  if (!sectionIds.has(secId)) return [];
  return all
    .filter((r) => r.parent_id === secId && canView(r))
    .sort(byPosition)
    .map((r) => r.id);
}

/** The scope a room is ordered in: sections among sections, a channel under its parent. */
export function scopeOf(all: readonly SpaceRoom[], roomId: string): ReorderScope | null {
  const room = all.find((r) => r.id === roomId);
  if (!room) return null;
  if (room.type === ROOM_TYPE_SECTION) return 'sections';
  if (room.type !== ROOM_TYPE_TEXT && room.type !== ROOM_TYPE_VOICE) return null;
  const parent = room.parent_id ? all.find((r) => r.id === room.parent_id && r.type === ROOM_TYPE_SECTION) : undefined;
  return parent ? `sec:${parent.id}` : 'top';
}

/** The scope's order after moving `id` one step (-1 up, +1 down); null when it cannot move. */
export function stepOrder(ids: readonly string[], id: string, dir: -1 | 1): string[] | null {
  const i = ids.indexOf(id);
  if (i < 0) return null;
  const j = i + dir;
  if (j < 0 || j >= ids.length) return null;
  const next = [...ids];
  next[i] = ids[j]!;
  next[j] = id;
  return next;
}

/** The reorder request body for a scope's new order (createRoomReorder.commitRoomOrder). */
export function reorderBody(scope: ReorderScope, roomIds: string[]): Parameters<typeof reorderSpaceRooms>[1] {
  if (scope === 'sections') return { scope: 'sections', room_ids: roomIds };
  if (scope === 'top') return { scope: 'channels', parent_section_id: null, room_ids: roomIds };
  return { scope: 'channels', parent_section_id: scope.slice(4), room_ids: roomIds };
}

export interface MoveOptions {
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** Sections a channel can be moved into (not its own), by position. */
  targets: { id: string; name: string }[];
  /** A channel inside a section can go back to the top level. */
  canMoveToTop: boolean;
}

/** What the long-press sheet offers for a room's position. */
export function moveOptions(spaceId: string, roomId: string): MoveOptions | null {
  const all = spaces.spaceRoomsBySpaceId[spaceId] ?? [];
  const scope = scopeOf(all, roomId);
  if (!scope) return null;
  const ids = scopeIds(all, scope, (r) => viewerCanSeeRoom(spaceId, r));
  const i = ids.indexOf(roomId);
  const isSection = scope === 'sections';
  const targets = isSection
    ? []
    : all
        .filter((r) => r.type === ROOM_TYPE_SECTION && `sec:${r.id}` !== scope && viewerCanSeeRoom(spaceId, r))
        .sort(byPosition)
        .map((r) => ({ id: r.id, name: r.name }));
  return {
    canMoveUp: i > 0,
    canMoveDown: i >= 0 && i < ids.length - 1,
    targets,
    canMoveToTop: !isSection && scope !== 'top',
  };
}

/** Manage Rooms, checked again at commit time (the web re-checks on every drop). */
function canManageRoomsNow(spaceId: string): boolean {
  const sp = spaces.spaces.find((s) => s.id === spaceId);
  return memberCanManageRooms(sp, sp?.roles, mySpaceMember(spaceId), auth.user?.id);
}

/** Move a room one step within its scope and refresh the list. */
export async function moveRoomStep(spaceId: string, roomId: string, dir: -1 | 1): Promise<void> {
  if (!canManageRoomsNow(spaceId)) return;
  const all = spaces.spaceRoomsBySpaceId[spaceId] ?? [];
  const scope = scopeOf(all, roomId);
  if (!scope) return;
  const ids = scopeIds(all, scope, (r) => viewerCanSeeRoom(spaceId, r));
  const next = stepOrder(ids, roomId, dir);
  if (!next) return;
  await reorderSpaceRooms(spaceId, reorderBody(scope, next));
  await refreshSpaceRooms(spaceId);
}

/** Move a channel to the end of another section (or the top level, with null). */
export async function moveRoomToSection(spaceId: string, roomId: string, sectionId: string | null): Promise<void> {
  if (!canManageRoomsNow(spaceId)) return;
  await moveSpaceChannel(spaceId, { channel_id: roomId, parent_section_id: sectionId, before_room_id: null });
  await refreshSpaceRooms(spaceId);
}
