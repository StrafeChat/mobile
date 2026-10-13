/**
 * The account list behind the desktop accounts store, against a keychain that behaves like
 * iOS's: tokens a locked start can read, and a list that is never cut down to what one start
 * happened to be able to read - while only a refusal that may be the lock holds anything up.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

// ---- mocks ------------------------------------------------------------------------------------------

/**
 * iOS keychain semantics, as expo-secure-store meets them: an item of the default class
 * (only while unlocked) can be neither read nor updated while the phone is locked, deleting
 * always works, and setting an existing item updates its value but never its class.
 */
const mockKeychain = { items: new Map<string, { value: string; cls: string }>(), locked: false };
const mockReadableLocked = (cls: string) => cls === 'afterFirstUnlockThisDeviceOnly';
// One set of functions for every start (each start loads the module in its own registry).
const mockSecureStore = {
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
  getItemAsync: jest.fn(async (key: string, _opts?: unknown) => {
    const item = mockKeychain.items.get(key);
    if (!item) return null;
    if (mockKeychain.locked && !mockReadableLocked(item.cls)) throw new Error('errSecInteractionNotAllowed');
    return item.value;
  }),
  setItemAsync: jest.fn(async (key: string, value: string, opts?: { keychainAccessible?: string }) => {
    const cls = mockKeychain.items.get(key)?.cls ?? opts?.keychainAccessible ?? 'whenUnlocked';
    if (mockKeychain.locked && !mockReadableLocked(cls)) throw new Error('errSecInteractionNotAllowed');
    mockKeychain.items.set(key, { value, cls });
  }),
  deleteItemAsync: jest.fn(async (key: string, _opts?: unknown) => void mockKeychain.items.delete(key)),
};
jest.mock('expo-secure-store', () => mockSecureStore);

// AppState (where the app is, and its listeners, across starts) and the platform the next start
// runs on. The rest of react-native is the real one.
const mockAppState = {
  currentState: 'background',
  listeners: new Set<(state: string) => void>(),
  addEventListener(_event: string, fn: (state: string) => void) {
    mockAppState.listeners.add(fn);
    return { remove: () => void mockAppState.listeners.delete(fn) };
  },
};
const mockPlatform = { OS: 'ios' as 'ios' | 'android' };
jest.mock('react-native', () =>
  Object.create(jest.requireActual('react-native'), {
    AppState: { value: mockAppState },
    Platform: { value: mockPlatform },
  }),
);

const mockReload = jest.fn(async (_reason?: string) => undefined);
jest.mock('../../../reload', () => ({ reloadApp: (reason?: string) => mockReload(reason) }));

// MMKV outlives a restart: one map for every load of the module.
const mockStore = new Map<string, unknown>();
jest.mock('../../../storage', () => ({
  appStorage: {
    getBoolean: (k: string) => mockStore.get(k) as boolean | undefined,
    getString: (k: string) => mockStore.get(k) as string | undefined,
    set: (k: string, v: unknown) => void mockStore.set(k, v),
    remove: (k: string) => void mockStore.delete(k),
  },
}));

// ---- helpers ------------------------------------------------------------------------------------------

type Core = typeof import('../tauri-core');

const AFTER_FIRST_UNLOCK = 'afterFirstUnlockThisDeviceOnly';
const OPTIONS = { keychainAccessible: AFTER_FIRST_UNLOCK };
const A = 'a.example:100';
const B = 'b.example:200';
const tokenKey = (id: string) => `strafe.token.${id.replace(/[^A-Za-z0-9._-]/g, '_')}`;

function entry(id: string) {
  const [domain, userId] = id.split(':');
  return {
    id,
    instance: { domain, apiUrl: `https://${domain}/api`, stargateUrl: `wss://${domain}/gw` },
    userId,
    username: `user${userId}`,
    displayName: `User ${userId}`,
    addedAt: 1,
    lastUsedAt: 1,
  };
}

/** What an earlier version left on the device: the list in MMKV, each token in the keychain. */
function seed(tokens: Record<string, string | null>, cls = 'whenUnlocked'): void {
  mockStore.set('accounts.v1', JSON.stringify({ version: 1, active: A, accounts: Object.keys(tokens).map(entry) }));
  for (const [id, token] of Object.entries(tokens)) if (token) mockKeychain.items.set(tokenKey(id), { value: token, cls });
}

/** A start of the app: the module afresh (its memory is the process's), MMKV and keychain kept. */
function start(): Core {
  let core: Core | undefined;
  jest.isolateModules(() => {
    core = require('../tauri-core') as Core;
  });
  return core!;
}

const load = (core: Core) => core.invoke<{ active: string | null; accounts: { id: string; token?: string }[] } | null>('desktop_accounts_load');
const save = (core: Core, active: string | null, accounts: { id: string; token: string }[]) =>
  core.invoke('desktop_accounts_save', { value: { version: 1, active, accounts: accounts.map((a) => ({ ...entry(a.id), token: a.token })) } });
const savedIds = () => (JSON.parse(mockStore.get('accounts.v1') as string) as { accounts: { id: string }[] }).accounts.map((a) => a.id);
const emitAppState = (state: string) => {
  mockAppState.currentState = state;
  [...mockAppState.listeners].forEach((fn) => fn(state));
};

beforeEach(() => {
  jest.clearAllMocks();
  mockKeychain.items.clear();
  mockKeychain.locked = false;
  mockStore.clear();
  mockAppState.listeners.clear();
  mockAppState.currentState = 'background';
  mockPlatform.OS = 'ios';
});

// ---- tests ------------------------------------------------------------------------------------------

describe('loading', () => {
  it('reads each token with the after-first-unlock class; an account whose token is gone is gone', async () => {
    seed({ [A]: 'tok-a', [B]: null }, AFTER_FIRST_UNLOCK);
    const core = start();
    const file = await load(core);
    expect(file).toEqual({ version: 1, active: A, accounts: [expect.objectContaining({ id: A, token: 'tok-a' })] });
    expect(mockSecureStore.getItemAsync).toHaveBeenCalledWith(tokenKey(A), OPTIONS);
    expect(core.unreadableAccountIds()).toEqual([]);
  });

  it('nothing stored: no list', async () => {
    const core = start();
    expect(await load(core)).toBeNull();
    expect(core.unreadableAccountIds()).toEqual([]);
  });
});

describe('a start the keychain refuses (iOS, launched in the background while locked)', () => {
  it('leaves those accounts out but keeps their entries and tokens through every save', async () => {
    seed({ [A]: 'tok-a', [B]: 'tok-b' });
    mockKeychain.locked = true;
    const core = start();
    expect((await load(core))?.accounts).toEqual([]);
    expect(core.unreadableAccountIds()).toEqual([A, B]);

    // READY brings the open account back; its token cannot be written while locked.
    await expect(save(core, A, [{ id: A, token: 'tok-a' }])).rejects.toThrow('errSecInteractionNotAllowed');
    expect(core.unreadableAccountIds()).toEqual([B]);
    expect(savedIds()).toEqual([A, B]);

    // Unlocked, the app saves what it knows - one account. The other is not signed out.
    mockKeychain.locked = false;
    await save(core, A, [{ id: A, token: 'tok-a2' }]);
    expect(savedIds()).toEqual([A, B]);
    expect(mockKeychain.items.get(tokenKey(B))?.value).toBe('tok-b');
    expect(mockKeychain.items.get(tokenKey(A))?.value).toBe('tok-a2');

    // A real sign-out still removes what it signs out of, and only that.
    await save(core, null, []);
    expect(savedIds()).toEqual([B]);
    expect(mockKeychain.items.has(tokenKey(A))).toBe(false);
    expect(mockKeychain.items.get(tokenKey(B))?.value).toBe('tok-b');

    // The next start reads it.
    const next = start();
    expect((await load(next))?.accounts).toEqual([expect.objectContaining({ id: B, token: 'tok-b' })]);
    expect(next.unreadableAccountIds()).toEqual([]);
  });

  it('restarts on the next foreground to read the list whole, and only tries that once', async () => {
    seed({ [A]: 'tok-a' });
    mockKeychain.locked = true;
    const core = start();
    await load(core);
    emitAppState('background');
    expect(mockReload).not.toHaveBeenCalled();
    mockKeychain.locked = false;
    emitAppState('active');
    expect(mockReload).toHaveBeenCalledTimes(1);
    emitAppState('active');
    expect(mockReload).toHaveBeenCalledTimes(1);

    // Refused again right after that restart (in the foreground, so not the lock): no
    // restart loop, and nothing waits for it.
    mockKeychain.locked = true;
    const restarted = start();
    await load(restarted);
    expect(restarted.unreadableAccountIds()).toEqual([]);
    emitAppState('background');
    emitAppState('active');
    expect(mockReload).toHaveBeenCalledTimes(1);

    // Nor does each background start while that lasts restart the app when it is opened.
    emitAppState('background');
    const later = start();
    await load(later);
    expect(later.unreadableAccountIds()).toEqual([A]);
    emitAppState('active');
    expect(mockReload).toHaveBeenCalledTimes(1);

    // A start that reads everything allows it again for the next time.
    mockKeychain.locked = false;
    await load(start());
    mockKeychain.locked = true;
    mockAppState.listeners.clear();
    seed({ [A]: 'tok-a' });
    emitAppState('background');
    await load(start());
    emitAppState('active');
    expect(mockReload).toHaveBeenCalledTimes(2);
  });

  it('opened while it read: restarts then, not at some later return to the app', async () => {
    seed({ [A]: 'tok-a' });
    mockKeychain.locked = true;
    mockSecureStore.getItemAsync.mockImplementationOnce(async () => {
      mockAppState.currentState = 'active';
      throw new Error('errSecInteractionNotAllowed');
    });
    const core = start();
    await load(core);
    expect(core.unreadableAccountIds()).toEqual([A]);
    expect(mockReload).toHaveBeenCalledTimes(1);
    expect(mockAppState.listeners.size).toBe(0);
  });

  it('no restart when the app has seen every refused account by then', async () => {
    seed({ [A]: 'tok-a' });
    mockKeychain.locked = true;
    const core = start();
    await load(core);
    mockKeychain.locked = false;
    await save(core, A, [{ id: A, token: 'tok-a' }]);
    emitAppState('active');
    expect(mockReload).not.toHaveBeenCalled();
  });
});

describe('a refusal that is not the lock (a keystore fault)', () => {
  /** A readable after the first unlock, B refused: the lock does not refuse that class. */
  function seedFaulty(): void {
    seed({ [A]: 'tok-a', [B]: 'tok-b' });
    mockKeychain.items.get(tokenKey(A))!.cls = AFTER_FIRST_UNLOCK;
    mockKeychain.locked = true;
  }

  it.each<[string, 'ios' | 'android', string]>([
    ['on Android, in the background', 'android', 'background'],
    ['on iOS, in the foreground', 'ios', 'active'],
  ])('%s: keeps the account but holds nothing up, and never restarts the app', async (_name, os, state) => {
    seedFaulty();
    mockPlatform.OS = os;
    mockAppState.currentState = state;
    const core = start();
    expect((await load(core))?.accounts.map((a) => a.id)).toEqual([A]);
    // Nothing waits for B: push goes ahead for A (registration.ts).
    expect(core.unreadableAccountIds()).toEqual([]);
    emitAppState('background');
    emitAppState('active');
    expect(mockReload).not.toHaveBeenCalled();

    // Not signed out either: a start that can read B has it back.
    await save(core, A, [{ id: A, token: 'tok-a' }]);
    expect(savedIds()).toEqual([A, B]);
    expect(mockKeychain.items.get(tokenKey(B))?.value).toBe('tok-b');
    mockKeychain.locked = false;
    expect((await load(start()))?.accounts.map((a) => a.id)).toEqual([A, B]);
  });
});

describe('the keychain class', () => {
  it('new tokens are saved readable after the first unlock, on this device only', async () => {
    const core = start();
    await load(core);
    await save(core, A, [{ id: A, token: 'tok-a' }]);
    expect(mockSecureStore.setItemAsync).toHaveBeenCalledWith(tokenKey(A), 'tok-a', OPTIONS);
    expect(mockKeychain.items.get(tokenKey(A))?.cls).toBe(AFTER_FIRST_UNLOCK);
  });

  it('tokens saved before are moved to it once, by a start that could read them all (iOS)', async () => {
    seed({ [A]: 'tok-a', [B]: 'tok-b' });
    await load(start());
    expect(mockKeychain.items.get(tokenKey(A))).toEqual({ value: 'tok-a', cls: AFTER_FIRST_UNLOCK });
    expect(mockKeychain.items.get(tokenKey(B))).toEqual({ value: 'tok-b', cls: AFTER_FIRST_UNLOCK });

    // Readable by a locked start from now on; and not moved again.
    jest.clearAllMocks();
    mockKeychain.locked = true;
    const core = start();
    expect((await load(core))?.accounts.map((a) => a.id)).toEqual([A, B]);
    expect(core.unreadableAccountIds()).toEqual([]);
    expect(mockSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('not moved by a start that could not read them all, nor on Android', async () => {
    seed({ [A]: 'tok-a' });
    mockKeychain.locked = true;
    await load(start());
    expect(mockSecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(mockKeychain.items.get(tokenKey(A))?.cls).toBe('whenUnlocked');

    mockKeychain.locked = false;
    mockPlatform.OS = 'android';
    await load(start());
    expect(mockSecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });
});
