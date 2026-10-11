/**
 * What the room settings screens read: the live store copy of the room (overrides included -
 * the gateway keeps them current), its space, the space's roles and members, and the
 * viewer's gates. Discord's split, as SpaceRoomSettingsModal does it: Manage Rooms edits the
 * room itself (general, encryption, voice, sync), Manage Roles edits its permission overrides
 * (and the private-section switch). A PM or group has only its notification settings here.
 */
import { useLocalSearchParams } from 'expo-router';
import type { SpaceRole, SpaceRoom , SpaceMember } from '@web/api/spaces';
import { spaces } from '@web/stores/spaces';
import { useSolid } from '@/bridge/solid';
import { useEnsureSpaceData, useMyId, useSpace, useSpaceAbilities, useSpaceRoles, type SpaceView } from '@/data';
import { spaceMembers } from '@web/stores/spaceMembers';
import { t } from '@web/i18n/t';
import type { RoomSettingsPageId } from '../routes';

export const ROOM_TYPE_TEXT = 3;
export const ROOM_TYPE_VOICE = 4;
export const ROOM_TYPE_SECTION = 5;
export const ROOM_TYPE_THREAD = 6;

export function useRoomIdParam(): string {
  const { roomId } = useLocalSearchParams<{ roomId: string }>();
  return Array.isArray(roomId) ? (roomId[0] ?? '') : (roomId ?? '');
}

export interface RoomSettingsData {
  roomId: string;
  spaceId: string | null;
  room: SpaceRoom | undefined;
  space: SpaceView | undefined;
  roles: SpaceRole[];
  members: SpaceMember[];
  canManageRooms: boolean;
  canManageRoles: boolean;
  viewerId: string | null;
}

/** Find a space room anywhere in the store (and which space holds it). */
function locate(roomId: string): { spaceId: string; room: SpaceRoom } | null {
  for (const [sid, list] of Object.entries(spaces.spaceRoomsBySpaceId)) {
    const room = list.find((r) => r.id === roomId);
    if (room) return { spaceId: sid, room };
  }
  return null;
}

export function useRoomSettings(roomId: string): RoomSettingsData {
  const found = useSolid(() => locate(roomId), [roomId]);
  const spaceId = found?.spaceId ?? null;
  useEnsureSpaceData(spaceId);
  const space = useSpace(spaceId);
  const roles = useSpaceRoles(spaceId);
  const abilities = useSpaceAbilities(spaceId);
  const members = useSolid(() => (spaceId ? (spaceMembers.bySpaceId[spaceId] ?? []) : []), [spaceId]) as SpaceMember[];
  const viewerId = useMyId();
  return {
    roomId,
    spaceId,
    room: found?.room,
    space,
    roles: roles ?? [],
    members,
    canManageRooms: abilities.canManageRooms,
    canManageRoles: abilities.canManageRoles,
    viewerId,
  };
}

/** The pages a room has: General for all, Encryption for text, Voice for voice, Permissions, and
 * Notifications for anything that can notify (not a section, whose mute is a row). */
export function roomPages(room: Pick<SpaceRoom, 'type'> | undefined): RoomSettingsPageId[] {
  if (!room || room.type === ROOM_TYPE_THREAD) return ['notifications'];
  const pages: RoomSettingsPageId[] = ['general'];
  if (room.type === ROOM_TYPE_TEXT) pages.push('encryption');
  if (room.type === ROOM_TYPE_VOICE) pages.push('voice');
  pages.push('permissions');
  if (room.type !== ROOM_TYPE_SECTION) pages.push('notifications');
  return pages;
}

/** '#name', '🔊 name' or the section's name (the web's roomLabel). */
export function roomLabel(room: Pick<SpaceRoom, 'type' | 'name'> | undefined): string {
  if (!room) return '';
  if (room.type === ROOM_TYPE_SECTION) return room.name || t('space.section');
  return `${room.type === ROOM_TYPE_VOICE ? '🔊 ' : '#'}${room.name || t('intro.roomFallback')}`;
}
