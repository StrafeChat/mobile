/**
 * @jest-environment node
 */
/**
 * The mobile machine.ts against the real engine in the crypto host: provisioning, the
 * store/device-id coupling, the web's mismatch recovery (which parses the engine's error
 * text - so this proves it crosses the bridge verbatim), and reopening after the host's
 * WebView dies.
 */
import 'fake-indexeddb/auto';
import { cryptoHost } from '../../../crypto/host';
import { CryptoHostCrashedError, CryptoHostRestartedError } from '../../../crypto/errors';
import { bootEngine, locateEngine, type Channel } from '../../../crypto/__tests__/harness';

jest.mock('../../../storage', () => {
  const memory = () => {
    const m = new Map<string, unknown>();
    return { set: (k: string, v: unknown) => m.set(k, v), getBoolean: (k: string) => m.get(k), remove: (k: string) => m.delete(k) };
  };
  return { appStorage: memory(), webStorage: memory() };
});

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 0,
  getItemAsync: async (k: string) => {
    if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error(`invalid SecureStore key ${k}`);
    return mockSecure.get(k) ?? null;
  },
  setItemAsync: async (k: string, v: string) => {
    if (!/^[A-Za-z0-9._-]+$/.test(k)) throw new Error(`invalid SecureStore key ${k}`);
    mockSecure.set(k, v);
  },
  deleteItemAsync: async (k: string) => {
    mockSecure.delete(k);
  },
}));

const mockDevices = { next: 3001, registered: new Set<string>(), revoked: [] as string[], created: 0 };
jest.mock('@web/api/devices', () => ({
  createDevice: async () => {
    const id = String(mockDevices.next++);
    mockDevices.created++;
    mockDevices.registered.add(id);
    return { device_id: id };
  },
  listOwnDevices: async () => [...mockDevices.registered].map((device_id) => ({ device_id, has_keys: true })),
  revokeDevice: async (id: string) => {
    mockDevices.revoked.push(id);
    mockDevices.registered.delete(id);
  },
}));

jest.mock('@web/stores/instance', () => ({
  instance: { federationEnabled: false, domain: '' },
  loadInstanceInfo: async () => undefined,
}));

const mockRetry = jest.fn(async () => undefined);
jest.mock('@web/stores/messages', () => ({ retryPendingDecrypts: mockRetry }));

// The app has localStorage (MMKV) installed by the shims; give the module the same.
const mockLocal = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => mockLocal.get(k) ?? null,
    setItem: (k: string, v: string) => void mockLocal.set(k, String(v)),
    removeItem: (k: string) => void mockLocal.delete(k),
    key: (i: number) => [...mockLocal.keys()][i] ?? null,
    get length() {
      return mockLocal.size;
    },
  },
});
// Object.keys(localStorage) in forgetLocalDeviceIdentities reads own keys; not exercised here.

// eslint-disable-next-line import/first
import { E2eeStoreUnusableError, getCurrentDeviceId, getMachine, resetLocalE2eeStore } from '../machine';

jest.setTimeout(60_000);

const USER = '300';
const pkg = locateEngine();
let channel: Channel;

/** The WebView died and a new one came up: what CryptoHost.tsx does on a termination. */
async function restartHost(): Promise<void> {
  expect(cryptoHost.crashed('test')).toBe(true);
  channel.startPage(pkg);
  await cryptoHost.whenReady();
}

beforeAll(async () => {
  channel = await bootEngine(pkg);
});

afterAll(() => cryptoHost.resetForTests());

test('provisions a device, opens its store and records both halves of the coupling', async () => {
  const machine = await getMachine(USER);
  expect(getCurrentDeviceId()).toBe('3001');
  expect(machine.deviceId.toString()).toBe('3001');
  expect(await getMachine(USER)).toBe(machine);
  expect(mockLocal.get(`strafe_e2ee_device_id:${USER}`)).toBe('3001');
  expect(mockLocal.get(`strafe_e2ee_store_device:${USER}`)).toBe('3001');
  expect([...mockSecure.keys()]).toEqual([`strafe_e2ee_passphrase_${USER}`]);
  const store = await cryptoHost.call('store.inspect', { storeName: `strafe-e2ee-${USER}` });
  expect(store).toMatchObject({ exists: true, marker: { deviceId: '3001' } });
});

test('a host crash fails calls in flight, kills old handles, and the store reopens as the same device', async () => {
  const before = await getMachine(USER);
  const identity = before.identityKeys.ed25519.toBase64();
  channel.hold();
  const inFlight = before.outgoingRequests();
  expect(cryptoHost.crashed('content process terminated')).toBe(true);
  await expect(inFlight).rejects.toBeInstanceOf(CryptoHostCrashedError);
  await expect(before.outgoingRequests()).rejects.toBeInstanceOf(CryptoHostRestartedError);
  channel.release();
  channel.startPage(pkg);
  const after = await getMachine(USER);
  expect(after).not.toBe(before);
  expect(after.identityKeys.ed25519.toBase64()).toBe(identity);
  expect(getCurrentDeviceId()).toBe('3001');
  await new Promise((r) => setTimeout(r, 10));
  expect(mockRetry).toHaveBeenCalled();
  expect(mockDevices.created).toBe(1);
});

test('device id lost, store kept: the store marker brings the device back without an orphan', async () => {
  mockLocal.delete(`strafe_e2ee_device_id:${USER}`);
  await restartHost();
  const machine = await getMachine(USER);
  expect(machine.deviceId.toString()).toBe('3001');
  expect(mockDevices.created).toBe(1);
  expect(mockLocal.get(`strafe_e2ee_device_id:${USER}`)).toBe('3001');
});

test('device id points elsewhere: the engine mismatch error crosses verbatim and the stored device is kept', async () => {
  mockLocal.set(`strafe_e2ee_device_id:${USER}`, '3999');
  await restartHost();
  const machine = await getMachine(USER);
  expect(machine.deviceId.toString()).toBe('3001');
  expect(getCurrentDeviceId()).toBe('3001');
  expect(mockDevices.revoked).toContain('3999');
  expect(mockLocal.get(`strafe_e2ee_device_id:${USER}`)).toBe('3001');
});

test('the WebView storage vanished under an established device: reset path, never a new account under the old id', async () => {
  await cryptoHost.call('store.delete', { storeName: `strafe-e2ee-${USER}` });
  await restartHost();
  const err = await getMachine(USER).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(E2eeStoreUnusableError);
  expect((err as E2eeStoreUnusableError).detail).toMatch(/^E2eeStoreMissingError: .*3001/);

  await resetLocalE2eeStore(USER);
  expect(mockDevices.revoked).toContain('3001');
  const fresh = await getMachine(USER);
  expect(fresh.deviceId.toString()).toBe('3002');
  expect(mockLocal.get(`strafe_e2ee_store_device:${USER}`)).toBe('3002');
});

test('a store whose passphrase is gone is unusable, not silently replaced', async () => {
  mockSecure.clear();
  // A fresh app start (the crash-loop guard has counted this file's restarts).
  cryptoHost.resetForTests();
  channel = await bootEngine(pkg);
  const err = await getMachine(USER).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(E2eeStoreUnusableError);
  expect((err as E2eeStoreUnusableError).detail).toMatch(/passphrase/);
});
