/**
 * The page's IndexedDB housekeeping: deleting a store, the device-id marker, the existence
 * probe and the full wipe. None of it needs the engine, so it is served before the wasm loads
 * - a reset must work exactly when the engine cannot open its store.
 */
import { storeDatabaseNames } from '../../src/platform/crypto/protocol';

const MARKER_STORE = 'marker';
const MARKER_KEY = 'device';

function markerDbName(storeName: string): string {
  return `${storeName}::strafe-device`;
}

function engineDbName(storeName: string): string {
  return `${storeName}::matrix-sdk-crypto`;
}

export function deleteDatabase(idb: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = idb.deleteDatabase(name);
    req.onsuccess = () => resolve();
    // A connection somewhere still holds it (a machine mid-close). The delete completes once
    // it lets go; waiting forever would hang a reset on it.
    req.onblocked = () => setTimeout(resolve, 2000);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete every database of one engine store. The engine keeps a store as two databases
 * (`<store>::matrix-sdk-crypto`, `<store>::matrix-sdk-crypto-meta`); deleting only `<store>`
 * would be a silent no-op. `strict` rethrows a failed delete - for the reset a person asked for.
 */
export async function deleteStoreDatabases(idb: IDBFactory, storeName: string, strict: boolean): Promise<void> {
  await Promise.all(
    storeDatabaseNames(storeName).map((name) =>
      deleteDatabase(idb, name).catch((err) => {
        if (strict) throw err;
        console.warn('[crypto-host] could not delete', name, err);
      }),
    ),
  );
}

/** Every database on this origin, or null when the engine cannot enumerate them. */
async function listDatabases(idb: IDBFactory): Promise<string[] | null> {
  if (typeof idb.databases !== 'function') return null;
  try {
    return (await idb.databases()).map((d) => d.name).filter((n): n is string => typeof n === 'string');
  } catch {
    return null;
  }
}

/**
 * Does the engine's store database exist? Enumerated where the engine allows it; otherwise
 * probed by opening it and aborting the upgrade a missing database triggers, which leaves
 * nothing behind.
 */
export async function storeExists(idb: IDBFactory, storeName: string): Promise<boolean> {
  const name = engineDbName(storeName);
  const listed = await listDatabases(idb);
  if (listed) return listed.includes(name);
  return new Promise((resolve) => {
    let created = false;
    const req = idb.open(name);
    req.onupgradeneeded = () => {
      created = true;
      req.transaction?.abort();
    };
    req.onsuccess = () => {
      req.result.close();
      resolve(!created);
    };
    // Aborted (it did not exist) or unopenable: either way there is no usable store.
    req.onerror = () => resolve(false);
    req.onblocked = () => resolve(true);
  });
}

function openMarkerDb(idb: IDBFactory, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(markerDbName(storeName), 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(MARKER_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface StoreMarker {
  userId: string;
  deviceId: string;
}

/**
 * Which device the store belongs to, written by the app after every successful open. It lives
 * in this origin's storage, beside the store, so the two are evicted together: the app's own
 * record of the device id (MMKV) can outlive the WebView's data, and the marker is how the
 * app tells "store gone" from "store never created".
 */
export async function readMarker(idb: IDBFactory, storeName: string): Promise<StoreMarker | null> {
  const listed = await listDatabases(idb);
  if (listed && !listed.includes(markerDbName(storeName))) return null;
  const db = await openMarkerDb(idb, storeName);
  try {
    return await new Promise<StoreMarker | null>((resolve, reject) => {
      const req = db.transaction(MARKER_STORE, 'readonly').objectStore(MARKER_STORE).get(MARKER_KEY);
      req.onsuccess = () => {
        const v = req.result as Partial<StoreMarker> | undefined;
        resolve(v && typeof v.userId === 'string' && typeof v.deviceId === 'string' ? { userId: v.userId, deviceId: v.deviceId } : null);
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function writeMarker(idb: IDBFactory, storeName: string, marker: StoreMarker): Promise<void> {
  const db = await openMarkerDb(idb, storeName);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(MARKER_STORE, 'readwrite');
      tx.objectStore(MARKER_STORE).put({ userId: marker.userId, deviceId: marker.deviceId }, MARKER_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Delete every database on the origin (the scheduled wipe). Returns what was deleted. */
export async function wipeAll(idb: IDBFactory): Promise<string[]> {
  const names = await listDatabases(idb);
  if (!names) throw new Error('this WebView cannot enumerate IndexedDB databases, so it cannot wipe them');
  await Promise.all(names.map((n) => deleteDatabase(idb, n)));
  return names;
}
