/**
 * Test environment for the boot / session / rooms tests: the device and the network, faked.
 *
 * jest does not apply the Metro override manifest, so what cannot load under Node is
 * replaced here - LiveKit voice, the E2EE engine, the messages store (which reaches both),
 * Tauri, native modules - while the stores the session logic runs on (auth, rooms, spaces,
 * readState, presence, relationships, stargate) and the web gateway client and API client
 * are the real ones. A fake WebSocket and a routed fetch stand in for the instance.
 *
 * Import first in a test file: jest.mock calls hoist within this module, and the modules
 * they replace are only required after it. Each test then calls resetEnv() and requires
 * what it needs afresh (jest.resetModules), so every store starts empty.
 */
import { jest } from '@jest/globals';

// ---- storage ---------------------------------------------------------------------------------

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

jest.mock('@/platform/storage', () => {
  const make = () => {
    const m = new Map<string, string | boolean | number>();
    return {
      getString: (k: string) => (typeof m.get(k) === 'string' ? (m.get(k) as string) : undefined),
      getBoolean: (k: string) => (typeof m.get(k) === 'boolean' ? (m.get(k) as boolean) : undefined),
      set: (k: string, v: string | boolean | number) => void m.set(k, v),
      remove: (k: string) => m.delete(k),
      getAllKeys: () => [...m.keys()],
      clearAll: () => m.clear(),
    };
  };
  return { webStorage: make(), appStorage: make() };
});

// The window events the app's shim provides (shims/window.ts), which the gateway client
// registers for at load, and the location.assign the web's SESSION_REVOKED handler calls.
type Listener = (ev: { type: string }) => void;
const windowListeners = new Map<string, Set<Listener>>();
Object.assign(globalThis, {
  addEventListener: (type: string, fn: Listener) => {
    if (!windowListeners.has(type)) windowListeners.set(type, new Set());
    windowListeners.get(type)!.add(fn);
  },
  removeEventListener: (type: string, fn: Listener) => void windowListeners.get(type)?.delete(fn),
  dispatchEvent: (ev: { type: string }) => {
    for (const fn of [...(windowListeners.get(ev.type) ?? [])]) fn(ev);
    return true;
  },
  location: { assign: jest.fn(), replace: jest.fn(), reload: jest.fn() },
});

/** Fire a window event, as the shims do for the network and the app state. */
export function dispatchWindowEvent(type: string): void {
  (globalThis as unknown as { dispatchEvent: (ev: { type: string }) => boolean }).dispatchEvent({ type });
}

// ---- platform modules -------------------------------------------------------------------------

jest.mock('@/platform/reload', () => ({ reloadApp: jest.fn(async () => undefined) }));
jest.mock('@/platform/shims/window', () => ({
  // As the real shim: the window events the gateway client and the instance store wait on.
  reportOnline: jest.fn((online: boolean) =>
    (globalThis as unknown as { dispatchEvent: (ev: { type: string }) => boolean }).dispatchEvent({
      type: online ? 'online' : 'offline',
    }),
  ),
  setLocationPath: jest.fn(),
}));
jest.mock('@/platform/overrides/runtime/selfcheck', () => ({ runSelfCheck: jest.fn(async () => []) }));
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn(async () => undefined) }));

jest.mock('@react-native-community/netinfo', () => {
  type MockNetState = { isConnected: boolean | null; isInternetReachable: boolean | null };
  let state: MockNetState = { isConnected: true, isInternetReachable: true };
  let listener: ((s: MockNetState) => void) | undefined;
  return {
    __esModule: true,
    default: {
      addEventListener: (fn: (s: MockNetState) => void) => {
        listener = fn;
        return () => {
          listener = undefined;
        };
      },
      fetch: async () => state,
    },
    __setNetwork(next: MockNetState) {
      state = next;
      listener?.(next);
    },
  };
});

// The desktop app's accounts file, as the Rust side (tauri-core.ts on mobile) keeps it.
//
// Not a virtual mock, though the package is not installed: jest/resolver.js resolves it to
// overrides/packages/tauri-core.ts, and the mock has to be registered under that path. Jest
// remembers which module a (file, import) pair names in a resolver shared by every test file a
// worker runs, and a virtual mock goes by the bare name. Once an earlier file in the worker had
// loaded web/src/desktop/accounts.ts for real, accounts.ts went on getting the real
// tauri-core.ts (empty storage) while the test read this fake file - green alone, red in some
// full runs.
jest.mock('@tauri-apps/api/core', () => {
  let file: unknown = null;
  return {
    invoke: jest.fn(async (cmd: string, args?: { value?: unknown }) => {
      if (cmd === 'desktop_accounts_load') return file;
      if (cmd === 'desktop_accounts_save') {
        file = args?.value ?? null;
        return undefined;
      }
      return undefined;
    }),
    __setAccountsFile(next: unknown) {
      file = next;
    },
    __accountsFile: () => file,
  };
});

// isDesktop() is true on mobile (overrides/desktop/env.ts): runtimeConfig then reads the
// instance from desktop/instanceOverride, as in the app.
jest.mock('@web/desktop/env', () => ({ isDesktop: () => true, desktopPlatform: () => 'linux' }));
jest.mock('@web/desktop/native', () => ({
  nativeNotificationsGranted: jest.fn(async () => false),
  setUnreadBadge: jest.fn(async () => undefined),
}));
jest.mock('@web/i18n', () => jest.requireActual('@/platform/overrides/i18n'));

// ---- web modules that need LiveKit, the E2EE engine or Web Audio --------------------------

jest.mock('@web/stores/voice', () => {
  const { createStore } = jest.requireActual<typeof import('solid-js/store')>('solid-js/store');
  const [voice] = createStore({ session: { status: 'idle' as string } });
  return {
    voice,
    clearVoice: jest.fn(),
    hydrateVoiceFromReady: jest.fn(),
    initVoiceHandlers: jest.fn(() => () => undefined),
    applyVoiceSettingsToSession: jest.fn(async () => undefined),
  };
});
jest.mock('@web/lib/e2ee/keyBackup', () => ({ stopBackupSync: jest.fn() }));
jest.mock('@web/lib/e2ee/service', () => ({ resyncDevice: jest.fn(async () => undefined) }));
jest.mock('@web/stores/e2eeBootstrap', () => ({ bootstrapE2EEDevice: jest.fn(async () => undefined) }));
jest.mock('@web/stores/e2eeSync', () => ({ initE2EESyncHandlers: jest.fn(() => () => undefined) }));
jest.mock('@web/stores/notificationPrefs', () => {
  const { createStore } = jest.requireActual<typeof import('solid-js/store')>('solid-js/store');
  const [notificationPrefs] = createStore({ sounds: false, volume: 0, spaceMode: 'mentions', pmMode: 'all' });
  return { notificationPrefs, playNotificationSound: () => undefined };
});
jest.mock('@web/stores/messages', () => {
  const { createStore } = jest.requireActual<typeof import('solid-js/store')>('solid-js/store');
  const [messages, setMessages] = createStore({
    byRoom: {} as Record<string, { id: string }[]>,
    loading: {} as Record<string, boolean>,
    hasMoreOlder: {} as Record<string, boolean>,
    hasMoreNewer: {} as Record<string, boolean>,
  });
  return {
    messages,
    setMessages,
    enterRoomView: jest.fn(),
    leaveRoomView: jest.fn(),
    hasPendingJump: jest.fn(() => false),
    loadMessages: jest.fn(async () => undefined),
    clearMessages: jest.fn(),
    initStargateMessageHandler: jest.fn(() => () => undefined),
    decryptServerMessages: jest.fn(async () => []),
    setMessagePinned: jest.fn(),
  };
});

// ---- the instance: fetch and the gateway socket ----------------------------------------------

export const API = 'https://chat.example.org/api';
export const INSTANCE = { domain: 'chat.example.org', apiUrl: API, stargateUrl: 'wss://chat.example.org/gateway/events' };

export interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

export function reply(status: number, body: unknown = {}): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

type Route = (init?: RequestInit) => FakeResponse | Promise<FakeResponse>;

/** Answers by path (after the API base); anything unrouted fails like a dead network. */
export type FetchMock = jest.Mock<(input: unknown, init?: RequestInit) => Promise<FakeResponse>>;

export function routeFetch(routes: Record<string, Route>): FetchMock {
  return jest.fn(async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string }).url ?? input);
    const path = url.startsWith(API) ? url.slice(API.length) : url;
    const route = routes[path.split('?')[0]!];
    if (!route) throw new TypeError('Network request failed');
    return route(init);
  });
}

export function offlineFetch(): FetchMock {
  return routeFetch({});
}

export class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  sent: { op: number; d?: unknown }[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as { op: number; d?: unknown });
  }
  close(): void {
    this.readyState = FakeSocket.CLOSED;
  }
  /** The upgrade succeeded. */
  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.onopen?.();
  }
  /** A frame from the server. */
  receive(msg: unknown): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  /** The connection went away (or the upgrade was refused: a WebSocket cannot tell). */
  drop(): void {
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.();
  }
  static latest(): FakeSocket {
    const s = FakeSocket.instances[FakeSocket.instances.length - 1];
    if (!s) throw new Error('no socket was opened');
    return s;
  }
}

(globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;

/** A clean slate: storage, sockets, module registry. Call in beforeEach. */
export function resetEnv(): void {
  memory.clear();
  windowListeners.clear();
  FakeSocket.instances = [];
  jest.resetModules();
}

/** Stored state of a signed-in app: the token and the instance it belongs to. */
export function storeSession(token = 'tok-1'): void {
  memory.set('session_token', token);
  memory.set('strafe.desktop.instance', JSON.stringify(INSTANCE));
}

/** Let promise chains and Solid effects scheduled by them run. */
export async function flush(times = 5): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/**
 * Let promise chains run until `condition` holds, and fail naming `what` if it never does -
 * for what a test is built on, so a broken precondition fails there, with its name, rather
 * than as a puzzling assertion further on.
 */
export async function until(condition: () => boolean, what: string, turns = 50): Promise<void> {
  for (let i = 0; i < turns && !condition(); i++) await Promise.resolve();
  if (!condition()) throw new Error(`boot.testenv: never happened: ${what}`);
}
