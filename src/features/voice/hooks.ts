/**
 * React reads of the voice store for the call UI. Each hook is a narrow useSolid selector:
 * the tile list re-renders on joins, leaves and badge changes in its room; a tile's video
 * on its own track; the speaking ring per person (useIsSpeaking in src/data).
 */
import type { RoomParticipant } from '@web/api/rooms';
import { auth } from '@web/stores/auth';
import { rooms } from '@web/stores/rooms';
import { noiseSuppressionEnabled, voice, voiceStatesForRoom } from '@web/stores/voice';
import { voiceSettings } from '@web/stores/voiceSettings';
import { voiceParticipantName, voicePermsFor } from '@web/lib/voice/perms';
import type { VoicePerms } from '@web/lib/spacePermissions';
import { useSolid } from '@/bridge/solid';
import { resolveSpaceUser, spaceMemberOf } from '@/data/spaceProfileCompat';
import { cameraFacing, speakerphone } from '@/platform/voice';
import { buildCallTiles, sortByJoined, type CallTile, type VoiceStateLike } from './model';

/** This device's whole voice session, keys and blocks included (the dock's and stage's view). */
export function useCallSession() {
  return useSolid(() => {
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
      suppress: s.suppress,
      quality: s.quality,
      audioBlocked: s.audioBlocked,
      videoBlocked: s.videoBlocked,
      error: s.error,
      encrypted: s.encrypted,
      keyed: [...s.keyed],
    };
  });
}

export type CallSessionView = ReturnType<typeof useCallSession>;

/** A PM's or group's participants (names and avatars for its call), undefined for space rooms. */
export function roomParticipants(roomId: string | null | undefined): RoomParticipant[] | undefined {
  if (!roomId) return undefined;
  return rooms.rooms.find((r) => r.id === roomId)?.participants;
}

/** Who a voice participant is: their id and the summary their voice state carries. */
export type ParticipantRef = Pick<VoiceStateLike, 'user_id' | 'user'>;

/** Name for a voice participant: PM participants, then the space member (by their space
 * profile), then the state's user. */
export function callParticipantName(st: ParticipantRef, roomId: string, spaceId: string | null | undefined): string {
  const p = roomParticipants(roomId)?.find((x) => x.id === st.user_id);
  if (p) return p.display_name || p.username;
  const m = spaceMemberOf(spaceId, st.user_id);
  if (m) return resolveSpaceUser(spaceId, st.user_id, m).name;
  return voiceParticipantName(st.user_id, st, spaceId ?? undefined);
}

export function callParticipantAvatar(st: ParticipantRef, roomId: string, spaceId: string | null | undefined): string | undefined {
  const p = roomParticipants(roomId)?.find((x) => x.id === st.user_id);
  if (p?.avatar) return p.avatar;
  const m = spaceMemberOf(spaceId, st.user_id);
  const avatar = m ? resolveSpaceUser(spaceId, st.user_id, m).avatar : undefined;
  if (avatar) return avatar;
  return st.user?.avatar;
}

/** The stage's tiles for a room (VoiceStage's `tiles`). */
export function useCallTiles(roomId: string, spaceId: string | null | undefined): CallTile[] {
  return useSolid(
    () =>
      buildCallTiles(voiceStatesForRoom(roomId), {
        meId: auth.user?.id,
        hasScreenTrack: (uid) => !!voice.media[uid]?.screen,
        nameOf: (st) => callParticipantName(st, roomId, spaceId),
        avatarOf: (st) => callParticipantAvatar(st, roomId, spaceId),
      }),
    [roomId, spaceId],
  );
}

/** Everyone else in the call (the dock's avatars), in join order. */
export function useOtherOccupants(roomId: string | null, spaceId: string | null) {
  return useSolid(() => {
    if (!roomId) return [];
    const me = auth.user?.id;
    return sortByJoined(voiceStatesForRoom(roomId))
      .filter((st) => st.user_id !== me)
      .map((st) => ({
        userId: st.user_id,
        name: callParticipantName(st, roomId, spaceId),
        avatar: callParticipantAvatar(st, roomId, spaceId),
      }));
  }, [roomId, spaceId]);
}

/** The raw states of a room, for the pure helpers (unkeyed names, absent participants). */
export function useRoomVoiceStates(roomId: string | null | undefined) {
  return useSolid(() => (roomId ? sortByJoined(voiceStatesForRoom(roomId)) : []), [roomId]);
}

export function useVoiceFocus(): string | null {
  return useSolid(() => voice.focus);
}

/** The PM call record (ringing list), when one is running in that room. */
export function useCallRecord(roomId: string | null | undefined) {
  return useSolid(() => (roomId ? voice.calls[roomId] : undefined), [roomId]);
}

/** A participant's camera / screen track sid (re-renders when it is published or removed). */
export function useMediaSid(userId: string, kind: 'user' | 'screen'): string | undefined {
  return useSolid(() => {
    const m = voice.media[userId];
    return kind === 'screen' ? m?.screen : m?.camera;
  }, [userId, kind]);
}

/** The settings the call controls read. */
export function useCallSettings() {
  return useSolid(() => ({
    inputMode: voiceSettings.inputMode,
    mirrorCamera: voiceSettings.mirrorCamera,
    noiseSuppression: noiseSuppressionEnabled(),
    facing: cameraFacing(),
    speakerphone: speakerphone(),
  }));
}

/** The viewer's voice permissions in a room (fully permissive in PMs; the server re-checks). */
export function useRoomVoicePerms(spaceId: string | null | undefined, roomId: string | null | undefined): VoicePerms {
  return useSolid(() => ({ ...voicePermsFor(auth.user?.id, spaceId ?? undefined, roomId ?? undefined) }), [spaceId, roomId]);
}

/** One person's server voice state in a room, for the user sheet. */
export function useVoiceStateOf(roomId: string | null | undefined, userId: string | null | undefined) {
  return useSolid(() => (roomId && userId ? voiceStatesForRoom(roomId).find((s) => s.user_id === userId) : undefined), [roomId, userId]);
}

/** Per-user volume (0..200) and local mute, for the user sheet. */
export function useUserPlayback(userId: string | null | undefined) {
  return useSolid(
    () => ({
      volume: userId ? (voice.userVolumes[userId] ?? 100) : 100,
      localMuted: userId ? !!voice.localMuted[userId] : false,
    }),
    [userId],
  );
}
