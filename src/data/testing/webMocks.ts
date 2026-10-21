/**
 * Test-only stand-ins for the web modules that cannot load under jest.
 *
 * jest does not apply the Metro override manifest, so the browser- and engine-bound modules
 * the data layer reaches (the gateway socket, LiveKit voice, the E2EE-backed messages store,
 * Tauri notification prefs) are replaced here by small Solid stores of the same shape. The
 * real store logic the hooks depend on - readState, rooms, spaces, spaceMembers, presence,
 * relationships, typing, lib/spacePermissions - is the web's own, unmocked.
 *
 * Import this first in a test file: jest.mock calls are hoisted within this module, and the
 * modules they replace are only required after it.
 */
import { jest } from '@jest/globals';
import i18next from 'i18next';

// The shims the app installs in index.ts, reduced to what the stores touch at load.
// Defined rather than tested-then-assigned: reading Node's own `localStorage` global warns.
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

// The gateway client keeps its event handlers (the stores' init*Handlers register there) so a
// test can deliver an event with emitStargateEvent; nothing arrives unless a test sends it.
type MockStargateHandler = (event: { t: string; space_id?: string; room_id?: string; user_id?: string; d: unknown }) => void;
const mockStargateHandlers = new Set<MockStargateHandler>();

jest.mock('@web/services/stargate/client', () => ({
  onStargateEvent: (h: MockStargateHandler) => {
    mockStargateHandlers.add(h);
    return () => void mockStargateHandlers.delete(h);
  },
  onStargateReady: () => () => undefined,
  subscribe: () => undefined,
  unsubscribe: () => undefined,
  resubscribeAll: () => undefined,
  disconnectStargate: () => undefined,
}));

jest.mock('@web/i18n', () => jest.requireActual('@/platform/overrides/i18n'));

jest.mock('@web/lib/e2ee/keyBackup', () => ({ stopBackupSync: () => undefined }));

jest.mock('@web/stores/notificationPrefs', () => {
  const { createStore } = jest.requireActual<typeof import('solid-js/store')>('solid-js/store');
  const [notificationPrefs, setNotificationPrefsStore] = createStore({
    desktop: false,
    preview: true,
    whileFocused: false,
    sounds: true,
    volume: 0.6,
    spaceMode: 'mentions',
    pmMode: 'all',
  });
  return {
    notificationPrefs,
    setNotificationPrefs: (patch: object) => setNotificationPrefsStore(patch),
    playNotificationSound: () => undefined,
    showDesktopNotification: () => false,
    desktopPermission: () => 'default',
    requestDesktopPermission: async () => 'default',
  };
});

jest.mock('@web/stores/voice', () => {
  const { createStore } = jest.requireActual<typeof import('solid-js/store')>('solid-js/store');
  const [voice, setVoice] = createStore({
    byRoom: {} as Record<string, unknown[]>,
    calls: {} as Record<string, unknown>,
    incoming: null,
    session: {
      roomId: null as string | null,
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
      bitrate: 0,
      encrypted: false,
      keyed: [],
    },
    speaking: {},
    media: {},
  });
  return {
    voice,
    setVoice,
    voiceStatesForRoom: (roomId: string) => voice.byRoom[roomId] ?? [],
    isConnectedTo: (roomId: string) => voice.session.roomId === roomId && voice.session.status !== 'idle',
    clearVoice: () => undefined,
    hydrateVoiceFromReady: () => undefined,
  };
});

jest.mock('@web/stores/messages', () => {
  const { createStore } = jest.requireActual<typeof import('solid-js/store')>('solid-js/store');
  const [messages, setMessages] = createStore({
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
  return {
    messages,
    setMessages,
    hasPendingJump: () => false,
    loadMessages: jest.fn(async () => undefined),
    decryptServerMessages: async (list: unknown[]) => list,
    setMessagePinned: () => undefined,
  };
});

// t() returns the key: tests assert on which string was chosen, not on its English copy.
if (!i18next.isInitialized) {
  void i18next.init({
    lng: 'en',
    resources: { en: { translation: {} } },
    initAsync: false,
    returnNull: false,
    showSupportNotice: false,
  });
}

/**
 * Deliver a gateway event to the registered handlers, in registration order, shaped as the
 * real client delivers it: the frame `{ t, space_id, d: payload }` as `event.d`.
 */
export function emitStargateEvent(t: string, payload: Record<string, unknown>): void {
  const spaceId = payload.space_id != null ? String(payload.space_id) : undefined;
  const frame = { t, space_id: spaceId, d: payload };
  for (const h of [...mockStargateHandlers]) h({ t, space_id: spaceId, room_id: spaceId, user_id: undefined, d: frame });
}
