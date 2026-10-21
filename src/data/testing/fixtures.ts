/**
 * Store fixtures for the data-layer tests: seed the real web stores (and the mocked messages /
 * voice stores from webMocks) with READY-shaped data, and reset them between tests.
 * Import webMocks before this.
 */
import { setAuth } from '@web/stores/auth';
import { setRooms } from '@web/stores/rooms';
import { setSpaces } from '@web/stores/spaces';
import { setReadState } from '@web/stores/readState';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { setPresence } from '@web/stores/presence';
import { setRelationships } from '@web/stores/relationships';
import { setNewHeaderDismissed } from '@web/stores/newHeaderDismissed';
import { setMessages, type DecryptedMessage } from '@web/stores/messages';
import { setVoice } from '@web/stores/voice';
import type { Room, RoomParticipant } from '@web/api/rooms';
import type { Space, SpaceRole, SpaceRoom } from '@web/api/spaces';
import type { VoiceState } from '@web/api/voice';
import type { MemberWithSpaceProfile } from '../spaceProfileCompat';

export const ME = '100';

export function resetStores(): void {
  setAuth({ user: { id: ME, username: 'me', display_name: 'Me' }, token: 't', hydrated: true, loading: false });
  setRooms({ rooms: [], loading: false, hydrated: true });
  setSpaces({ spaces: [], spaceRoomsBySpaceId: {}, loading: false, hydrated: true });
  setReadState({ byRoom: {} });
  setSpaceMembers({ bySpaceId: {}, loading: {}, loadedAt: {} });
  setPresence({ byUser: {} });
  setRelationships({ relationships: [], loading: false, hydrated: true });
  setNewHeaderDismissed({ byRoom: {} });
  (setMessages as unknown as (v: object) => void)({
    byRoom: {},
    loading: {},
    loadingOlder: {},
    hasMoreOlder: {},
    hasMoreNewer: {},
    loadingNewer: {},
    sending: {},
    scrollToBottomTick: {},
    scrollToBottomForce: {},
    jumpTarget: {},
  });
  (setVoice as unknown as (v: object) => void)({ byRoom: {}, calls: {}, speaking: {}, incoming: null });
}

export function user(id: string, extra: Partial<RoomParticipant> = {}): RoomParticipant {
  return { id, username: `user${id}`, display_name: `User ${id}`, ...extra };
}

export function pm(id: string, other: RoomParticipant | null, extra: Partial<Room> = {}): Room {
  return {
    id,
    type: 1,
    recipients: [],
    participants: other ? [user(ME, { username: 'me', display_name: 'Me' }), other] : [user(ME)],
    created_at: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
}

export function group(id: string, others: RoomParticipant[], extra: Partial<Room> = {}): Room {
  return {
    id,
    type: 2,
    recipients: [],
    participants: [user(ME, { username: 'me', display_name: 'Me' }), ...others],
    created_at: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
}

export function role(id: string, position: number, permissions: number, extra: Partial<SpaceRole> = {}): SpaceRole {
  return { id, name: id, permissions, position, color: 0, hoist: false, mentionable: false, created_at: '', updated_at: '', ...extra };
}

export function space(id: string, roles: SpaceRole[], extra: Partial<Space> = {}): Space {
  return {
    id,
    name: `Space ${id}`,
    name_acronym: '',
    description: '',
    icon: '',
    banner: '',
    owner_id: 'owner',
    verification_level: 0,
    default_message_notifications: 0,
    explicit_content_filter: 0,
    features: [],
    afk_timeout: 300,
    system_room_flags: 0,
    max_presences: 0,
    max_members: 0,
    vanity_url_code: '',
    preferred_locale: 'en',
    max_video_room_users: 0,
    created_at: '',
    updated_at: '',
    everyone_role_id: roles.find((r) => r.name === '@everyone')?.id,
    roles,
    ...extra,
  };
}

export function sroom(id: string, type: number, extra: Partial<SpaceRoom> = {}): SpaceRoom {
  return {
    id,
    type,
    name: id,
    position: 0,
    created_at: '2026-10-01T00:00:00.000Z',
    permission_overrides: [],
    user_overrides: [],
    ...extra,
  };
}

/** A space member; `extra` may carry their space profile (nick, space_avatar...). */
export function member(id: string, roles: string[] = [], extra: Partial<MemberWithSpaceProfile> = {}): MemberWithSpaceProfile {
  return { ...user(id), roles, joined_at: '2026-01-01T00:00:00.000Z', ...extra };
}

export function message(roomId: string, id: string, sender: string, extra: Partial<DecryptedMessage> = {}): DecryptedMessage {
  // Real ids sort by time like snowflakes do; a temp id lands last (an optimistic send).
  const at = new Date(Date.UTC(2026, 9, 10, 12, 0, /^\d+$/.test(id) ? Number(id) % 60 : 59)).toISOString();
  return {
    room_id: roomId,
    id,
    sender_id: sender,
    sender_device_id: '1',
    ciphertext: '',
    plaintext: `message ${id}`,
    created_at: at,
    updated_at: at,
    ...extra,
  };
}

export function voiceState(roomId: string, userId: string, joinedAt: string, extra: Partial<VoiceState> = {}): VoiceState {
  return {
    user_id: userId,
    room_id: roomId,
    session_id: 's',
    self_mute: false,
    self_deaf: false,
    mute: false,
    deaf: false,
    self_video: false,
    self_stream: false,
    suppress: false,
    priority_speaker: false,
    connected: true,
    joined_at: joinedAt,
    ...extra,
  };
}
