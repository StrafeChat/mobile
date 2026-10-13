/**
 * The registration state machine against a mocked native module, a mocked OS permission
 * and a fetch that plays the push gateway and the instances: what each run sends, what it
 * caches, what it tears down, and the status it leaves for Settings.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';

// ---- mocks ------------------------------------------------------------------------------------------

type Listener = (e: never) => void;
const mockListeners = new Map<string, Set<Listener>>();
const mockNative = {
  isAvailable: jest.fn(() => true),
  getCapabilities: jest.fn(async () => ({ fcm: true, apns: false, unifiedPush: false, distributors: [] as { id: string; name: string }[], selectedDistributor: null as string | null })),
  ensureKeys: jest.fn(async (slot: string) => ({ p256dh: `pk-${slot}`, auth: `au-${slot}` })),
  deleteKeys: jest.fn(async (_slot: string) => undefined),
  getFcmToken: jest.fn(async (): Promise<string | null> => 'fcm-token-1'),
  releaseFcm: jest.fn(async () => undefined),
  getApnsEnvironment: jest.fn(async (): Promise<'sandbox' | 'production'> => 'production'),
  registerUnifiedPush: jest.fn(async (_slot: string, _distributor: string | null) => undefined),
  unregisterUnifiedPush: jest.fn(async (_slot: string) => undefined),
  getUnifiedPushEndpoint: jest.fn(async (_slot: string): Promise<{ slot: string; endpoint: string; keys?: { p256dh: string; auth: string } } | null> => null),
  setDisplayConfig: jest.fn(async (_config: unknown) => undefined),
  clearRoom: jest.fn(async () => undefined),
  clearAll: jest.fn(async (_slot: string | null) => undefined),
  addListener: jest.fn((event: string, listener: Listener) => {
    const set = mockListeners.get(event) ?? new Set<Listener>();
    set.add(listener);
    mockListeners.set(event, set);
    return { remove: () => set.delete(listener) };
  }),
};
jest.mock('@strafe/push', () => mockNative);

function emit(event: string, payload: unknown): void {
  for (const l of [...(mockListeners.get(event) ?? [])]) l(payload as never);
}

const mockPermission = {
  value: { granted: true, status: 'granted', canAskAgain: true, ios: undefined as undefined | { status: number } },
};
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => mockPermission.value),
  getDevicePushTokenAsync: jest.fn(async () => ({ type: 'ios', data: 'a1b2c3' })),
  IosAuthorizationStatus: { PROVISIONAL: 3 },
  PermissionStatus: { UNDETERMINED: 'undetermined', GRANTED: 'granted', DENIED: 'denied' },
}));

jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: { pushGateway: 'https://gw.test/' } } } }));

jest.mock('../../storage', () => {
  const make = () => {
    const m = new Map<string, unknown>();
    return {
      getBoolean: (k: string) => m.get(k) as boolean | undefined,
      getString: (k: string) => m.get(k) as string | undefined,
      set: (k: string, v: unknown) => void m.set(k, v),
      remove: (k: string) => void m.delete(k),
      clearAll: () => m.clear(),
    };
  };
  return { webStorage: make(), appStorage: make() };
});

interface Acc {
  id: string;
  userId: string;
  username: string;
  token: string;
  instance: { domain: string; apiUrl: string; stargateUrl: string };
}
const mockAccounts = { list: [] as Acc[], active: null as string | null, loaded: true };
jest.mock('@web/desktop/accounts', () => ({
  desktopAccounts: () => mockAccounts.list,
  activeDesktopAccountId: () => mockAccounts.active,
  desktopAccountsLoaded: () => mockAccounts.loaded,
}));

// Accounts whose token the start-up could not read (tauri-core.ts).
const mockUnreadable = { ids: [] as string[] };
jest.mock('../../overrides/packages/tauri-core', () => ({ unreadableAccountIds: () => mockUnreadable.ids }));

const mockAuth = { token: 'tok-a' as string | null };
jest.mock('@web/stores/auth', () => ({ auth: mockAuth }));

const mockPrefs = { desktop: false, preview: true, pmMode: 'all', spaceMode: 'mentions', sounds: true };
const mockRequestPermission = jest.fn(async () => 'granted');
const mockSetPrefs = jest.fn((patch: Record<string, unknown>) => Object.assign(mockPrefs, patch));
jest.mock('@web/stores/notificationPrefs', () => ({
  notificationPrefs: mockPrefs,
  requestDesktopPermission: () => mockRequestPermission(),
  setNotificationPrefs: (p: Record<string, unknown>) => mockSetPrefs(p),
}));

jest.mock('@web/i18n/t', () => ({ t: (key: string) => key }));

// ---- fetch: the gateway and the instances --------------------------------------------------------

interface Call {
  method: string;
  url: string;
  body: unknown;
  auth: string | undefined;
}
let calls: Call[] = [];
type Responder = (call: Call) => { status: number; body?: unknown };
let responder: Responder;

function defaultResponder(call: Call): { status: number; body?: unknown } {
  if (call.url === 'https://gw.test/v1/register') {
    const b = call.body as { platform: string; slot: string; token: string };
    return { status: 200, body: { endpoint: `https://gw.test/v1/push/${b.platform}-${b.token}-${b.slot}` } };
  }
  if (call.url.endsWith('/users/@me/push')) {
    if (call.method === 'DELETE') return { status: 204 };
    return { status: 200, body: { subscription: {} } };
  }
  return { status: 404, body: { error: 'not found' } };
}

const fetchMock = jest.fn(async (input: string, init?: RequestInit) => {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  const call: Call = {
    method: init?.method ?? 'GET',
    url: input,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    auth: headers.Authorization,
  };
  calls.push(call);
  const { status, body } = responder(call);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
});
(globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

// ---- subject ------------------------------------------------------------------------------------------

const reg = require('../registration') as typeof import('../registration');
const status = require('../status') as typeof import('../status');
const config = require('../config') as typeof import('../config');
const slots = require('../slots') as typeof import('../slots');
const { appStorage } = jest.requireMock('../../storage') as { appStorage: { clearAll(): void; getString(k: string): string | undefined } };

const A: Acc = {
  id: 'a.example:100',
  userId: '100',
  username: 'alice',
  token: 'stored-tok-a',
  instance: { domain: 'a.example', apiUrl: 'https://api.a.example/', stargateUrl: 'wss://gw.a.example' },
};
const B: Acc = {
  id: 'b.example:200',
  userId: '200',
  username: 'bob',
  token: 'tok-b',
  instance: { domain: 'b.example', apiUrl: 'https://api.b.example', stargateUrl: 'wss://gw.b.example' },
};

const setOS = (os: 'ios' | 'android') => ((Platform as { OS: string }).OS = os);
const instanceCalls = () => calls.filter((c) => c.url.includes('/users/@me/push'));
const gatewayCalls = () => calls.filter((c) => c.url.startsWith('https://gw.test/'));

beforeEach(() => {
  jest.clearAllMocks();
  appStorage.clearAll();
  mockListeners.clear();
  reg.resetPushRegistrationForTests();
  config.setPushEnabled(true);
  config.setTransportPref('auto');
  calls = [];
  responder = defaultResponder;
  mockAccounts.list = [A];
  mockAccounts.active = A.id;
  mockAccounts.loaded = true;
  mockUnreadable.ids = [];
  mockAuth.token = 'tok-a';
  mockPermission.value = { granted: true, status: 'granted', canAskAgain: true, ios: undefined };
  Object.assign(mockPrefs, { desktop: false, preview: true, pmMode: 'all', spaceMode: 'mentions', sounds: true });
  mockNative.isAvailable.mockReturnValue(true);
  setOS('android');
});

afterEach(() => {
  jest.useRealTimers();
});

describe('a first run on Android with Firebase', () => {
  it('registers the token with the gateway, subscribes on the instance and goes active', async () => {
    await reg.ensurePushRegistration();
    const slot = slots.slotFor(A.id);

    expect(gatewayCalls()).toEqual([
      {
        method: 'POST',
        url: 'https://gw.test/v1/register',
        body: { platform: 'fcm', token: 'fcm-token-1', slot, sandbox: false, fallback: 'mobile.push.fallback' },
        auth: undefined,
      },
    ]);
    expect(instanceCalls()).toEqual([
      {
        method: 'PUT',
        url: 'https://api.a.example/users/@me/push',
        // The live session's token, not the stored copy.
        auth: 'Bearer tok-a',
        body: {
          endpoint: `https://gw.test/v1/push/fcm-fcm-token-1-${slot}`,
          keys: { p256dh: `pk-${slot}`, auth: `au-${slot}` },
          kind: 'fcm',
          prefs: { preview: true, pm: 'all', space: 'mentions', calls: true },
        },
      },
    ]);
    expect(status.pushStatus()).toEqual({ state: 'active', transport: { kind: 'fcm' } });
    expect(mockNative.setDisplayConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        activeSlot: slot,
        preview: true,
        sounds: true,
        accounts: [{ slot, userId: '100', label: '@alice', apiBase: 'https://api.a.example', token: 'tok-a' }],
      }),
    );
  });

  it('does no network work on a run where nothing changed', async () => {
    await reg.ensurePushRegistration();
    calls = [];
    await reg.ensurePushRegistration();
    expect(calls).toEqual([]);
    expect(mockNative.setDisplayConfig).toHaveBeenCalledTimes(1);
  });

  it('sends a preference change as a PATCH', async () => {
    await reg.ensurePushRegistration();
    calls = [];
    mockPrefs.spaceMode = 'all';
    mockPrefs.preview = false;
    await reg.ensurePushRegistration();
    expect(gatewayCalls()).toEqual([]);
    expect(instanceCalls()).toEqual([
      expect.objectContaining({ method: 'PATCH', body: { prefs: { preview: false, pm: 'all', space: 'all', calls: true } } }),
    ]);
    // ...and the renderer hears about the preview change too.
    expect(mockNative.setDisplayConfig).toHaveBeenLastCalledWith(expect.objectContaining({ preview: false }));
  });

  it('falls back to a PUT when the instance no longer has the subscription', async () => {
    await reg.ensurePushRegistration();
    calls = [];
    responder = (c) => (c.method === 'PATCH' ? { status: 404, body: { error: 'no subscription' } } : defaultResponder(c));
    mockPrefs.pmMode = 'none';
    await reg.ensurePushRegistration();
    expect(instanceCalls().map((c) => c.method)).toEqual(['PATCH', 'PUT']);
    expect(status.pushStatus().state).toBe('active');
  });

  it('re-sends the subscription once a day', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await reg.ensurePushRegistration();
    calls = [];
    now.mockReturnValue(1_000_000 + reg.SUBSCRIPTION_REFRESH_MS + 1);
    await reg.ensurePushRegistration();
    expect(instanceCalls().map((c) => c.method)).toEqual(['PUT']);
    expect(gatewayCalls()).toEqual([]);
    now.mockRestore();
  });

  it('re-registers with the gateway when Firebase rotates the token', async () => {
    await reg.ensurePushRegistration();
    calls = [];
    mockNative.getFcmToken.mockResolvedValueOnce('fcm-token-2');
    await reg.ensurePushRegistration();
    expect(gatewayCalls()).toHaveLength(1);
    expect((gatewayCalls()[0]!.body as { token: string }).token).toBe('fcm-token-2');
    expect(instanceCalls().map((c) => c.method)).toEqual(['PUT']);
  });

  it('waits for the token when Firebase has none yet', async () => {
    mockNative.getFcmToken.mockResolvedValueOnce(null);
    await reg.ensurePushRegistration();
    expect(calls).toEqual([]);
    expect(status.pushStatus()).toEqual({ state: 'registering', transport: { kind: 'fcm' } });
  });

  it('coalesces triggers that arrive while a run is waiting', async () => {
    await Promise.all([reg.ensurePushRegistration(), reg.ensurePushRegistration(), reg.ensurePushRegistration()]);
    expect(mockNative.getCapabilities).toHaveBeenCalledTimes(1);
  });
});

describe('every account on the device', () => {
  it('registers each with its own slot, token and instance; the open one first', async () => {
    mockAccounts.list = [B, A];
    await reg.ensurePushRegistration();
    const puts = instanceCalls().filter((c) => c.method === 'PUT');
    expect(puts.map((c) => [c.url, c.auth])).toEqual([
      ['https://api.a.example/users/@me/push', 'Bearer tok-a'],
      ['https://api.b.example/users/@me/push', 'Bearer tok-b'],
    ]);
    const config = mockNative.setDisplayConfig.mock.calls[0]![0] as { accounts: { label: string; slot: string }[]; activeSlot: string };
    expect(config.accounts.map((a) => a.label)).toEqual(['@alice', '@bob@b.example']);
    expect(config.activeSlot).toBe(slots.slotFor(A.id));
    expect(slots.slotFor(A.id)).not.toBe(slots.slotFor(B.id));
  });

  it('a failure of another account leaves the open one active', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockAccounts.list = [A, B];
    responder = (c) => (c.url.startsWith('https://api.b.example') ? { status: 401, body: { error: 'session revoked' } } : defaultResponder(c));
    await reg.ensurePushRegistration();
    expect(status.pushStatus().state).toBe('active');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("releases a slot whose account left the device: keys, UnifiedPush, notifications", async () => {
    mockAccounts.list = [A, B];
    await reg.ensurePushRegistration();
    const slotB = slots.slotFor(B.id);
    mockAccounts.list = [A];
    await reg.ensurePushRegistration();
    expect(mockNative.deleteKeys).toHaveBeenCalledWith(slotB);
    expect(mockNative.unregisterUnifiedPush).toHaveBeenCalledWith(slotB);
    expect(mockNative.clearAll).toHaveBeenCalledWith(slotB);
    expect(slots.existingSlot(B.id)).toBeNull();
  });

  it('does nothing until the account list has loaded', async () => {
    mockAccounts.loaded = false;
    await reg.ensurePushRegistration();
    expect(mockNative.getCapabilities).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('a start that could not read every account (iOS, locked) keeps the missing one and goes ahead for the rest', async () => {
    mockAccounts.list = [A, B];
    await reg.ensurePushRegistration();
    const slotA = slots.slotFor(A.id);
    const slotB = slots.slotFor(B.id);
    jest.clearAllMocks();
    calls = [];

    // B's token was refused: the list has only A, and B is still here. Its slot is not an
    // orphan, and the renderer is not handed a config without it.
    mockUnreadable.ids = [B.id];
    mockAccounts.list = [A];
    await reg.ensurePushRegistration();
    expect(mockNative.deleteKeys).not.toHaveBeenCalled();
    expect(mockNative.clearAll).not.toHaveBeenCalled();
    expect(mockNative.setDisplayConfig).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(slots.existingSlot(B.id)).toBe(slotB);

    // A must not wait for B, which may never be readable again (a keystore fault): a new
    // Firebase token still reaches its instance...
    mockNative.getFcmToken.mockResolvedValueOnce('fcm-token-2');
    await reg.ensurePushRegistration();
    expect((gatewayCalls()[0]!.body as { token: string; slot: string }).slot).toBe(slotA);
    expect(instanceCalls().map((c) => [c.method, c.url])).toEqual([['PUT', 'https://api.a.example/users/@me/push']]);
    expect(status.pushStatus().state).toBe('active');

    // ...and turning push off tears A down. B keeps its keys and records, for the run that
    // has it again.
    calls = [];
    config.setPushEnabled(false);
    await reg.ensurePushRegistration();
    expect(instanceCalls().map((c) => [c.method, c.url])).toEqual([['DELETE', 'https://api.a.example/users/@me/push']]);
    expect(mockNative.releaseFcm).toHaveBeenCalled();
    expect(mockNative.deleteKeys).toHaveBeenCalledWith(slotA);
    expect(mockNative.deleteKeys).not.toHaveBeenCalledWith(slotB);
    expect(reg.hasStoredSubscription(slotB)).toBe(true);
    expect(slots.existingSlot(B.id)).toBe(slotB);
    expect(mockNative.setDisplayConfig).not.toHaveBeenCalled();
    expect(status.pushStatus()).toEqual({ state: 'disabled' });

    // An account leaving meanwhile goes, but the renderer is not handed the partial list.
    await reg.forgetPushAccount(A.id, { server: false });
    expect(mockNative.clearAll).toHaveBeenCalledWith(slotA);
    expect(mockNative.deleteKeys).not.toHaveBeenCalledWith(slotB);
    expect(mockNative.setDisplayConfig).not.toHaveBeenCalled();

    // B is in the list again (READY brought it back; the save that would note it may still
    // be on its way): runs carry on, and B's instance hears that push went off.
    mockAccounts.list = [B];
    mockAccounts.active = B.id;
    mockAuth.token = B.token;
    calls = [];
    await reg.ensurePushRegistration();
    expect(mockNative.setDisplayConfig).toHaveBeenCalledWith(expect.objectContaining({ accounts: [expect.objectContaining({ slot: slotB })] }));
    expect(instanceCalls().map((c) => [c.method, c.url, c.auth])).toEqual([['DELETE', 'https://api.b.example/users/@me/push', 'Bearer tok-b']]);
    expect(mockNative.deleteKeys).toHaveBeenCalledWith(slotB);

    jest.clearAllMocks();
    calls = [];
    config.setPushEnabled(true);
    await reg.ensurePushRegistration();
    expect(instanceCalls().map((c) => [c.method, c.url])).toEqual([['PUT', 'https://api.b.example/users/@me/push']]);
    expect(mockNative.deleteKeys).not.toHaveBeenCalledWith(slotB);

    // Or a later start read the list whole.
    mockUnreadable.ids = [];
    mockAccounts.list = [A, B];
    await reg.ensurePushRegistration();
    expect(mockNative.setDisplayConfig).toHaveBeenLastCalledWith(expect.objectContaining({ accounts: expect.arrayContaining([expect.objectContaining({ slot: slotB })]) }));
  });
});

describe('turning push off', () => {
  it('unsubscribes on the instance and drops the keys', async () => {
    await reg.ensurePushRegistration();
    const slot = slots.slotFor(A.id);
    calls = [];
    config.setPushEnabled(false);
    await reg.ensurePushRegistration();
    expect(instanceCalls()).toEqual([expect.objectContaining({ method: 'DELETE', url: 'https://api.a.example/users/@me/push', auth: 'Bearer tok-a' })]);
    expect(mockNative.deleteKeys).toHaveBeenCalledWith(slot);
    expect(status.pushStatus()).toEqual({ state: 'disabled' });

    // Back on: everything is sent again.
    calls = [];
    config.setPushEnabled(true);
    await reg.ensurePushRegistration();
    expect(instanceCalls().map((c) => c.method)).toEqual(['PUT']);
  });

  it('still tells the instance after a refresh that failed (it keeps the earlier subscription)', async () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValue(1_000_000);
    await reg.ensurePushRegistration();
    now.mockReturnValue(1_000_000 + reg.SUBSCRIPTION_REFRESH_MS + 1);
    responder = (c) => (c.method === 'PUT' ? { status: 500, body: { error: 'internal error' } } : defaultResponder(c));
    await reg.ensurePushRegistration();
    expect(status.pushStatus()).toMatchObject({ state: 'error', where: 'instance' });
    expect(reg.hasStoredSubscription(slots.slotFor(A.id))).toBe(false);
    now.mockRestore();

    responder = defaultResponder;
    calls = [];
    config.setPushEnabled(false);
    await reg.ensurePushRegistration();
    expect(instanceCalls().map((c) => c.method)).toEqual(['DELETE']);
    // Told once: the next run with push off has nothing more to say.
    calls = [];
    await reg.ensurePushRegistration();
    expect(instanceCalls()).toEqual([]);
  });

  it('a first PUT that failed may still have reached the instance: withdrawn permission sends a DELETE', async () => {
    responder = (c) => (c.method === 'PUT' ? { status: 502, body: { error: 'bad gateway' } } : defaultResponder(c));
    await reg.ensurePushRegistration();
    responder = defaultResponder;
    calls = [];
    mockPermission.value = { granted: false, status: 'denied', canAskAgain: false, ios: undefined };
    await reg.ensurePushRegistration();
    expect(instanceCalls().map((c) => c.method)).toEqual(['DELETE']);
  });

  it('nothing ever sent: nothing to withdraw', async () => {
    config.setPushEnabled(false);
    await reg.ensurePushRegistration();
    expect(instanceCalls()).toEqual([]);
  });
});

describe('the notification permission', () => {
  it('asks once, after sign-in, and turns the in-app notifications on when allowed', async () => {
    mockPermission.value = { granted: false, status: 'undetermined', canAskAgain: true, ios: undefined };
    mockRequestPermission.mockResolvedValueOnce('granted');
    await reg.ensurePushRegistration();
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(mockSetPrefs).toHaveBeenCalledWith({ desktop: true });
    expect(status.pushStatus().state).toBe('active');
  });

  it('never nags: refused once, not asked again', async () => {
    mockPermission.value = { granted: false, status: 'undetermined', canAskAgain: true, ios: undefined };
    mockRequestPermission.mockResolvedValueOnce('denied');
    await reg.ensurePushRegistration();
    await reg.ensurePushRegistration();
    expect(mockRequestPermission).toHaveBeenCalledTimes(1);
    expect(status.pushStatus()).toEqual({ state: 'permission' });
    expect(instanceCalls()).toEqual([]);
  });

  it('does not ask while signed out', async () => {
    mockPermission.value = { granted: false, status: 'undetermined', canAskAgain: true, ios: undefined };
    mockAccounts.active = null;
    mockAuth.token = null;
    await reg.ensurePushRegistration();
    expect(mockRequestPermission).not.toHaveBeenCalled();
  });

  it('withdrawn in the system settings: the instance is told to stop', async () => {
    await reg.ensurePushRegistration();
    calls = [];
    mockPermission.value = { granted: false, status: 'denied', canAskAgain: false, ios: undefined };
    await reg.ensurePushRegistration();
    expect(instanceCalls().map((c) => c.method)).toEqual(['DELETE']);
    expect(mockNative.deleteKeys).not.toHaveBeenCalled();
    expect(status.pushStatus()).toEqual({ state: 'permission' });
  });
});

describe('choosing a transport', () => {
  const caps = (fcm: boolean, distributors: { id: string; name: string }[]) => ({
    fcm,
    apns: false,
    unifiedPush: distributors.length > 0,
    distributors,
    selectedDistributor: null,
  });

  it('chooseAndroidTransport follows the preference against what the device has', () => {
    const ntfy = { id: 'io.heckel.ntfy', name: 'ntfy' };
    const np = { id: 'org.unifiedpush.distributor.nextpush', name: 'NextPush' };
    expect(reg.chooseAndroidTransport('auto', caps(true, [ntfy]), false)).toEqual({ kind: 'fcm' });
    expect(reg.chooseAndroidTransport('auto', caps(false, [ntfy]), false)).toEqual({ kind: 'unifiedpush', distributor: ntfy });
    expect(reg.chooseAndroidTransport('auto', caps(false, [ntfy, np]), false)).toEqual({ kind: 'none', reason: 'choose-distributor' });
    expect(reg.chooseAndroidTransport('auto', caps(false, []), false)).toEqual({ kind: 'none', reason: 'none' });
    expect(reg.chooseAndroidTransport('fcm', caps(false, [ntfy]), false)).toEqual({ kind: 'none', reason: 'fcm-unavailable' });
    expect(reg.chooseAndroidTransport(`unifiedpush:${np.id}`, caps(true, [ntfy, np]), false)).toEqual({ kind: 'unifiedpush', distributor: np });
    expect(reg.chooseAndroidTransport(`unifiedpush:${np.id}`, caps(true, [ntfy]), false)).toEqual({ kind: 'none', reason: 'distributor-missing' });
    // The debug transport exists in development builds only.
    expect(reg.chooseAndroidTransport('debug', caps(true, []), true)).toEqual({ kind: 'debug' });
    expect(reg.chooseAndroidTransport('debug', caps(true, []), false)).toEqual({ kind: 'fcm' });
  });

  it('no transport: says why, and nothing is subscribed', async () => {
    mockNative.getCapabilities.mockResolvedValue(caps(false, []));
    await reg.ensurePushRegistration();
    expect(status.pushStatus()).toEqual({ state: 'no-transport', reason: 'none' });
    expect(calls).toEqual([]);
    mockNative.getCapabilities.mockReset();
    mockNative.getCapabilities.mockImplementation(async () => caps(true, []));
  });

  it('UnifiedPush: registers the slot, waits for the endpoint, sends the slot keys', async () => {
    const ntfy = { id: 'io.heckel.ntfy', name: 'ntfy' };
    mockNative.getCapabilities.mockResolvedValue(caps(false, [ntfy]));
    const slot = slots.slotFor(A.id);
    const slotKeys = { p256dh: `pk-${slot}`, auth: `au-${slot}` };
    mockNative.registerUnifiedPush.mockImplementationOnce(async (s: string) => {
      setTimeout(() => emit('unifiedPushEndpoint', { slot: s, endpoint: 'https://ntfy.example/up123', keys: slotKeys }), 0);
    });
    await reg.ensurePushRegistration();
    expect(mockNative.registerUnifiedPush).toHaveBeenCalledWith(slot, ntfy.id);
    expect(gatewayCalls()).toEqual([]);
    expect(instanceCalls()).toEqual([
      expect.objectContaining({
        method: 'PUT',
        body: { endpoint: 'https://ntfy.example/up123', keys: slotKeys, kind: 'unifiedpush', prefs: expect.anything() },
      }),
    ]);
    expect(status.pushStatus()).toEqual({ state: 'active', transport: { kind: 'unifiedpush', distributorId: ntfy.id, distributorName: 'ntfy' } });

    // Next run: the endpoint UnifiedPush gave is reused, not registered again.
    mockNative.getUnifiedPushEndpoint.mockResolvedValueOnce({ slot, endpoint: 'https://ntfy.example/up123', keys: slotKeys });
    calls = [];
    await reg.ensurePushRegistration();
    expect(mockNative.registerUnifiedPush).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);

    // The slot's keys were remade natively (the old ones could never be opened again): the
    // endpoint's record still names the old ones, the instance gets the new ones.
    mockNative.getUnifiedPushEndpoint.mockResolvedValueOnce({ slot, endpoint: 'https://ntfy.example/up123', keys: slotKeys });
    mockNative.ensureKeys.mockResolvedValueOnce({ p256dh: 'pk-new', auth: 'au-new' });
    await reg.ensurePushRegistration();
    expect(mockNative.registerUnifiedPush).toHaveBeenCalledTimes(1);
    expect(instanceCalls()).toEqual([
      expect.objectContaining({ method: 'PUT', body: expect.objectContaining({ endpoint: 'https://ntfy.example/up123', keys: { p256dh: 'pk-new', auth: 'au-new' } }) }),
    ]);

    // Switching to Firebase releases the distributor.
    calls = [];
    mockNative.getCapabilities.mockResolvedValue(caps(true, [ntfy]));
    config.setTransportPref('fcm');
    await reg.ensurePushRegistration();
    expect(mockNative.unregisterUnifiedPush).toHaveBeenCalledWith(slot);
    expect(instanceCalls().map((c) => (c.body as { kind?: string } | undefined)?.kind)).toEqual(['fcm']);
    mockNative.getCapabilities.mockReset();
    mockNative.getCapabilities.mockImplementation(async () => caps(true, []));
  });

  it('leaving Firebase lets go of its token with Google; staying on it does not', async () => {
    const ntfy = { id: 'io.heckel.ntfy', name: 'ntfy' };
    await reg.ensurePushRegistration();
    await reg.ensurePushRegistration();
    expect(mockNative.releaseFcm).not.toHaveBeenCalled();

    // To UnifiedPush.
    mockNative.getCapabilities.mockResolvedValue(caps(true, [ntfy]));
    mockNative.registerUnifiedPush.mockImplementationOnce(async (s: string) => {
      setTimeout(() => emit('unifiedPushEndpoint', { slot: s, endpoint: 'https://ntfy.example/up1' }), 0);
    });
    config.setTransportPref(`unifiedpush:${ntfy.id}`);
    await reg.ensurePushRegistration();
    expect(mockNative.releaseFcm).toHaveBeenCalledTimes(1);

    // Back to Firebase, then push off: released again, once.
    config.setTransportPref('fcm');
    await reg.ensurePushRegistration();
    config.setPushEnabled(false);
    await reg.ensurePushRegistration();
    await reg.ensurePushRegistration();
    expect(mockNative.releaseFcm).toHaveBeenCalledTimes(2);
    mockNative.getCapabilities.mockReset();
    mockNative.getCapabilities.mockImplementation(async () => caps(true, []));
  });

  it('UnifiedPush refusing is reported', async () => {
    const ntfy = { id: 'io.heckel.ntfy', name: 'ntfy' };
    mockNative.getCapabilities.mockResolvedValue(caps(false, [ntfy]));
    mockNative.registerUnifiedPush.mockImplementationOnce(async (s: string) => {
      setTimeout(() => emit('unifiedPushFailed', { slot: s, reason: 'ACTION_REQUIRED' }), 0);
    });
    await reg.ensurePushRegistration();
    expect(status.pushStatus()).toMatchObject({ state: 'error', where: 'distributor', detail: 'ACTION_REQUIRED' });
    mockNative.getCapabilities.mockReset();
    mockNative.getCapabilities.mockImplementation(async () => caps(true, []));
  });

  it('the development transport registers as the gateway debug platform and an FCM device', async () => {
    config.setTransportPref('debug');
    await reg.ensurePushRegistration();
    expect(gatewayCalls()[0]!.body).toMatchObject({ platform: 'debug', token: 'emulator', sandbox: false });
    expect((instanceCalls()[0]!.body as { kind: string }).kind).toBe('fcm');
    expect(status.pushStatus()).toEqual({ state: 'active', transport: { kind: 'debug' } });
  });

  it('iOS: the APNs token and the build’s environment', async () => {
    setOS('ios');
    mockNative.getApnsEnvironment.mockResolvedValueOnce('sandbox');
    await reg.ensurePushRegistration();
    expect(gatewayCalls()[0]!.body).toMatchObject({ platform: 'apns', token: 'a1b2c3', sandbox: true });
    expect((instanceCalls()[0]!.body as { kind: string }).kind).toBe('apns');
    // No tokens for the native side on iOS: its actions go through the app.
    const config = mockNative.setDisplayConfig.mock.calls[0]![0] as { accounts: Record<string, unknown>[] };
    expect(config.accounts[0]).not.toHaveProperty('token');
  });
});

describe('errors', () => {
  it('a gateway failure', async () => {
    responder = (c) => (c.url.startsWith('https://gw.test/') ? { status: 400, body: { error: 'platform not configured' } } : defaultResponder(c));
    await reg.ensurePushRegistration();
    expect(status.pushStatus()).toEqual({ state: 'error', where: 'gateway', transport: { kind: 'fcm' }, detail: 'platform not configured' });
    expect(instanceCalls()).toEqual([]);
  });

  it('an instance without push', async () => {
    responder = (c) => (c.url.endsWith('/users/@me/push') ? { status: 404, body: { error: 'push is disabled' } } : defaultResponder(c));
    await reg.ensurePushRegistration();
    expect(status.pushStatus()).toMatchObject({ state: 'error', where: 'unsupported' });
  });

  it('an instance that refuses the endpoint, then accepts it on the next run', async () => {
    responder = (c) => (c.method === 'PUT' ? { status: 400, body: { error: 'endpoint host not allowed' } } : defaultResponder(c));
    await reg.ensurePushRegistration();
    expect(status.pushStatus()).toMatchObject({ state: 'error', where: 'instance', detail: 'endpoint host not allowed' });
    responder = defaultResponder;
    calls = [];
    await reg.ensurePushRegistration();
    expect(instanceCalls().map((c) => c.method)).toEqual(['PUT']);
    expect(status.pushStatus().state).toBe('active');
  });

  it('a build without the native module', async () => {
    mockNative.isAvailable.mockReturnValue(false);
    await reg.ensurePushRegistration();
    expect(status.pushStatus()).toEqual({ state: 'unavailable' });
  });
});

describe('an account leaving the device', () => {
  it('unsubscribes with its session, then forgets its keys and notifications', async () => {
    mockAccounts.list = [A, B];
    await reg.ensurePushRegistration();
    const slotB = slots.slotFor(B.id);
    calls = [];
    await reg.forgetPushAccount(B.id, { server: true });
    expect(instanceCalls()).toEqual([expect.objectContaining({ method: 'DELETE', url: 'https://api.b.example/users/@me/push', auth: 'Bearer tok-b' })]);
    expect(mockNative.deleteKeys).toHaveBeenCalledWith(slotB);
    expect(mockNative.clearAll).toHaveBeenCalledWith(slotB);
    const config = mockNative.setDisplayConfig.mock.lastCall![0] as { accounts: { slot: string }[] };
    expect(config.accounts.map((a) => a.slot)).toEqual([slots.slotFor(A.id)]);
    expect(slots.existingSlot(B.id)).toBeNull();
  });

  it('with the session already gone, only forgets locally', async () => {
    await reg.ensurePushRegistration();
    calls = [];
    await reg.forgetPushAccount(A.id, { server: false });
    expect(calls).toEqual([]);
    expect(mockNative.deleteKeys).toHaveBeenCalled();
  });
});

describe('subscriptionChange', () => {
  const prefs = { preview: true, pm: 'all' as const, space: 'mentions' as const, calls: true };
  const base = { accountId: 'x', endpoint: 'https://e', keys: { p256dh: 'p', auth: 'a' }, kind: 'fcm' as const, prefs };
  it('diffs against what the instance was last sent', () => {
    expect(reg.subscriptionChange(null, base, 0)).toBe('put');
    expect(reg.subscriptionChange({ ...base, at: 0 }, base, 1)).toBe('none');
    expect(reg.subscriptionChange({ ...base, at: 0 }, base, 1, true)).toBe('put');
    expect(reg.subscriptionChange({ ...base, at: 0 }, { ...base, endpoint: 'https://f' }, 1)).toBe('put');
    expect(reg.subscriptionChange({ ...base, at: 0 }, { ...base, keys: { p256dh: 'p', auth: 'b' } }, 1)).toBe('put');
    expect(reg.subscriptionChange({ ...base, at: 0 }, { ...base, kind: 'unifiedpush' }, 1)).toBe('put');
    expect(reg.subscriptionChange({ ...base, at: 0 }, { ...base, accountId: 'y' }, 1)).toBe('put');
    expect(reg.subscriptionChange({ ...base, at: 0 }, { ...base, prefs: { ...prefs, space: 'all' } }, 1)).toBe('patch');
    expect(reg.subscriptionChange({ ...base, at: 0 }, base, reg.SUBSCRIPTION_REFRESH_MS + 1)).toBe('put');
  });
});
