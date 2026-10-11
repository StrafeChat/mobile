/**
 * Test stand-ins for the voice UI's tests. Import FIRST (after src/ui/__tests__/setup.ts in
 * component tests): the jest.mock calls here register before the modules under test load.
 *
 * - The voice store is a Solid store of the real shape with jest.fn actions - the real one
 *   (src/platform/overrides/voice/stores/voice.ts) drives LiveKit and native modules.
 * - The platform call engine, permissions, keep-awake and expo-router are stubs.
 * - The few web stores the UI reads directly (auth, instance, rooms, spaces, spaceMembers,
 *   voiceSettings) are small Solid stores; the data hooks the screens use for room facts
 *   (@/data/rooms, me, spaces, users) read them. @/data/voice is the real one.
 * - The voice area's own strings are added to i18next so labels read as users hear them.
 */
 
import { jest } from '@jest/globals';
import i18next from 'i18next';

// The app's localStorage shim, reduced to what the web stores touch at load.
const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
    clear: () => memory.clear(),
    key: (i: number) => [...memory.keys()][i] ?? null,
    get length() {
      return memory.size;
    },
  },
});

// The gateway socket (the design system's presence dot reaches the presence store, which
// imports it).
jest.mock('@web/services/stargate/client', () => ({
  onStargateEvent: () => () => undefined,
  onStargateReady: () => () => undefined,
  subscribe: () => undefined,
  unsubscribe: () => undefined,
  resubscribeAll: () => undefined,
  disconnectStargate: () => undefined,
}));

jest.mock('@web/stores/notificationPrefs', () => {
  const { createStore } = require('solid-js/store');
  const [notificationPrefs, set] = createStore({ desktop: false, preview: true, whileFocused: false, sounds: true, volume: 0.6, spaceMode: 'mentions', pmMode: 'all' });
  return {
    notificationPrefs,
    setNotificationPrefs: (patch: object) => set(patch),
    playNotificationSound: () => undefined,
    showDesktopNotification: () => false,
    desktopPermission: () => 'default',
    requestDesktopPermission: async () => 'default',
  };
});

jest.mock('@web/stores/voice', () => {
  const { createStore } = require('solid-js/store');
  const idle = {
    roomId: null,
    spaceId: null,
    status: 'idle',
    selfMute: false,
    selfDeaf: false,
    camera: false,
    screen: false,
    serverMute: false,
    serverDeaf: false,
    suppress: false,
    quality: 'unknown',
    audioBlocked: false,
    videoBlocked: false,
    error: null,
    bitrate: 64000,
    encrypted: false,
    keyed: [],
  };
  const [voice, setVoice] = createStore({
    byRoom: {},
    calls: {},
    incoming: null,
    session: { ...idle },
    speaking: {},
    media: {},
    focus: null,
    userVolumes: {},
    localMuted: {},
    micLevel: -100,
    stageVisible: false,
  });
  class CallEncryptionUnsupportedError extends Error {
    constructor() {
      super('unsupported');
      this.name = 'CallEncryptionUnsupportedError';
    }
  }
  const settings = () => require('@web/stores/voiceSettings').voiceSettings;
  return {
    __idleSession: idle,
    voice,
    setVoice,
    CallEncryptionUnsupportedError,
    MAX_USER_VOLUME: 200,
    voiceStatesForRoom: (roomId: string) => voice.byRoom[roomId] ?? [],
    isConnectedTo: (roomId: string) => voice.session.roomId === roomId && voice.session.status !== 'idle',
    noiseSuppressionEnabled: () => settings().noiseSuppression !== 'off',
    joinVoiceRoom: jest.fn(async () => undefined),
    leaveVoiceRoom: jest.fn(async () => undefined),
    acceptIncomingCall: jest.fn(async () => undefined),
    declineIncomingCall: jest.fn(async () => undefined),
    toggleMute: jest.fn(),
    toggleDeafen: jest.fn(),
    toggleCamera: jest.fn(),
    setCameraEnabled: jest.fn(async () => undefined),
    setScreenShareEnabled: jest.fn(async () => undefined),
    toggleNoiseSuppression: jest.fn(),
    ringMembers: jest.fn(async () => undefined),
    enableAudioPlayback: jest.fn(async () => undefined),
    readVoiceStats: jest.fn(async () => null),
    setUserVolume: jest.fn(),
    setUserLocalMuted: jest.fn(),
    setVoiceFocus: jest.fn((key: string | null) => setVoice('focus', voice.focus === key ? null : key)),
    setVoiceStageVisible: jest.fn((v: boolean) => setVoice('stageVisible', v)),
    serverMute: jest.fn(async () => undefined),
    serverDeafen: jest.fn(async () => undefined),
    moveMember: jest.fn(async () => undefined),
    disconnectMember: jest.fn(async () => undefined),
  };
});

jest.mock('@web/stores/voiceSettings', () => {
  const { createStore } = require('solid-js/store');
  const [voiceSettings, set] = createStore({
    inputMode: 'vad',
    mirrorCamera: true,
    noiseSuppression: 'rnnoise',
    noiseSuppressionPreferred: 'rnnoise',
    screenShareResolution: '1080',
    screenShareFps: 30,
    outputDeviceId: '',
  });
  return {
    voiceSettings,
    setVoiceSettings: (patch: object) => set(patch),
    SCREEN_SHARE_RESOLUTIONS: ['720', '1080', '1440', 'source'],
    SCREEN_SHARE_FPS: [15, 30, 60],
  };
});

jest.mock('@/platform/voice', () => {
  const { createSignal } = require('solid-js');
  const [cameraFacing] = createSignal('user');
  const [speakerphone, setSpeakerphone] = createSignal(true);
  return {
    cameraFacing,
    speakerphone,
    __setSpeakerphone: setSpeakerphone,
    setPushToTalkHeld: jest.fn(),
    switchCamera: jest.fn(async () => undefined),
    screenShareSupported: jest.fn(() => true),
    callEncryptionSupported: jest.fn(() => true),
    listAudioOutputs: jest.fn(async () => ['speaker', 'earpiece']),
    selectAudioRoute: jest.fn(async () => undefined),
    showAudioRoutePicker: jest.fn(async () => undefined),
    toggleSpeakerphone: jest.fn(async () => undefined),
    setSpeakerphone: jest.fn(async () => undefined),
    VoiceVideo: () => null,
  };
});

jest.mock('@/platform/voice/ringtone', () => ({ stopRingtone: jest.fn(), playRingtone: jest.fn() }));

jest.mock('@/platform/presenters', () => ({ presentProfileSheet: jest.fn(), presentProfileSheetForParticipant: jest.fn() }));

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({}),
}));

jest.mock('expo-audio', () => ({
  getRecordingPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestRecordingPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
}));

jest.mock('expo-image-picker', () => ({
  getCameraPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(async () => undefined),
}));

jest.mock('@web/stores/auth', () => ({ auth: { user: { id: 'me', username: 'me' } } }));

jest.mock('@web/stores/instance', () => {
  const { createStore } = require('solid-js/store');
  const [instance, setInstance] = createStore({ voiceEnabled: true, loaded: true });
  return { instance, setInstance };
});

jest.mock('@web/stores/rooms', () => {
  const { createStore } = require('solid-js/store');
  const [rooms, setRooms] = createStore({ rooms: [] as unknown[] });
  return { rooms, setRooms };
});

jest.mock('@web/stores/spaces', () => {
  const { createStore } = require('solid-js/store');
  const [spaces, setSpaces] = createStore({ spaces: [] as unknown[], spaceRoomsBySpaceId: {} as Record<string, unknown[]> });
  return { spaces, setSpaces };
});

jest.mock('@web/stores/spaceMembers', () => {
  const { createStore } = require('solid-js/store');
  const [spaceMembers, setSpaceMembers] = createStore({ bySpaceId: {} as Record<string, unknown[]> });
  return { spaceMembers, setSpaceMembers };
});

jest.mock('@web/lib/voice/perms', () => {
  const perms = { connect: true, speak: true, video: true, muteMembers: false, deafenMembers: false, moveMembers: false, vad: true, priority: false };
  return {
    __perms: perms,
    voicePermsFor: jest.fn(() => ({ ...perms })),
    voiceParticipantName: (_uid: string, st?: { user?: { display_name?: string; username?: string } }) =>
      st?.user?.display_name || st?.user?.username || '…',
  };
});

jest.mock('@web/lib/e2ee/callKeys', () => ({ userIdOfIdentity: (id: string) => id.split('.')[0] }));

jest.mock('@/data/rooms', () => {
  const { useSolid } = require('@/bridge/solid');
  const { rooms } = require('@web/stores/rooms');
  const { spaces } = require('@web/stores/spaces');
  const findPm = (id: string) => rooms.rooms.find((r: { id: string }) => r.id === id);
  const findSpaceRoom = (id: string) => {
    for (const [sid, list] of Object.entries(spaces.spaceRoomsBySpaceId as Record<string, { id: string; name: string; type: number }[]>)) {
      const r = list.find((x) => x.id === id);
      if (r) return { spaceId: sid, room: r };
    }
    return undefined;
  };
  const pmDisplayName = (r: { name?: string; participants?: { id: string; display_name?: string; username: string }[] }, me: string) =>
    r.name || (r.participants ?? []).filter((p) => p.id !== me).map((p) => p.display_name || p.username).join(', ');
  const roomInfo = (id: string) => {
    const pm = findPm(id);
    if (pm) return { id, kind: pm.type === 2 ? 'group' : 'pm', name: pmDisplayName(pm, 'me') };
    const sr = findSpaceRoom(id);
    if (sr) return { id, kind: sr.room.type === 4 ? 'voice' : 'text', name: sr.room.name, spaceId: sr.spaceId };
    return undefined;
  };
  return {
    roomInfo,
    pmDisplayName,
    spaceIdOfRoom: (id: string) => findSpaceRoom(id)?.spaceId,
    useRoomInfo: (id: string | null) => useSolid(() => (id ? roomInfo(id) : undefined), [id]),
    usePmRoom: (id: string | null) => useSolid(() => (id ? findPm(id) : undefined), [id]),
  };
});

jest.mock('@/data/me', () => ({
  useMyId: () => 'me',
  useInstance: () => {
    const { useSolid } = require('@/bridge/solid');
    const { instance } = require('@web/stores/instance');
    return useSolid(() => ({ voiceEnabled: instance.voiceEnabled, loaded: true }));
  },
}));

jest.mock('@/data/spaces', () => ({
  useSpace: (id: string | null) => (id ? { id, name: `Space ${id}` } : undefined),
}));

jest.mock('@/data/users', () => ({ profileSubject: (id: string) => ({ id }) }));

// The voice area's own strings, as the app assembles them (mobile.voice.*).
const voiceEn = require('../../../i18n/areas/voice/en').default;
if (i18next.isInitialized) i18next.addResourceBundle('en', 'translation', { mobile: { voice: voiceEn } }, true, true);

export {};
