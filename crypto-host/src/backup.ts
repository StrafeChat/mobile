/**
 * The key-backup flows that need the backup's private key, run entirely inside the page.
 *
 * The web does these in keyBackup.ts with BackupDecryptionKey's synchronous methods. Here the
 * key never crosses to the app: `prepare` returns it only wrapped under the recovery code,
 * and a restore keeps the unwrapped key and every decrypted session in this page until they
 * are imported into the machine. The wrapping itself is the web's own recoveryCode.ts, run
 * with the page's WebCrypto - same format, same code, nothing re-implemented.
 */
import { generateRecoveryCode, unwrapBackupKey, wrapBackupKey } from '../../web/src/lib/e2ee/recoveryCode';
import type { WireBackupRooms } from '../../src/platform/crypto/protocol';
import type { Sdk, SdkBackupDecryptionKey, SdkOlmMachine, SdkRoomId } from './sdk';

/** A named error the app maps back to the web's own class by `name`. */
export class NamedError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

/** Same name and message as web/src/lib/e2ee/keyBackup.ts's RecoveryCodeMismatchError. */
function recoveryCodeMismatch(): NamedError {
  return new NamedError('RecoveryCodeMismatchError', 'recovery code does not match this backup');
}

/**
 * The code opened the wrapped key, but it is not the key the version publishes - a corrupt
 * row, or a server pairing the user's own wrapped key with someone else's public key. Named
 * apart from a wrong code because the app may try the retained previous version only after
 * a wrong code, as the web does (its importFromBackup throws for this, its unwrapWithCode
 * returns null for that); the app reports both as RecoveryCodeMismatchError.
 */
function backupKeyMismatch(): NamedError {
  return new NamedError('BackupKeyMismatchError', "the backup's public key does not belong to its wrapped private key");
}

/**
 * A restore the app abandoned (it crashed or lost the page mid-way) must not leave the
 * private key in wasm memory for the rest of the page's life.
 */
const SESSION_TTL_MS = 10 * 60_000;

interface RestoreSession {
  key: SdkBackupDecryptionKey;
  /** By room id *string*: a room can span pages, and RoomId handles have no value equality. */
  byRoom: Map<string, Map<string, unknown>>;
  total: number;
  failed: number;
  expiry: ReturnType<typeof setTimeout>;
}

export class BackupFlows {
  private sessions = new Map<number, RestoreSession>();
  private nextSession = 1;

  constructor(private readonly sdk: Sdk) {}

  async prepare(): Promise<{ code: string; publicKey: string; wrapped: string; salt: string }> {
    const key = this.sdk.BackupDecryptionKey.createRandomKey();
    try {
      const publicKey = publicKeyOf(key);
      const code = await generateRecoveryCode();
      const { wrapped, salt } = await wrapBackupKey(key.toBase64(), code);
      return { code, publicKey, wrapped, salt };
    } finally {
      key.free();
    }
  }

  async open(p: { wrapped: string; salt: string; code: string; publicKey: string }): Promise<{ session: number }> {
    let key: SdkBackupDecryptionKey;
    try {
      key = this.sdk.BackupDecryptionKey.fromBase64(await unwrapBackupKey(p.wrapped, p.salt, p.code));
    } catch (e) {
      // No WebCrypto is not a wrong code and must not be reported as one.
      if (e instanceof Error && e.name === 'E2eeUnavailableError') throw e;
      throw recoveryCodeMismatch();
    }
    if (publicKeyOf(key) !== p.publicKey) {
      key.free();
      throw backupKeyMismatch();
    }
    const session = this.nextSession++;
    this.sessions.set(session, {
      key,
      byRoom: new Map(),
      total: 0,
      failed: 0,
      expiry: setTimeout(() => this.close(session), SESSION_TTL_MS),
    });
    return { session };
  }

  addPage(sessionId: number, rooms: WireBackupRooms): { total: number; failed: number } {
    const s = this.get(sessionId);
    for (const [roomId, room] of Object.entries(rooms ?? {})) {
      let sessions = s.byRoom.get(roomId);
      if (!sessions) {
        sessions = new Map();
        s.byRoom.set(roomId, sessions);
      }
      for (const [sessionId_, entry] of Object.entries(room.sessions ?? {})) {
        s.total++;
        const data = entry.session_data;
        if (!data?.ephemeral || !data.mac || !data.ciphertext) {
          s.failed++;
          continue;
        }
        try {
          sessions.set(sessionId_, JSON.parse(s.key.decryptV1(data.ephemeral, data.mac, data.ciphertext)));
        } catch (e) {
          // One damaged session must not cost the user the rest of their history.
          s.failed++;
          console.warn('[crypto-host] could not decrypt a backed-up session', sessionId_, e);
        }
      }
    }
    return { total: s.total, failed: s.failed };
  }

  async importInto(
    machine: SdkOlmMachine,
    sessionId: number,
    version: string,
    progress: (...args: number[]) => void,
  ): Promise<{ importedCount: number; totalCount: number; total: number; failed: number }> {
    const s = this.get(sessionId);
    const roomIds: SdkRoomId[] = [];
    try {
      const decrypted = new Map<SdkRoomId, Map<string, unknown>>();
      for (const [roomId, sessions] of s.byRoom) {
        if (sessions.size === 0) continue;
        const rid = new this.sdk.RoomId(roomId);
        roomIds.push(rid);
        decrypted.set(rid, sessions);
      }
      const result = await machine.importBackedUpRoomKeys(
        decrypted,
        (done, total, failures) => progress(Number(done), Number(total), Number(failures)),
        version,
      );
      const out = { importedCount: Number(result.importedCount ?? 0), totalCount: Number(result.totalCount ?? 0), total: s.total, failed: s.failed };
      result.free();
      return out;
    } finally {
      for (const rid of roomIds) safeFree(rid);
      this.close(sessionId);
    }
  }

  close(sessionId: number): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    clearTimeout(s.expiry);
    this.sessions.delete(sessionId);
    s.byRoom.clear();
    s.key.free();
  }

  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id);
  }

  private get(sessionId: number): RestoreSession {
    const s = this.sessions.get(sessionId);
    if (!s) throw new NamedError('CryptoHostSessionGone', `backup restore session ${sessionId} is not open (expired, or the page restarted)`);
    return s;
  }
}

function publicKeyOf(key: SdkBackupDecryptionKey): string {
  const pub = key.megolmV1PublicKey;
  try {
    return pub.publicKeyBase64;
  } finally {
    pub.free();
  }
}

export function safeFree(o: { free(): void } | undefined | null): void {
  try {
    o?.free();
  } catch {
    /* already consumed by the engine (passed by value) */
  }
}
