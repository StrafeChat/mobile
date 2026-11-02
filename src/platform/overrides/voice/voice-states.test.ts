/**
 * Who the voice store says is where: the real store (a line-for-line copy of the web's) with
 * LiveKit, the API and the native call engine stood in for. A snapshot from the server replaces
 * a room's list rather than merging into it, the gateway's events keep what is newer than the
 * snapshot, a stale left never touches a newer session, and a client in a call believes what
 * LiveKit tells it about who left.
 */
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { ConnectionState, RoomEvent } from 'livekit-client';
import type { VoiceJoinResult, VoiceState } from '@web/api/voice';
import { joinVoice, leaveVoice, listVoiceStates } from '@web/api/voice';
import { onStargateEvent } from '@web/services/stargate/client';
import { sendMediaKey } from '@web/lib/e2ee/callKeys';
import {
  clearVoice,
  forgetVoiceRooms,
  hydrateVoiceFromReady,
  initVoiceHandlers,
  joinVoiceRoom,
  refreshVoiceStates,
  setVoice,
  voice,
} from './stores/voice';

interface FakeRoom {
  state: ConnectionState;
  remoteParticipants: Map<string, { identity: string; setVolume: () => void }>;
  disconnect: jest.Mock<(stop?: boolean) => Promise<void>>;
  emit(event: string, ...args: unknown[]): void;
}

jest.mock('livekit-client', () => {
  const actual = jest.requireActual<typeof import('livekit-client')>('livekit-client');
  const rooms: unknown[] = [];
  class Room {
    state = actual.ConnectionState.Connected;
    remoteParticipants = new Map();
    localParticipant = {
      isE2EEEnabled: true,
      trackPublications: new Map(),
      publishTrack: async () => ({ mute: async () => undefined, unmute: async () => undefined }),
    };
    handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    disconnect = jest.fn(async () => undefined);
    connect = async () => undefined;
    setE2EEEnabled = async () => undefined;
    switchActiveDevice = async () => undefined;
    constructor() {
      rooms.push(this);
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.handlers.get(event) ?? []) fn(...args);
    }
  }
  return { ...actual, Room, __rooms: rooms };
});
jest.mock('@web/api/voice', () => ({
  declineCall: jest.fn(),
  disconnectVoiceMember: jest.fn(),
  joinVoice: jest.fn(),
  leaveVoice: jest.fn(async () => undefined),
  listVoiceStates: jest.fn(),
  moderateVoice: jest.fn(),
  patchVoiceState: jest.fn(async () => undefined),
  ringCall: jest.fn(),
}));
jest.mock('@web/stores/auth', () => ({ auth: { user: { id: 'me' } } }));
jest.mock('@web/stores/federationIds', () => ({ registerUserIdentity: jest.fn() }));
jest.mock('@web/services/stargate/client', () => ({ onStargateEvent: jest.fn(() => () => undefined) }));
jest.mock('@web/stores/voiceSettings', () => ({
  audioConstraints: () => ({}),
  setVoiceSettings: jest.fn(),
  voiceSettings: { inputMode: 'vad', inputVolume: 100, outputVolume: 100, noiseSuppression: 'off', pttKey: '' },
}));
jest.mock('@web/stores/keybinds', () => ({ comboFromEvent: jest.fn(), hasStrongModifier: jest.fn(), isTextEntry: jest.fn() }));
jest.mock('@web/lib/voice/screenShare', () => ({ screenShareCaptureOptions: jest.fn(), screenShareEncoding: jest.fn() }));
jest.mock('@web/lib/voice/stats', () => ({ sampleVoiceStats: jest.fn() }));
jest.mock('@web/lib/e2ee/callKeys', () => ({
  MEDIA_KEY_RING_SIZE: 16,
  generateMediaKey: () => new Uint8Array(32),
  onIncomingMediaKey: () => () => undefined,
  sendMediaKey: jest.fn(async () => undefined),
  userIdOfIdentity: (identity: string) => identity.split('.')[0],
}));
jest.mock('@/platform/voice/micPipeline', () => ({
  createVoiceAudioContext: () => ({ state: 'running', resume: async () => undefined, suspend: async () => undefined, close: async () => undefined }),
  createVadGate: () => ({ update: () => false, reset: () => undefined }),
  createMicPipeline: async () => ({
    source: { addEventListener: () => undefined },
    track: {},
    close: () => undefined,
    level: () => -100,
    setInputGain: () => undefined,
    setOpen: () => undefined,
  }),
}));
jest.mock('@/platform/voice/ringtone', () => ({ playRingtone: jest.fn(), stopRingtone: jest.fn() }));
jest.mock('@/platform/voice/e2ee', () => ({
  CallKeyProvider: class {
    setParticipantKey = async () => undefined;
  },
  callEncryptionSupported: () => true,
  createCallE2EEManager: () => ({ terminate: () => undefined }),
}));
jest.mock('@/platform/voice/audioSession', () => ({ selectAudioRoute: jest.fn(async () => undefined) }));
jest.mock('@/platform/voice/runtime', () => ({ initMobileVoiceRuntime: jest.fn() }));

const lastRoom = (): FakeRoom => {
  const { __rooms } = jest.requireMock<{ __rooms: FakeRoom[] }>('livekit-client');
  return __rooms[__rooms.length - 1];
};

const listStates = listVoiceStates as jest.MockedFunction<typeof listVoiceStates>;
const join = joinVoice as jest.MockedFunction<typeof joinVoice>;
const keySend = sendMediaKey as jest.MockedFunction<typeof sendMediaKey>;

function state(user: string, room: string, over: Partial<VoiceState> = {}): VoiceState {
  const session = over.session_id ?? `s-${user}`;
  return {
    user_id: user,
    room_id: room,
    session_id: session,
    identity: `${user}.${session}`,
    self_mute: false,
    self_deaf: false,
    mute: false,
    deaf: false,
    self_video: false,
    self_stream: false,
    suppress: false,
    priority_speaker: false,
    connected: true,
    joined_at: '2026-11-01T10:00:00Z',
    ...over,
  };
}

function reply(self: VoiceState, states: VoiceState[]): VoiceJoinResult {
  return { url: 'wss://sfu', token: 't', room_name: 'r', state: self, states, bitrate: 64_000, call: null };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const usersIn = (room: string) => (voice.byRoom[room] ?? []).map((s) => s.user_id).sort();
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

let gateway: (event: { t: string; d: unknown }) => void;
const voiceEvent = (d: VoiceState & { left?: boolean; moved_to?: string }) => gateway({ t: 'VOICE_STATE_UPDATE', d });

/** Into `room`, connected, with these others already there. */
async function inCall(room: string, others: VoiceState[], self = state('me', room)): Promise<FakeRoom> {
  join.mockResolvedValueOnce(reply(self, [self, ...others]));
  await joinVoiceRoom(room);
  await flush();
  const lk = lastRoom();
  for (const st of others) lk.remoteParticipants.set(st.identity!, { identity: st.identity!, setVolume: () => undefined });
  return lk;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
  clearVoice();
  jest.clearAllMocks();
  initVoiceHandlers();
  const calls = (onStargateEvent as unknown as jest.Mock).mock.calls;
  gateway = calls[calls.length - 1][0] as typeof gateway;
});

describe('a join reply is the room', () => {
  test('replaces the list, so a ghost goes and never becomes a key recipient', async () => {
    hydrateVoiceFromReady([state('ghost', 'lounge')], []);
    const self = state('me', 'lounge');
    await inCall('lounge', [state('bob', 'lounge')], self);
    expect(usersIn('lounge')).toEqual(['bob', 'me']);
    expect(keySend.mock.calls.flatMap((c) => c[2])).toEqual(['bob']);
  });

  test('someone the snapshot lists who left while it was on its way stays gone', async () => {
    const pending = deferred<VoiceJoinResult>();
    join.mockReturnValueOnce(pending.promise);
    const joining = joinVoiceRoom('lounge');
    const carol = state('carol', 'lounge');
    voiceEvent({ ...carol, left: true });
    const self = state('me', 'lounge');
    pending.resolve(reply(self, [self, carol]));
    await joining;
    expect(usersIn('lounge')).toEqual(['me']);
  });

  test('someone who arrived while it was on its way stays listed', async () => {
    const pending = deferred<VoiceJoinResult>();
    join.mockReturnValueOnce(pending.promise);
    const joining = joinVoiceRoom('lounge');
    voiceEvent(state('dave', 'lounge'));
    const self = state('me', 'lounge');
    pending.resolve(reply(self, [self]));
    await joining;
    expect(usersIn('lounge')).toEqual(['dave', 'me']);
  });

  test('someone who moved out while it was on its way follows the event, not the snapshot', async () => {
    const pending = deferred<VoiceJoinResult>();
    join.mockReturnValueOnce(pending.promise);
    const joining = joinVoiceRoom('lounge');
    voiceEvent(state('carol', 'quiet'));
    const self = state('me', 'lounge');
    pending.resolve(reply(self, [self, state('carol', 'lounge')]));
    await joining;
    expect(usersIn('lounge')).toEqual(['me']);
    expect(usersIn('quiet')).toEqual(['carol']);
  });

  test('a person listed elsewhere is taken out of that room', async () => {
    hydrateVoiceFromReady([state('carol', 'quiet')], []);
    await inCall('lounge', [state('carol', 'lounge')]);
    expect(usersIn('quiet')).toEqual([]);
    expect(voice.byRoom.quiet).toBeUndefined();
  });
});

describe('a left is matched by session', () => {
  test('a stale left neither drops the newer state nor ends the call', async () => {
    const self = state('me', 'lounge', { session_id: 's2' });
    const lk = await inCall('lounge', [], self);
    voiceEvent({ ...state('me', 'lounge', { session_id: 's1' }), left: true });
    expect(usersIn('lounge')).toEqual(['me']);
    expect(voice.session.status).toBe('connected');
    expect(lk.disconnect).not.toHaveBeenCalled();
  });

  test('the left of this session still ends the call', async () => {
    const self = state('me', 'lounge', { session_id: 's2' });
    const lk = await inCall('lounge', [], self);
    voiceEvent({ ...self, left: true });
    expect(usersIn('lounge')).toEqual([]);
    expect(voice.session.status).toBe('idle');
    expect(lk.disconnect).toHaveBeenCalled();
  });

  test('a stale left for someone else keeps them and their key', async () => {
    const carol = state('carol', 'lounge', { session_id: 's2' });
    await inCall('lounge', [carol]);
    setVoice('session', 'keyed', [carol.identity!]);
    voiceEvent({ ...state('carol', 'lounge', { session_id: 's1' }), left: true });
    expect(usersIn('lounge')).toEqual(['carol', 'me']);
    expect(voice.session.keyed).toEqual([carol.identity]);
  });

  test('a left that names no session still applies', () => {
    hydrateVoiceFromReady([state('carol', 'lounge')], []);
    voiceEvent({ ...state('carol', 'lounge'), session_id: '', left: true });
    expect(usersIn('lounge')).toEqual([]);
  });

  test('a left replayed over a join reply respects the session too', async () => {
    const pending = deferred<VoiceJoinResult>();
    join.mockReturnValueOnce(pending.promise);
    const joining = joinVoiceRoom('lounge');
    voiceEvent({ ...state('me', 'lounge', { session_id: 's1' }), left: true });
    const self = state('me', 'lounge', { session_id: 's2' });
    pending.resolve(reply(self, [self]));
    await joining;
    expect(usersIn('lounge')).toEqual(['me']);
  });
});

describe('READY', () => {
  test('keeps one room per user, the newest join', () => {
    hydrateVoiceFromReady(
      [
        state('alice', 'lounge', { joined_at: '2026-11-01T09:00:00Z' }),
        state('alice', 'quiet', { joined_at: '2026-11-01T10:00:00Z' }),
        state('bob', 'quiet', { joined_at: '2026-11-01T11:00:00Z' }),
        state('bob', 'lounge', { joined_at: '2026-11-01T08:00:00Z' }),
      ],
      [],
    );
    expect(usersIn('lounge')).toEqual([]);
    expect(usersIn('quiet')).toEqual(['alice', 'bob']);
  });

  test('a state with no readable join time loses to one with', () => {
    hydrateVoiceFromReady([state('alice', 'lounge', { joined_at: '' }), state('alice', 'quiet')], []);
    expect(usersIn('quiet')).toEqual(['alice']);
  });

  test('wins over a refresh that was already on its way', async () => {
    const pending = deferred<{ states: VoiceState[]; call: null }>();
    listStates.mockReturnValueOnce(pending.promise);
    const refreshing = refreshVoiceStates('lounge');
    hydrateVoiceFromReady([state('carol', 'lounge')], []);
    pending.resolve({ states: [state('ghost', 'lounge')], call: null });
    await refreshing;
    expect(usersIn('lounge')).toEqual(['carol']);
  });
});

describe('LiveKit says someone left', () => {
  test('they come off the lists after the grace period and keys rotate away from them', async () => {
    const bob = state('bob', 'lounge');
    const carol = state('carol', 'lounge');
    const lk = await inCall('lounge', [bob, carol]);
    setVoice('session', 'keyed', [bob.identity!, carol.identity!]);
    keySend.mockClear();

    lk.remoteParticipants.delete(carol.identity!);
    lk.emit(RoomEvent.ParticipantDisconnected, { identity: carol.identity });
    jest.advanceTimersByTime(2_999);
    expect(usersIn('lounge')).toEqual(['bob', 'carol', 'me']);

    jest.advanceTimersByTime(1);
    expect(usersIn('lounge')).toEqual(['bob', 'me']);
    expect(voice.session.keyed).toEqual([bob.identity]);

    jest.advanceTimersByTime(300);
    await flush();
    expect(keySend).toHaveBeenCalledTimes(1);
    expect(keySend.mock.calls[0][2]).toEqual(['bob']);
  });

  test('someone back under the same identity within the grace period stays', async () => {
    const carol = state('carol', 'lounge');
    const lk = await inCall('lounge', [carol]);
    lk.emit(RoomEvent.ParticipantDisconnected, { identity: carol.identity });
    jest.advanceTimersByTime(3_000);
    expect(usersIn('lounge')).toEqual(['carol', 'me']);
  });

  test('a rejoin under a new session is not removed', async () => {
    const carol = state('carol', 'lounge', { session_id: 's1' });
    const lk = await inCall('lounge', [carol]);
    lk.remoteParticipants.delete(carol.identity!);
    lk.emit(RoomEvent.ParticipantDisconnected, { identity: carol.identity });
    voiceEvent(state('carol', 'lounge', { session_id: 's2' }));
    jest.advanceTimersByTime(3_000);
    expect(usersIn('lounge')).toEqual(['carol', 'me']);
  });

  test('our own full reconnect reports everybody as gone, and nobody is removed', async () => {
    const carol = state('carol', 'lounge');
    const lk = await inCall('lounge', [carol]);
    keySend.mockClear();
    lk.remoteParticipants.clear();
    lk.emit(RoomEvent.ParticipantDisconnected, { identity: carol.identity });
    lk.state = ConnectionState.Reconnecting;
    jest.advanceTimersByTime(3_300);
    await flush();
    expect(usersIn('lounge')).toEqual(['carol', 'me']);
    expect(keySend).not.toHaveBeenCalled();
  });

  test('nothing happens once the call is over', async () => {
    const carol = state('carol', 'lounge');
    const lk = await inCall('lounge', [carol]);
    lk.remoteParticipants.delete(carol.identity!);
    lk.emit(RoomEvent.ParticipantDisconnected, { identity: carol.identity });
    voiceEvent({ ...state('me', 'lounge'), left: true });
    jest.advanceTimersByTime(3_000);
    expect(usersIn('lounge')).toEqual(['carol']);
  });

  test('a call hung up and rejoined inside the grace period is not touched by the old one', async () => {
    const carol = state('carol', 'lounge');
    const old = await inCall('lounge', [carol]);
    old.remoteParticipants.delete(carol.identity!);
    old.emit(RoomEvent.ParticipantDisconnected, { identity: carol.identity });
    voiceEvent({ ...state('me', 'lounge'), left: true });
    await inCall('lounge', [carol], state('me', 'lounge', { session_id: 's2' }));
    jest.advanceTimersByTime(3_000);
    expect(usersIn('lounge')).toEqual(['carol', 'me']);
  });
});

describe('LiveKit shows someone the server list lacks', () => {
  test('the list is refreshed and the newcomer gets our key', async () => {
    const lk = await inCall('lounge', []);
    keySend.mockClear();
    const carol = state('carol', 'lounge');
    lk.remoteParticipants.set(carol.identity!, { identity: carol.identity!, setVolume: () => undefined });
    lk.emit(RoomEvent.ParticipantConnected, lk.remoteParticipants.get(carol.identity!));
    listStates.mockResolvedValueOnce({ states: [state('me', 'lounge'), carol], call: null });
    jest.advanceTimersByTime(1_500);
    await flush();
    expect(usersIn('lounge')).toEqual(['carol', 'me']);
    jest.advanceTimersByTime(300);
    await flush();
    expect(keySend.mock.calls[0][2]).toEqual(['carol']);
  });

  test('a gateway event in time saves the request', async () => {
    const lk = await inCall('lounge', []);
    const carol = state('carol', 'lounge');
    lk.remoteParticipants.set(carol.identity!, { identity: carol.identity!, setVolume: () => undefined });
    lk.emit(RoomEvent.ParticipantConnected, lk.remoteParticipants.get(carol.identity!));
    voiceEvent(carol);
    jest.advanceTimersByTime(1_500);
    await flush();
    expect(listStates).not.toHaveBeenCalled();
  });
});

describe('refreshVoiceStates', () => {
  test('replaces, never merges', async () => {
    hydrateVoiceFromReady([state('ghost', 'lounge'), state('bob', 'lounge')], []);
    listStates.mockResolvedValueOnce({ states: [state('bob', 'lounge'), state('carol', 'lounge')], call: null });
    await refreshVoiceStates('lounge');
    expect(usersIn('lounge')).toEqual(['bob', 'carol']);
  });

  test('an empty answer empties the room', async () => {
    hydrateVoiceFromReady([state('ghost', 'lounge')], []);
    listStates.mockResolvedValueOnce({ states: [], call: null });
    await refreshVoiceStates('lounge');
    expect(voice.byRoom.lounge).toBeUndefined();
  });

  test('keeps the store object of someone still there, so their tile is not rebuilt', async () => {
    hydrateVoiceFromReady([state('bob', 'lounge'), state('ghost', 'lounge')], []);
    const before = voice.byRoom.lounge.find((s) => s.user_id === 'bob');
    listStates.mockResolvedValueOnce({ states: [state('bob', 'lounge', { self_mute: true })], call: null });
    await refreshVoiceStates('lounge');
    expect(voice.byRoom.lounge[0]).toBe(before);
    expect(voice.byRoom.lounge[0].self_mute).toBe(true);
  });

  test('events that land meanwhile go back on top of the answer', async () => {
    hydrateVoiceFromReady([state('bob', 'lounge'), state('carol', 'lounge')], []);
    const pending = deferred<{ states: VoiceState[]; call: null }>();
    listStates.mockReturnValueOnce(pending.promise);
    const refreshing = refreshVoiceStates('lounge');
    voiceEvent({ ...state('carol', 'lounge'), left: true });
    voiceEvent(state('dave', 'lounge'));
    pending.resolve({ states: [state('bob', 'lounge'), state('carol', 'lounge')], call: null });
    await refreshing;
    expect(usersIn('lounge')).toEqual(['bob', 'dave']);
  });

  test('shares a request in flight and does not repeat one just made', async () => {
    const pending = deferred<{ states: VoiceState[]; call: null }>();
    listStates.mockReturnValueOnce(pending.promise);
    const first = refreshVoiceStates('lounge');
    let secondDone = false;
    const second = refreshVoiceStates('lounge').then(() => {
      secondDone = true;
    });
    await flush();
    expect(secondDone).toBe(false);
    pending.resolve({ states: [], call: null });
    await Promise.all([first, second]);
    await refreshVoiceStates('lounge');
    expect(listStates).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5_000);
    listStates.mockResolvedValueOnce({ states: [], call: null });
    await refreshVoiceStates('lounge');
    expect(listStates).toHaveBeenCalledTimes(2);
  });

  test('a refused request changes nothing and does not reject', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    hydrateVoiceFromReady([state('bob', 'lounge')], []);
    listStates.mockRejectedValueOnce(new Error('forbidden'));
    await expect(refreshVoiceStates('lounge')).resolves.toBeUndefined();
    expect(usersIn('lounge')).toEqual(['bob']);
    warn.mockRestore();
  });

  test('sign-out wins over an answer still on its way', async () => {
    const pending = deferred<{ states: VoiceState[]; call: null }>();
    listStates.mockReturnValueOnce(pending.promise);
    const refreshing = refreshVoiceStates('lounge');
    clearVoice();
    pending.resolve({ states: [state('bob', 'lounge')], call: null });
    await refreshing;
    expect(voice.byRoom.lounge).toBeUndefined();
  });
});

describe('forgetVoiceRooms', () => {
  test('drops the rooms and leaves the rest', () => {
    hydrateVoiceFromReady([state('bob', 'lounge'), state('carol', 'quiet'), state('dave', 'other')], []);
    forgetVoiceRooms(['lounge', 'quiet']);
    expect(Object.keys(voice.byRoom)).toEqual(['other']);
    expect(leaveVoice).not.toHaveBeenCalled();
  });

  test('ends a call in one of them', async () => {
    const lk = await inCall('lounge', [state('bob', 'lounge')]);
    forgetVoiceRooms(['lounge']);
    await flush();
    expect(voice.session.status).toBe('idle');
    expect(lk.disconnect).toHaveBeenCalled();
    expect(leaveVoice).toHaveBeenCalled();
  });

  test('an answer on its way for a forgotten room is dropped', async () => {
    const pending = deferred<{ states: VoiceState[]; call: null }>();
    listStates.mockReturnValueOnce(pending.promise);
    const refreshing = refreshVoiceStates('lounge');
    forgetVoiceRooms(['lounge']);
    pending.resolve({ states: [state('bob', 'lounge')], call: null });
    await refreshing;
    expect(voice.byRoom.lounge).toBeUndefined();
  });

  test('a rejoin reads the room again at once', async () => {
    listStates.mockResolvedValueOnce({ states: [state('bob', 'lounge')], call: null });
    await refreshVoiceStates('lounge');
    forgetVoiceRooms(['lounge']);
    listStates.mockResolvedValueOnce({ states: [state('carol', 'lounge')], call: null });
    await refreshVoiceStates('lounge');
    expect(usersIn('lounge')).toEqual(['carol']);
  });

  test('SPACE_ROOM_DELETE forgets the room, in a call or not', async () => {
    hydrateVoiceFromReady([state('bob', 'lounge')], []);
    gateway({ t: 'SPACE_ROOM_DELETE', d: { room_id: 'lounge' } });
    expect(voice.byRoom.lounge).toBeUndefined();
    expect(voice.session.status).toBe('idle');
  });
});
