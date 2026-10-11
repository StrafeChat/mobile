/**
 * Voice state for lists and headers: who is in a room, who is speaking, whether a call is up.
 *
 * Reads the voice store's state half (voice.byRoom, voice.calls, voice.session, voice.speaking)
 * through its own selectors; joining, leaving and toggles are the store's functions
 * (joinVoiceRoom, leaveVoiceRoom, toggleMute...), whatever module provides them on mobile.
 * Speaking flags flip many times a second, so they are read per person (useIsSpeaking) and
 * never folded into a list's data.
 */
import { voice, voiceStatesForRoom, isConnectedTo } from '@web/stores/voice';
import { spaceMembers } from '@web/stores/spaceMembers';
import { voiceParticipantName, voicePermsFor } from '@web/lib/voice/perms';
import type { VoicePerms } from '@web/lib/spacePermissions';
import { auth } from '@web/stores/auth';
import { deepEqual, sameArray, useDerived } from './derived';

export interface VoiceOccupant {
  userId: string;
  name: string;
  avatar?: string;
  selfMute: boolean;
  selfDeaf: boolean;
  /** Imposed by a moderator (drawn red). */
  serverMute: boolean;
  serverDeaf: boolean;
  video: boolean;
  /** Sharing their screen (LIVE badge). */
  streaming: boolean;
}

/** People in a voice room or call, in join order (VoiceChannelUsers). */
export function voiceOccupants(roomId: string, spaceId?: string | null): VoiceOccupant[] {
  return [...voiceStatesForRoom(roomId)]
    .sort((a, b) => a.joined_at.localeCompare(b.joined_at))
    .map((st) => {
      const member = spaceId ? spaceMembers.bySpaceId[spaceId]?.find((m) => m.id === st.user_id) : undefined;
      const avatar = member?.avatar ?? st.user?.avatar;
      return {
        userId: st.user_id,
        name: voiceParticipantName(st.user_id, st, spaceId ?? undefined),
        ...(avatar ? { avatar } : {}),
        selfMute: st.self_mute,
        selfDeaf: st.self_deaf,
        serverMute: st.mute,
        serverDeaf: st.deaf,
        video: st.self_video,
        streaming: st.self_stream,
      };
    });
}

/** Re-renders on joins, leaves and mute/deafen/video/stream changes in that room. */
export function useVoiceOccupants(roomId: string, spaceId?: string | null): VoiceOccupant[] {
  return useDerived(`voiceOccupants:${roomId}:${spaceId ?? ''}`, () => voiceOccupants(roomId, spaceId), deepEqual);
}

/** Just the ids, for counts and avatar stacks. */
export function useVoiceOccupantIds(roomId: string): string[] {
  return useDerived(
    `voiceOccupantIds:${roomId}`,
    () => [...voiceStatesForRoom(roomId)].sort((a, b) => a.joined_at.localeCompare(b.joined_at)).map((s) => s.user_id),
    sameArray,
  );
}

/** Whether someone is speaking right now (the green ring). Re-renders only for that person. */
export function useIsSpeaking(userId: string): boolean {
  return useDerived(`speaking:${userId}`, () => !!voice.speaking[userId]);
}

/** Whether this device is in (or connecting to) that room's voice session. */
export function useIsConnectedTo(roomId: string | null | undefined): boolean {
  return useDerived(`voiceConnected:${roomId ?? ''}`, () => (roomId ? isConnectedTo(roomId) : false));
}

/** A PM call is ringing or running, or anyone is in the room: the header's call buttons read
 * "Join" (RoomPage's callActive). */
export function useCallActive(roomId: string | null | undefined): boolean {
  return useDerived(
    `callActive:${roomId ?? ''}`,
    () => !!roomId && (!!voice.calls[roomId] || voiceStatesForRoom(roomId).length > 0),
  );
}

export interface VoiceSessionView {
  roomId: string | null;
  spaceId: string | null;
  status: (typeof voice)['session']['status'];
  selfMute: boolean;
  selfDeaf: boolean;
  camera: boolean;
  screen: boolean;
  serverMute: boolean;
  serverDeaf: boolean;
  quality: (typeof voice)['session']['quality'];
  encrypted: boolean;
  error: string | null;
}

/** This device's voice session, for the voice dock. Re-renders on its changes only. */
export function useVoiceSession(): VoiceSessionView {
  return useDerived(
    'voiceSession',
    () => {
      const s = voice.session;
      return {
        roomId: s.roomId,
        spaceId: s.spaceId,
        status: s.status,
        selfMute: s.selfMute,
        selfDeaf: s.selfDeaf,
        camera: s.camera,
        screen: s.screen,
        serverMute: s.serverMute,
        serverDeaf: s.serverDeaf,
        quality: s.quality,
        encrypted: s.encrypted,
        error: s.error,
      };
    },
    deepEqual,
  );
}

/** The incoming PM call to ring for, if any. */
export function useIncomingCall(): { roomId: string; startedBy: string; since: number } | null {
  return useDerived(
    'incomingCall',
    () => {
      const c = voice.incoming;
      return c ? { roomId: c.roomId, startedBy: c.startedBy, since: c.since } : null;
    },
    deepEqual,
  );
}

/** The viewer's voice permissions in a space room (connect, speak, video, moderation);
 * fully permissive for the viewer's own actions in PMs and while roles are unknown. */
export function useVoicePerms(spaceId: string | null | undefined, roomId: string | null | undefined): VoicePerms {
  return useDerived(
    `voicePerms:${spaceId ?? ''}:${roomId ?? ''}`,
    () => ({ ...voicePermsFor(auth.user?.id, spaceId ?? undefined, roomId ?? undefined) }),
    deepEqual,
  );
}
