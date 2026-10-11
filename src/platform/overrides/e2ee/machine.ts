/**
 * Mobile replacement for web/src/lib/e2ee/machine.ts - same exports, same device-identity
 * rules, with the engine in the crypto host WebView.
 *
 * What is the web's, unchanged: server-assigned device ids kept per identity scope in
 * localStorage (MMKV here), the federation scope and its one-time legacy migration, and the
 * three recovery branches of openMachine, including the regexes over the engine's
 * initialize error (the host forwards that message verbatim for exactly this reason).
 *
 * What is different, and why:
 * - The store lives in the WebView's IndexedDB; deleting one is a host call.
 * - The store passphrase is in the platform keystore (./passphrase.ts), not IndexedDB.
 * - The store and the device id are coupled. On the web both live in the browser's site
 *   data and vanish together; here the device id (MMKV) can outlive the WebView's storage
 *   (storage pressure, the OS clearing web data, a backup restore of the app's files). The
 *   engine would then create a new account under the old device id, which the server already
 *   holds other keys for - peers would keep encrypting to keys nobody has. So every
 *   successful open records "this device's store exists" in MMKV and a device-id marker in
 *   the store's origin; a store that was established and is now missing goes to the same
 *   E2eeStoreUnusableError reset the web uses for an unreadable store.
 * - The WebView can die (iOS content-process termination, Android renderer kill). Its
 *   machines die with it, so a host restart drops the cached machine, reopens it, and retries
 *   the decrypts that failed meanwhile. Opens are serialised so a stale one can never close
 *   the fresh one's store (the host also allows one machine per store).
 */
import { createDevice as apiCreateDevice, listOwnDevices, revokeDevice } from '@web/api/devices';
import { toMatrixUserId } from '@web/lib/e2ee/constants';
import { instance, loadInstanceInfo } from '@web/stores/instance';
import { cryptoHost } from '../../crypto/host';
import { DeviceId, OlmMachine, UserId } from '../../crypto/matrixSdkCrypto';
import { trackKeyBackupOperation } from './backupActivity';
import { createPassphrase, deletePassphrase, passphraseReadable, readPassphrase } from './passphrase';

const DB_NAME_PREFIX = 'strafe-e2ee-';
/** What a keystore failure is reported against (the web's passphrase database's name). */
const PASSPHRASE_STORE = 'strafe-e2ee-store-key';

/**
 * The local store exists but cannot be used: the engine could not open or read it, its
 * passphrase is gone, or - mobile only - the store this device established has disappeared.
 * Nothing in the account is lost: room keys come back from the recovery backup. What has to
 * go is this device's identity, so the fix (resetLocalE2eeStore) is offered to the person.
 */
export class E2eeStoreUnusableError extends Error {
  /** `name: message` of the underlying failure, for the dialog's fine print. */
  readonly detail: string;

  constructor(
    readonly storeName: string,
    cause: unknown,
  ) {
    const detail = describeError(cause);
    super(`E2EE store ${storeName} cannot be used: ${detail}`);
    this.name = 'E2eeStoreUnusableError';
    this.detail = detail;
  }
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : e.message;
  return String(e);
}

/** The store this device established is gone from the WebView's storage. */
class E2eeStoreMissingError extends Error {
  constructor(deviceId: string) {
    super(`the encrypted store of device ${deviceId} is no longer on this phone (its web storage was cleared)`);
    this.name = 'E2eeStoreMissingError';
  }
}

const LOCAL_DEVICE_KEY = 'strafe_e2ee_device_id';
/** Mobile: the device whose store was opened successfully on this phone, per scope. */
const ESTABLISHED_STORE_KEY = 'strafe_e2ee_store_device';

/**
 * What the local device id and crypto store are keyed by. Before federation that is the
 * bare user id; once an instance federates its users are named @id:<domain> and the engine
 * won't reuse an account created under the old @id:strafe.internal name, so the federated
 * identity gets its own scope (and a one-time migration, see getMachine).
 */
function identityScope(userId: string): string {
  return instance.federationEnabled && instance.domain ? `${userId}@${instance.domain}` : userId;
}

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best-effort; worst case we re-provision a device next start
  }
}

function removeKey(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function readLocalDeviceId(scope: string): string | null {
  return readKey(`${LOCAL_DEVICE_KEY}:${scope}`);
}

function getLocalDeviceId(userId: string): string | null {
  return readLocalDeviceId(identityScope(userId));
}

function setLocalDeviceId(userId: string, deviceId: string): void {
  writeKey(`${LOCAL_DEVICE_KEY}:${identityScope(userId)}`, deviceId);
}

function storeNameFor(userId: string): string {
  return `${DB_NAME_PREFIX}${identityScope(userId)}`;
}

function deleteStore(storeName: string, opts: { strict?: boolean } = {}): Promise<void> {
  return cryptoHost.call('store.delete', { storeName, strict: opts.strict === true }).then(
    () => undefined,
    (err: unknown) => {
      if (opts.strict) throw err;
      console.warn('[e2ee] could not delete store', storeName, err);
    },
  );
}

/**
 * First open after this instance turned federation on: the pre-federation device and its
 * store belong to the @id:strafe.internal identity and can't be carried over, so retire
 * them (best effort) and let the caller provision a fresh device.
 */
async function migrateLegacyIdentity(userId: string): Promise<void> {
  if (identityScope(userId) === userId) return;
  const legacyDeviceId = readLocalDeviceId(userId);
  if (!legacyDeviceId) return;
  console.warn('[e2ee] this instance now names us', toMatrixUserId(userId), '- retiring pre-federation device', legacyDeviceId, 'and starting fresh');
  await deleteStore(`${DB_NAME_PREFIX}${userId}`);
  revokeDevice(legacyDeviceId).catch((err) => console.warn('[e2ee] could not revoke pre-federation device', legacyDeviceId, err));
  removeKey(`${LOCAL_DEVICE_KEY}:${userId}`);
  removeKey(`${ESTABLISHED_STORE_KEY}:${userId}`);
}

let machinePromise: Promise<OlmMachine> | null = null;
let openedMachine: OlmMachine | null = null;
let currentUserId: string | null = null;
let currentDeviceId: string | null = null;
/** Bumped by every open, restart and reset; an open that finds it changed stops. */
let openAttempt = 0;

class SupersededOpenError extends Error {
  constructor() {
    super('a newer open of the E2EE store replaced this one');
    this.name = 'SupersededOpenError';
  }
}

/**
 * The engine refuses to open a store that was created for a different device of the same
 * user ("the account in the store doesn't match the account in the constructor: expected
 * @u:server:DEVICE, got @u:server:OTHER"). Pull DEVICE out of that message.
 */
function mismatchedStoreDeviceId(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes("doesn't match")) return null;
  const m = /expected\s+\S*?:(\d+)(?!\d)/.exec(message);
  return m ? m[1]! : null;
}

/** The *user* part of the stored account differs (federation was turned on). */
function mismatchedStoreUserId(err: unknown, expectedUser: string): string | null {
  const message = err instanceof Error ? err.message : String(err);
  if (!message.includes("doesn't match")) return null;
  const m = /expected\s+(@[^:\s]+:[^:\s]+):\d+/.exec(message);
  if (!m) return null;
  return m[1] !== expectedUser ? m[1]! : null;
}

async function getOrCreateStorePassphrase(userId: string, storeExists: boolean): Promise<string> {
  let existing: string | null;
  try {
    existing = await readPassphrase(userId);
  } catch (e) {
    throw new E2eeStoreUnusableError(PASSPHRASE_STORE, e);
  }
  if (existing) return existing;
  // The passphrase is created before the store ever is, so a store without one has lost it
  // (Android Keystore entries do not survive some restores). A new passphrase cannot open it.
  if (storeExists) {
    throw new E2eeStoreUnusableError(storeNameFor(userId), new Error('the passphrase for this store is missing from the keystore'));
  }
  try {
    return await createPassphrase(userId);
  } catch (e) {
    throw new E2eeStoreUnusableError(PASSPHRASE_STORE, e);
  }
}

/**
 * Throw away this device's encryption identity because its store cannot be used, so the
 * next start provisions a fresh device and the backup flow offers to restore history. The
 * old device is revoked server-side (best effort). The caller reloads the app afterwards.
 */
export async function resetLocalE2eeStore(userId: string): Promise<void> {
  await loadInstanceInfo();
  openAttempt++;
  const scope = identityScope(userId);
  const oldDeviceId = readLocalDeviceId(scope);
  // Deleting the store closes any machine the host still has on it.
  await deleteStore(storeNameFor(userId), { strict: true });
  if (!(await passphraseReadable(userId))) {
    await deletePassphrase(userId).catch((err) => console.warn('[e2ee] could not drop the unreadable store passphrase', err));
  }
  removeKey(`${LOCAL_DEVICE_KEY}:${scope}`);
  removeKey(`${ESTABLISHED_STORE_KEY}:${scope}`);
  if (oldDeviceId) {
    revokeDevice(oldDeviceId).catch((err) => console.warn('[e2ee] could not revoke device', oldDeviceId, 'after a store reset', err));
  }
  machinePromise = null;
  openedMachine = null;
  currentUserId = null;
  currentDeviceId = null;
  console.warn('[e2ee] local store reset for', toMatrixUserId(userId), '- a fresh device will be provisioned');
}

/**
 * The part of a reset that does not touch the store, for when something else wipes the
 * stores (scheduleCryptoStorageWipe, applied by the host at its next start): revoke this
 * user's device and forget *every* account's device id, so no id outlives its store.
 */
export async function forgetLocalDeviceIdentities(userId: string): Promise<void> {
  await loadInstanceInfo();
  openAttempt++;
  const oldDeviceId = readLocalDeviceId(identityScope(userId));
  if (oldDeviceId) {
    try {
      await revokeDevice(oldDeviceId);
    } catch (err) {
      console.warn('[e2ee] could not revoke device', oldDeviceId, 'before a storage wipe', err);
    }
  }
  try {
    // Enumerated through key(i): the app's localStorage is an MMKV-backed object whose keys are
    // not own properties, so Object.keys (the web's spelling) would find nothing - and a
    // device id left behind after the wipe reads as "established store gone" next start.
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(`${LOCAL_DEVICE_KEY}:`) || k.startsWith(`${ESTABLISHED_STORE_KEY}:`))) keys.push(k);
    }
    for (const k of keys) localStorage.removeItem(k);
  } catch {
    // The mismatch path still ends up provisioning a fresh device.
  }
  openedMachine?.close();
  machinePromise = null;
  openedMachine = null;
  currentUserId = null;
  currentDeviceId = null;
}

/**
 * Open the machine for (userId, deviceId). If the local store turns out to belong to a
 * different device of this user, prefer the device the store knows about while it is still
 * registered (it has every session this phone ever established) and revoke the orphan; if
 * that device is gone server-side, wipe the store and start fresh. Same as the web.
 */
async function openMachine(
  userId: string,
  deviceId: string,
  passphrase: string,
  guard: () => void,
): Promise<{ machine: OlmMachine; deviceId: string }> {
  const storeName = storeNameFor(userId);
  const matrixUser = () => new UserId(toMatrixUserId(userId));
  const initialize = (id: string) => {
    guard();
    return OlmMachine.initialize(matrixUser(), new DeviceId(id), storeName, passphrase);
  };
  try {
    return { machine: await initialize(deviceId), deviceId };
  } catch (e) {
    if (e instanceof SupersededOpenError) throw e;
    const renamedFrom = mismatchedStoreUserId(e, toMatrixUserId(userId));
    if (renamedFrom) {
      console.warn('[e2ee] local store belongs to', renamedFrom, 'but this instance now names us', toMatrixUserId(userId), '- starting a fresh device');
      await deleteStore(storeName);
      const created = await apiCreateDevice();
      revokeDevice(deviceId).catch(() => undefined);
      setLocalDeviceId(userId, created.device_id);
      return { machine: await initialize(created.device_id), deviceId: created.device_id };
    }
    const storedDeviceId = mismatchedStoreDeviceId(e);
    // Not a device or user mismatch: the store itself cannot be opened or read. A host that
    // crashed or restarted mid-open is not the store's fault - let the reopen handle it.
    if (!storedDeviceId) {
      if (e instanceof Error && e.name.startsWith('CryptoHost')) throw e;
      throw new E2eeStoreUnusableError(storeName, e);
    }
    let storedStillRegistered = false;
    try {
      storedStillRegistered = (await listOwnDevices()).some((d) => d.device_id === storedDeviceId);
    } catch {
      // Can't tell - assume it is, since that's the only path that keeps existing sessions.
      storedStillRegistered = true;
    }
    if (storedStillRegistered) {
      console.warn('[e2ee] local store belongs to device', storedDeviceId, 'not', deviceId, '- reopening as the stored device');
      const machine = await initialize(storedDeviceId);
      setLocalDeviceId(userId, storedDeviceId);
      revokeDevice(deviceId).catch((err) => console.warn('[e2ee] could not revoke orphaned device', deviceId, err));
      return { machine, deviceId: storedDeviceId };
    }
    console.warn('[e2ee] local store belongs to revoked device', storedDeviceId, '- discarding it and starting fresh as', deviceId);
    await deleteStore(storeName);
    return { machine: await initialize(deviceId), deviceId };
  }
}

/**
 * Get (creating if needed) the current user's OlmMachine. Device ids are server-assigned.
 * The promise is cached - rejected ones too, as on the web, so a broken store reports the
 * same E2eeStoreUnusableError everywhere - until the host restarts or the store is reset.
 *
 * An open that a host restart overtook (its call died with the page, or the reopen superseded
 * it) is not a failure of the store: the caller is handed the reopen instead. Without this,
 * the first caller of the session - the device bootstrap, which runs once - would fail on a
 * WebView that died while the store was opening, and skip the backup flow (restore prompt,
 * backup sync) until the app was restarted.
 */
export async function getMachine(userId: string): Promise<OlmMachine> {
  let promise = machineFor(userId);
  for (let hops = 0; ; hops++) {
    try {
      return await promise;
    } catch (e) {
      const next = machinePromise;
      const overtaken = e instanceof SupersededOpenError || (e instanceof Error && e.name.startsWith('CryptoHost'));
      if (!overtaken || hops >= MAX_REOPEN_HOPS || !next || next === promise || currentUserId !== userId) throw e;
      promise = next;
    }
  }
}

/** How many replacement opens one getMachine call follows before giving up. */
const MAX_REOPEN_HOPS = 3;

function machineFor(userId: string): Promise<OlmMachine> {
  if (machinePromise && currentUserId === userId) return machinePromise;
  if (currentUserId !== userId) {
    openedMachine?.close();
    openedMachine = null;
  }
  currentUserId = userId;
  const attempt = ++openAttempt;
  const guard = () => {
    if (attempt !== openAttempt) throw new SupersededOpenError();
  };
  const promise = (async () => {
    // The engine's user id depends on whether this instance federates (its domain) - make
    // sure that's known before the first UserId is built.
    await loadInstanceInfo();
    await migrateLegacyIdentity(userId);
    const scope = identityScope(userId);
    const storeName = storeNameFor(userId);
    const store = await cryptoHost.call('store.inspect', { storeName });
    guard();

    const established = readKey(`${ESTABLISHED_STORE_KEY}:${scope}`);
    if (!store.exists && established) throw new E2eeStoreUnusableError(storeName, new E2eeStoreMissingError(established));

    let deviceId = getLocalDeviceId(userId);
    // The store survived but our record of its device did not: reuse the store's device
    // rather than provisioning an orphan the mismatch path would then have to revoke.
    if (!deviceId && store.exists && store.marker?.userId === toMatrixUserId(userId)) {
      const markerId = store.marker.deviceId;
      let registered = true;
      try {
        registered = (await listOwnDevices()).some((d) => d.device_id === markerId);
      } catch {
        // Can't tell: keep the sessions.
      }
      guard();
      if (registered) {
        deviceId = markerId;
        setLocalDeviceId(userId, deviceId);
      } else {
        await deleteStore(storeName);
      }
    }
    if (!deviceId) {
      const created = await apiCreateDevice();
      guard();
      deviceId = created.device_id;
      setLocalDeviceId(userId, deviceId);
    }
    const passphrase = await getOrCreateStorePassphrase(userId, store.exists);
    const opened = await openMachine(userId, deviceId, passphrase, guard);
    if (attempt !== openAttempt) {
      opened.machine.close();
      throw new SupersededOpenError();
    }
    currentDeviceId = opened.deviceId;
    openedMachine = opened.machine;
    writeKey(`${ESTABLISHED_STORE_KEY}:${scope}`, opened.deviceId);
    await cryptoHost
      .call('store.setMarker', { storeName, userId: toMatrixUserId(userId), deviceId: opened.deviceId })
      .catch((err) => console.warn('[e2ee] could not record the store marker', err));
    return opened.machine;
  })();
  machinePromise = promise;
  // A store that cannot be used stays cached, as on the web. A host that was down, slow or
  // restarting says nothing about the store: forget that failure so the next call retries.
  promise.catch((e: unknown) => {
    if (machinePromise === promise && e instanceof Error && e.name.startsWith('CryptoHost')) machinePromise = null;
  });
  return promise;
}

export function getCurrentDeviceId(): string | null {
  return currentDeviceId;
}

/**
 * Import a Megolm key export; returns how many sessions were actually new. Only the legacy
 * PIN backup still speaks this format (legacyBackup.ts).
 */
export function importRoomKeys(machine: OlmMachine, exported: string): Promise<number> {
  // Reported, so the PIN sheet's spinner knows when the import it is waiting on has ended.
  return trackKeyBackupOperation('legacyImport', async () => {
    const result = await machine.importExportedRoomKeys(exported, () => {});
    return Number(result.importedCount ?? 0);
  });
}

// The host restarted: every machine handle is gone. Reopen for the signed-in user and retry
// the decrypts that failed while it was down. The device id is unchanged (same store).
cryptoHost.onRestart(() => {
  openAttempt++;
  machinePromise = null;
  openedMachine = null;
  const userId = currentUserId;
  // Unmounted or given up: nothing is coming back to reopen on. The next getMachine will.
  if (!userId || cryptoHost.state === 'detached' || cryptoHost.state === 'failed') return;
  getMachine(userId)
    .then(() => {
      // Required lazily: the messages store imports this module.
       
      const { retryPendingDecrypts } = require('@web/stores/messages') as typeof import('@web/stores/messages');
      return retryPendingDecrypts();
    })
    .catch((err) => console.warn('[e2ee] could not reopen the store after the crypto host restarted', err));
});
