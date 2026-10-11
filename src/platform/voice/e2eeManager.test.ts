/**
 * The native E2EE manager's plaintext guarantees: sender cryptors are attached as soon as
 * a sender exists (before negotiation), follow key rotations, are never switched off and
 * outlive their sender; every subscribed track is decrypted, marked encrypted or not.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ConnectionState, ParticipantEvent, RoomEvent, type Room } from 'livekit-client';

interface FakeCryptor {
  id: string;
  type: 'sender' | 'receiver';
  participantId: string;
  calls: string[];
  setKeyIndex: (i: number) => Promise<boolean>;
  setEnabled: (on: boolean) => Promise<boolean>;
  dispose: () => Promise<void>;
  addEventListener: () => void;
  removeEventListener: () => void;
}

const mockCryptors: FakeCryptor[] = [];

function mockCryptor(type: 'sender' | 'receiver', participantId: string): FakeCryptor {
  const c: FakeCryptor = {
    id: `fc${mockCryptors.length}`,
    type,
    participantId,
    calls: [],
    setKeyIndex: async (i) => {
      c.calls.push(`index:${i}`);
      return true;
    },
    setEnabled: async (on) => {
      c.calls.push(`enabled:${on}`);
      return true;
    },
    dispose: async () => {
      c.calls.push('dispose');
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  mockCryptors.push(c);
  return c;
}

jest.mock('@livekit/react-native-webrtc', () => ({
  RTCFrameCryptorAlgorithm: { kAesGcm: 0 },
  RTCFrameCryptorFactory: {
    createFrameCryptorForRtpSender: (participantId: string) => mockCryptor('sender', participantId),
    createFrameCryptorForRtpReceiver: (participantId: string) => mockCryptor('receiver', participantId),
  },
}));

// eslint-disable-next-line import/first
import { CallE2EEManager } from './e2eeManager';
// eslint-disable-next-line import/first
import { senderForTrack } from './senders';

class Emitter {
  private handlers = new Map<string, ((...a: unknown[]) => void)[]>();
  on(ev: string, fn: (...a: unknown[]) => void): this {
    this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), fn]);
    return this;
  }
  emit(ev: string, ...args: unknown[]): void {
    for (const fn of this.handlers.get(ev) ?? []) fn(...args);
  }
}

function fakeKeyProvider() {
  const listeners = new Set<(id: string, idx: number) => void>();
  const latest = new Map<string, number>();
  return {
    disposed: false,
    rtcKeyProvider: { _id: 'kp' },
    latestKeyIndex: (id: string) => latest.get(id) ?? 0,
    onKeySet(fn: (id: string, idx: number) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    install(id: string, idx: number) {
      latest.set(id, idx);
      for (const l of listeners) l(id, idx);
    },
    setSifTrailer: async () => undefined,
    dispose() {
      this.disposed = true;
    },
  };
}

function fakeRoom() {
  const local = Object.assign(new Emitter(), { identity: 'me.s1', isE2EEEnabled: true });
  const room = Object.assign(new Emitter(), {
    localParticipant: local,
    state: ConnectionState.Connected as ConnectionState,
    getParticipantByIdentity: () => undefined,
  });
  return { room, local };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('CallE2EEManager', () => {
  beforeEach(() => {
    mockCryptors.length = 0;
  });

  it('attaches and enables the sender cryptor when the sender is created, before publication', async () => {
    const kp = fakeKeyProvider();
    kp.install('me.s1', 3);
    const m = new CallE2EEManager(kp as never);
    const { room, local } = fakeRoom();
    m.setup(room as unknown as Room);
    const mst = {};
    const track = { mediaStreamTrack: mst };
    const sender = { _id: 's1' };
    local.emit(ParticipantEvent.LocalSenderCreated, sender, track);
    expect(mockCryptors).toHaveLength(1);
    expect(mockCryptors[0]!.type).toBe('sender');
    expect(mockCryptors[0]!.participantId).toBe('me.s1');
    expect(senderForTrack(mst)).toBe(sender);
    await flush();
    // Key slot first, then enabled - and never disabled.
    expect(mockCryptors[0]!.calls).toEqual(['index:3', 'enabled:true']);
    // The publication that follows does not create a second cryptor.
    local.emit(ParticipantEvent.LocalTrackPublished, { track, trackSid: 'TR_a' });
    expect(mockCryptors).toHaveLength(1);
  });

  it('holds the track off until its cryptor is enabled, so no frame leaves unencrypted', async () => {
    const kp = fakeKeyProvider();
    kp.install('me.s1', 0);
    const m = new CallE2EEManager(kp as never);
    const { room, local } = fakeRoom();
    m.setup(room as unknown as Room);
    const mst = { enabled: true };
    local.emit(ParticipantEvent.LocalSenderCreated, { _id: 's1' }, { mediaStreamTrack: mst, isMuted: false });
    expect(mst.enabled).toBe(false);
    await flush();
    expect(mockCryptors[0]!.calls).toEqual(['index:0', 'enabled:true']);
    expect(mst.enabled).toBe(true);
  });

  it('does not unmute a track that was muted while its cryptor was being enabled', async () => {
    const kp = fakeKeyProvider();
    kp.install('me.s1', 0);
    const m = new CallE2EEManager(kp as never);
    const { room, local } = fakeRoom();
    m.setup(room as unknown as Room);
    const mst = { enabled: true };
    const track = { mediaStreamTrack: mst, isMuted: false };
    local.emit(ParticipantEvent.LocalSenderCreated, { _id: 's1' }, track);
    track.isMuted = true;
    await flush();
    expect(mst.enabled).toBe(false);
  });

  it('leaves a muted track alone', async () => {
    const kp = fakeKeyProvider();
    kp.install('me.s1', 0);
    const m = new CallE2EEManager(kp as never);
    const { room, local } = fakeRoom();
    m.setup(room as unknown as Room);
    const mst = { enabled: false };
    local.emit(ParticipantEvent.LocalSenderCreated, { _id: 's1' }, { mediaStreamTrack: mst, isMuted: true });
    await flush();
    expect(mst.enabled).toBe(false);
  });

  it('moves our sender to the new key slot on rotation', async () => {
    const kp = fakeKeyProvider();
    const m = new CallE2EEManager(kp as never);
    const { room, local } = fakeRoom();
    m.setup(room as unknown as Room);
    local.emit(ParticipantEvent.LocalSenderCreated, { _id: 's1' }, { mediaStreamTrack: {} });
    await flush();
    kp.install('me.s1', 1);
    kp.install('someone.else', 7);
    await flush();
    expect(mockCryptors[0]!.calls).toEqual(['index:0', 'enabled:true', 'index:1']);
  });

  it('decrypts every subscribed track, even one not marked encrypted', async () => {
    const kp = fakeKeyProvider();
    const m = new CallE2EEManager(kp as never);
    const { room } = fakeRoom();
    m.setup(room as unknown as Room);
    room.emit(RoomEvent.TrackSubscribed, { receiver: { _id: 'r1' } }, { trackSid: 'TR_b', isEncrypted: false }, { identity: 'peer.s9' });
    await flush();
    expect(mockCryptors).toHaveLength(1);
    expect(mockCryptors[0]!.type).toBe('receiver');
    expect(mockCryptors[0]!.participantId).toBe('peer.s9');
    expect(mockCryptors[0]!.calls).toContain('enabled:true');
    room.emit(RoomEvent.TrackUnsubscribed, {}, { trackSid: 'TR_b' });
    await flush();
    expect(mockCryptors[0]!.calls).toContain('dispose');
    expect(m.cryptorCount('receive')).toBe(0);
  });

  it('disposes a sender cryptor only once its track is unpublished', async () => {
    const kp = fakeKeyProvider();
    const m = new CallE2EEManager(kp as never);
    const { room, local } = fakeRoom();
    m.setup(room as unknown as Room);
    const track = { mediaStreamTrack: {} };
    local.emit(ParticipantEvent.LocalSenderCreated, { _id: 's1' }, track);
    local.emit(ParticipantEvent.LocalTrackPublished, { track, trackSid: 'TR_a' });
    await flush();
    expect(mockCryptors[0]!.calls).not.toContain('dispose');
    local.emit(ParticipantEvent.LocalTrackUnpublished, { track, trackSid: 'TR_a' });
    await flush();
    expect(mockCryptors[0]!.calls).toContain('dispose');
    expect(mockCryptors[0]!.calls).not.toContain('enabled:false');
  });

  it('on hang-up keeps sender cryptors until the room has disconnected', async () => {
    const kp = fakeKeyProvider();
    const m = new CallE2EEManager(kp as never);
    const { room, local } = fakeRoom();
    m.setup(room as unknown as Room);
    local.emit(ParticipantEvent.LocalSenderCreated, { _id: 's1' }, { mediaStreamTrack: {} });
    room.emit(RoomEvent.TrackSubscribed, { receiver: {} }, { trackSid: 'TR_r' }, { identity: 'peer.s1' });
    await flush();
    m.terminate();
    await flush();
    const [send, recv] = mockCryptors;
    expect(recv!.calls).toContain('dispose');
    expect(send!.calls).not.toContain('dispose');
    expect(kp.disposed).toBe(false);
    room.state = ConnectionState.Disconnected;
    room.emit(RoomEvent.Disconnected);
    await flush();
    expect(send!.calls).toContain('dispose');
    expect(kp.disposed).toBe(true);
    // Nothing attaches after the call is over.
    room.emit(RoomEvent.TrackSubscribed, { receiver: {} }, { trackSid: 'TR_late' }, { identity: 'peer.s1' });
    local.emit(ParticipantEvent.LocalSenderCreated, { _id: 's2' }, { mediaStreamTrack: {} });
    expect(mockCryptors).toHaveLength(2);
  });

  it('refuses data-channel encryption rather than sending data in the clear', async () => {
    const m = new CallE2EEManager(fakeKeyProvider() as never);
    expect(m.isDataChannelEncryptionEnabled).toBe(false);
    await expect(m.encryptData(new Uint8Array(1))).rejects.toThrow();
  });
});
