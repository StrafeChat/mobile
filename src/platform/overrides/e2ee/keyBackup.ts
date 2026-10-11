/**
 * Mobile replacement for web/src/lib/e2ee/keyBackup.ts - same exports, same scheme
 * (`m.megolm_backup.v1.curve25519-aes-sha2`, private key wrapped under the recovery code),
 * same version tracking, sync loop, 404 adoption, status and bootstrap claim. Read the web
 * module for why the backup is asymmetric and why its key is never stored locally.
 *
 * The only change is where the backup's private key lives. On the web, prepare and restore
 * hold a BackupDecryptionKey in wasm memory and call its synchronous methods. Here the
 * engine is in the crypto host WebView, and the key stays there:
 * - prepareKeyBackup asks the host for a fresh key pair and recovery code; the private key
 *   leaves the page only wrapped under that code.
 * - restoreKeyBackup opens a restore session in the host with the wrapped key and the code,
 *   streams the server's (still encrypted) pages into it, and has the host import them into
 *   the machine. The decrypted sessions never cross into the app.
 * Error classes and their meaning are unchanged: RecoveryCodeMismatchError for a wrong code
 * or a key that does not match the backup, NoBackupError, E2eeUnavailableError passed through.
 */

import { RequestType, hostHandleOf, type OlmMachine } from '../../crypto/matrixSdkCrypto';
import { cryptoHost } from '../../crypto/host';
import {
  BACKUP_ALGORITHM,
  createBackupVersion,
  deleteBackupVersion,
  getBackupKeys,
  getBackupRecovery,
  getBackupVersion,
  putBackupKeys,
  type BackupRecoveryResponse,
  type BackupVersionResponse,
} from '@web/api/devices';
import { ApiError } from '@web/api/ApiError';
import { E2eeUnavailableError } from '@web/lib/e2ee/subtle';
import { getMachine } from './machine';
import { trackKeyBackupOperation } from './backupActivity';

/** When a restore started here has finished - for the recovery sheet's spinner. */
export { keyBackupActivity, type KeyBackupActivity, type KeyBackupOperation } from './backupActivity';

/** The recovery code did not open this backup: wrong code, or the wrong account's code. */
export class RecoveryCodeMismatchError extends Error {
  constructor() {
    super('recovery code does not match this backup');
    this.name = 'RecoveryCodeMismatchError';
  }
}

/** The account has no backup to restore from. */
export class NoBackupError extends Error {
  constructor() {
    super('no key backup exists for this account');
    this.name = 'NoBackupError';
  }
}

/**
 * The backup version this session has told the engine to encrypt to. Tracked so a sync
 * doesn't re-issue enableBackupV1 on every call, and so a 404 (another device replaced the
 * version) can clear it and force a re-read.
 */
let enabledVersion: string | null = null;

/**
 * The version this *device* last uploaded to, across reloads.
 *
 * The engine marks each room key as backed up, and that mark survives enableBackupV1 - it
 * is only cleared by disableBackup(). So when the backup version changes (the user got a new
 * recovery code, or another device replaced it), every key still looks uploaded and
 * backupRoomKeys() returns nothing: the new backup would sit permanently empty while the UI
 * reported it was on. Knowing which version those marks refer to is what decides whether the
 * marks have to be cleared, and the engine does not expose it - so it is recorded here.
 */
const ENABLED_VERSION_KEY = 'strafe_e2ee_backup_version';

function lastEnabledVersion(userId: string): string | null {
  try {
    return localStorage.getItem(`${ENABLED_VERSION_KEY}:${userId}`);
  } catch {
    // Unreadable: treat as "unknown", which errs toward re-uploading rather than toward an
    // empty backup.
    return null;
  }
}

function rememberEnabledVersion(userId: string, version: string): void {
  try {
    localStorage.setItem(`${ENABLED_VERSION_KEY}:${userId}`, version);
  } catch {
    // Worst case the next load re-uploads keys the backup already has, which the server
    // deduplicates.
  }
}

/** Upload loop bound. Each pass covers a batch of sessions; this only exists so a server
 * that keeps rejecting a version can't spin forever. */
const MAX_UPLOAD_BATCHES = 50;

/** Restore loop bound, at the server's page size - far above any real backup, and only here
 * so a server that kept handing back cursors could not spin forever. */
const MAX_RESTORE_PAGES = 200;

function isVersionGone(e: unknown): boolean {
  return e instanceof ApiError && e.status === 404;
}

/**
 * Point the engine at the account's current backup version, so backupRoomKeys() starts
 * producing sessions encrypted to it. Returns the version, or null if the account has no
 * backup yet.
 *
 * Once this session knows the version it stops re-reading it: syncs run on a timer and on
 * every burst of arriving room keys, and a request per sync was enough traffic to trip the
 * endpoint's own rate limit on a busy account - at which point syncing silently stopped. A
 * version replaced elsewhere is still picked up, via the 404 that the next upload gets.
 */
async function ensureBackupEnabled(machine: OlmMachine, userId: string): Promise<string | null> {
  if (enabledVersion && (await machine.isBackupEnabled())) return enabledVersion;
  const info = await getBackupVersion();
  // Re-upload everything if these keys' backed-up marks belong to a different version.
  return enableFrom(machine, userId, info, lastEnabledVersion(userId) !== info.version);
}

/**
 * Tell the engine which public key to encrypt room keys to.
 *
 * `resetBackedUpMarks` clears every key's "already backed up" flag, which is required
 * whenever the marks currently refer to some other version - otherwise nothing is ever
 * uploaded to the new one. It must NOT be set right after importing from a backup: that
 * import already marked the keys for this same version, and clearing them would re-upload
 * the entire history that was just downloaded.
 */
async function enableFrom(
  machine: OlmMachine,
  userId: string,
  info: BackupVersionResponse | BackupRecoveryResponse,
  resetBackedUpMarks: boolean
): Promise<string | null> {
  if (!info.exists || !info.version || !info.auth_data?.public_key) return null;
  if (info.algorithm && info.algorithm !== BACKUP_ALGORITHM) {
    console.warn('[e2ee] ignoring key backup with unsupported algorithm', info.algorithm);
    return null;
  }
  if (enabledVersion === info.version && (await machine.isBackupEnabled())) return info.version;
  if (resetBackedUpMarks) await machine.disableBackup();
  await machine.enableBackupV1(info.auth_data.public_key, info.version);
  enabledVersion = info.version;
  rememberEnabledVersion(userId, info.version);
  return info.version;
}

export interface BackupStatus {
  exists: boolean;
  version: string | null;
  /** Sessions the *server* holds. */
  backedUp: number;
  /** Sessions this device holds in total. */
  total: number;
  /** Sessions this device still has to upload, per the engine's own bookkeeping. */
  pending: number;
  /**
   * The engine believes it has uploaded more than the server actually has.
   *
   * Only happens when the two have disagreed about which version the "backed up" marks refer
   * to, which is exactly the failure that makes a backup silently stay empty while reporting
   * that it is on. Surfaced rather than hidden so the UI can offer the fix.
   */
  outOfSync: boolean;
}

/** What to show in settings: whether a backup exists and how far behind it is. */
export async function getBackupStatus(userId: string): Promise<BackupStatus> {
  const machine = await getMachine(userId);
  const [info, counts] = await Promise.all([getBackupVersion(), machine.roomKeyCounts()]);
  const pending = Math.max(0, counts.total - counts.backedUp);
  return {
    exists: info.exists,
    version: info.version ?? null,
    backedUp: info.count ?? 0,
    total: counts.total,
    pending,
    outOfSync: info.exists && pending === 0 && (info.count ?? 0) < counts.total,
  };
}

/**
 * A backup that has been generated but not yet created on the server. See prepareKeyBackup.
 */
export interface PreparedKeyBackup {
  /** The code to show the user. Nothing anywhere can print it again once this is discarded. */
  code: string;
  publicKey: string;
  wrapped: string;
  salt: string;
}

/**
 * Generate a backup's key pair and recovery code, without touching the server.
 *
 * Split from commitKeyBackup so the code can be shown *before* anything is created. Doing it
 * the other way round meant a user who closed the dialog - or whose tab died while it was
 * open - was left with a backup nobody could ever open, which settings then reported as "On.
 * A new device can restore your message history", and which had already replaced whatever
 * backup they had before. Now backing out of the dialog leaves the account exactly as it was.
 */
export async function prepareKeyBackup(): Promise<PreparedKeyBackup> {
  // Generated, wrapped and released inside the crypto host; see the module comment.
  return cryptoHost.call('backup.prepare', {}).catch(rethrowBackupError);
}

/**
 * Create the prepared backup on the server and upload this device's room keys to it.
 *
 * Replaces any existing backup, server-side included - see the service's
 * CreateBackupVersion for why a superseded version's keys are deleted rather than kept.
 */
export async function commitKeyBackup(userId: string, prepared: PreparedKeyBackup): Promise<string> {
  const machine = await getMachine(userId);
  const { version } = await createBackupVersion({
    algorithm: BACKUP_ALGORITHM,
    auth_data: { public_key: prepared.publicKey },
    wrapped_private_key: prepared.wrapped,
    salt: prepared.salt,
  });

  // resetBackedUpMarks, always: every key this device holds is marked as backed up to the
  // version this one just replaced, and without clearing those marks the new backup stays
  // empty forever while the UI reports it is on.
  await enableFrom(
    machine,
    userId,
    { exists: true, version, algorithm: BACKUP_ALGORITHM, auth_data: { public_key: prepared.publicKey } },
    true
  );
  await syncKeyBackup(userId);
  return version;
}

/**
 * Upload every room key this device holds that the backup does not. Needs no secret - that
 * is the point of the asymmetric scheme - so it can run on a timer without ever prompting.
 * Returns how many sessions were sent.
 */
export function syncKeyBackup(userId: string): Promise<number> {
  // Serialised, because four things can ask for a sync at once: the periodic sweep, the
  // debounce that fires when room keys arrive, backup creation, and the settings page.
  // Concurrent callers would each get the *same* pending request out of backupRoomKeys(),
  // upload it twice, and then both mark a request id the engine had already retired.
  //
  // Keyed by user so that a call for a different account can never be handed back the result
  // of one already running for the previous one.
  if (!syncInFlight || syncInFlightUserId !== userId) {
    syncInFlightUserId = userId;
    syncInFlight = runSyncKeyBackup(userId).finally(() => {
      if (syncInFlightUserId === userId) {
        syncInFlight = null;
        syncInFlightUserId = null;
      }
    });
  }
  return syncInFlight;
}

let syncInFlight: Promise<number> | null = null;
let syncInFlightUserId: string | null = null;

async function runSyncKeyBackup(userId: string): Promise<number> {
  const machine = await getMachine(userId);
  if (!(await ensureBackupEnabled(machine, userId))) return 0;

  let uploaded = 0;
  let batch = 0;
  for (; batch < MAX_UPLOAD_BATCHES; batch++) {
    const req = await machine.backupRoomKeys();
    if (!req) return uploaded;
    let res: { count: number; etag: string };
    try {
      res = await putBackupKeys(req.version, req.body);
    } catch (e) {
      if (!isVersionGone(e)) throw e;
      // Another device (or this user in settings) replaced the backup. Adopt the new
      // version and let the loop retry; the engine re-encrypts to the new public key.
      console.info('[e2ee] key backup version was replaced; adopting the current one');
      enabledVersion = null;
      if (!(await ensureBackupEnabled(machine, userId))) return uploaded;
      continue;
    }
    await machine.markRequestAsSent(req.id, RequestType.KeysBackup, JSON.stringify(res));
    uploaded += countSessions(req.body);
  }
  // Ran out of batches with work still queued. Harmless - the next sweep continues - but
  // silence here would hide a backup that never catches up.
  console.warn('[e2ee] key backup sync stopped after', batch, 'batches; more keys remain for the next pass');
  return uploaded;
}

function countSessions(body: string): number {
  try {
    const parsed = JSON.parse(body) as { rooms?: Record<string, { sessions?: Record<string, unknown> }> };
    let n = 0;
    for (const room of Object.values(parsed.rooms ?? {})) n += Object.keys(room.sessions ?? {}).length;
    return n;
  } catch {
    return 0;
  }
}

/**
 * Read the backup with a recovery code and import its room keys into this device.
 *
 * The code is checked against the backup's public key before anything is downloaded, so a
 * wrong code is reported immediately and precisely instead of surfacing later as messages
 * that quietly fail to decrypt.
 *
 * Returns how many sessions were new to this device.
 */
export function restoreKeyBackup(userId: string, code: string): Promise<number> {
  return trackKeyBackupOperation('restore', () => runRestore(userId, code));
}

async function runRestore(userId: string, code: string): Promise<number> {
  const info = await getBackupRecovery();
  if (!info.exists || !info.version || !info.wrapped_private_key || !info.salt || !info.auth_data?.public_key) {
    throw new NoBackupError();
  }

  // Unwrapped (PBKDF2 + AES-GCM) and checked against the backup's public key in the host;
  // the key stays there under `session` until the import below releases it.
  const { session } = await cryptoHost
    .call('backup.restoreOpen', {
      wrapped: info.wrapped_private_key,
      salt: info.salt,
      code,
      publicKey: info.auth_data.public_key,
    })
    .catch(rethrowBackupError);
  let imported = false;
  try {
    return await importFromBackup(userId, info.version, session, info).then((n) => {
      imported = true;
      return n;
    });
  } finally {
    // The import releases the session itself; anything that failed before it must not leave
    // the backup's private key in the page.
    if (!imported) cryptoHost.call('backup.restoreClose', { session }).catch(() => undefined);
  }
}

async function importFromBackup(userId: string, version: string, session: number, info: BackupRecoveryResponse): Promise<number> {
  // The backup is read a page at a time: a busy account can hold tens of thousands of
  // sessions. Each page goes into the host still encrypted and is decrypted there.
  let cursor: string | undefined;
  let counts = { total: 0, failed: 0 };
  for (let page = 0; page < MAX_RESTORE_PAGES; page++) {
    const res = await getBackupKeys(version, cursor);
    counts = await cryptoHost.call('backup.restoreAddPage', { session, rooms: res.rooms ?? {} });
    cursor = res.next;
    if (!cursor) break;
  }
  if (cursor) console.warn('[e2ee] stopped reading the key backup after', MAX_RESTORE_PAGES, 'pages');
  if (counts.failed > 0) console.warn('[e2ee]', counts.failed, 'of', counts.total, 'backed-up sessions could not be read');

  const machine = await getMachine(userId);
  const { handle, generation } = hostHandleOf(machine);
  const result = await cryptoHost.call('backup.restoreImport', { handle, session, version }, { generation });

  // Keep contributing to the same backup from now on, so keys this device acquires later are
  // recoverable too. No reset: the import above already marked these keys as backed up to
  // this very version, and clearing that would immediately re-upload everything just read.
  await enableFrom(machine, userId, info, false);

  return Number(result.importedCount ?? 0);
}

/** Give the host's named errors the web's classes, so the flows' instanceof checks hold. */
function rethrowBackupError(e: unknown): never {
  if (e instanceof Error) {
    if (e.name === 'RecoveryCodeMismatchError') throw new RecoveryCodeMismatchError();
    if (e.name === 'E2eeUnavailableError') throw new E2eeUnavailableError();
  }
  throw e;
}

/** Discard the account's backup and everything in it - "I lost my recovery code". */
export async function resetKeyBackup(): Promise<void> {
  const info = await getBackupVersion();
  if (!info.exists || !info.version) return;
  await deleteBackupVersion(info.version);
  enabledVersion = null;
}

// --- Keeping the backup current
//
// Uploading needs no secret, so this can run unattended for the life of the session. The
// interval is the upper bound on how much recent history a restore could miss.

const SYNC_INTERVAL_MS = 5 * 60_000;
/** Coalescing delay for a sync triggered by key arrival, so a burst of room keys is one upload. */
const SYNC_DEBOUNCE_MS = 10_000;

let syncTimer: ReturnType<typeof setInterval> | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let syncUserId: string | null = null;

/**
 * Users whose backup flow has already run this session.
 *
 * Kept here, beside the rest of the backup's session state, so that stopBackupSync() can
 * clear it on sign-out: it lives in the one module the auth store can import without a
 * cycle. When it was a Set in the bootstrap store nothing reset it, so signing out and back
 * into the same account in one page life skipped the flow entirely - no restore prompt, and
 * no startBackupSync, leaving the backup unsynced for the rest of the session.
 */
const bootstrappedUsers = new Set<string>();

/** True if the backup flow still needs to run for this user in this session. */
export function claimBackupBootstrap(userId: string): boolean {
  if (bootstrappedUsers.has(userId)) return false;
  bootstrappedUsers.add(userId);
  return true;
}

function runSync(userId: string): void {
  syncKeyBackup(userId).catch((e) => console.warn('[e2ee] key backup sync failed', e));
}

export function startBackupSync(userId: string): void {
  syncUserId = userId;
  if (syncTimer) return;
  syncTimer = setInterval(() => runSync(userId), SYNC_INTERVAL_MS);
}

/**
 * Room keys just arrived (a to-device share). Get them into the backup soon rather than at the
 * next sweep, coalescing a burst into one upload. No-op before startBackupSync.
 */
export function scheduleBackupSync(): void {
  const userId = syncUserId;
  if (!userId || debounceTimer) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    runSync(userId);
  }, SYNC_DEBOUNCE_MS);
}

/** Stop syncing and forget this session's backup state (sign-out). */
export function stopBackupSync(): void {
  if (syncTimer) clearInterval(syncTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  syncTimer = null;
  debounceTimer = null;
  syncUserId = null;
  enabledVersion = null;
  syncInFlight = null;
  syncInFlightUserId = null;
  bootstrappedUsers.clear();
}
