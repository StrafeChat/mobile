/**
 * Decrypted E2EE attachments on disk, ready to display or play.
 *
 * The web keeps decrypted attachments as object URLs for the session (MessageAttachments.tsx).
 * Native image views and players want a file instead, so here an encrypted attachment is
 * downloaded, decrypted (attachments/crypto override) and written to
 * `<cache>/strafe-media/decrypted/`, and its `file://` URI is what the UI renders.
 *
 * - **Key.** `${id}-${iv}` (filesystem-safe), the web cache's `${id}:${iv}`: one entry per
 *   uploaded file, whichever message or client refers to it. The extension is the real
 *   container's for audio and video (sniffed from the decrypted bytes - AVPlayer goes by the
 *   extension), otherwise the attachment's own.
 * - **Bounded.** Least-recently-used entries are deleted once the directory passes
 *   `DEFAULT_ATTACHMENT_CACHE_BYTES` (256 MiB; `configureAttachmentCache` changes it).
 * - **Private.** Plaintext only ever lands in the app's own cache directory, which the OS
 *   excludes from backups; nothing unauthenticated is written (GCM verifies first); the
 *   whole directory is removed at sign-out (./lifecycle.ts).
 * - **Gentle.** Concurrent requests for one attachment share a job, and at most two
 *   download-and-decrypt jobs run at once: each holds the file in memory twice, and a
 *   fast scroll through an encrypted room would otherwise start dozens.
 *
 * Plaintext (non-E2EE) attachments do not come here: they are displayed from their URL
 * (expo-image and the players cache those themselves) - see ./mediaSource.ts.
 */
import { File } from 'expo-file-system';
import { attachmentKind } from '@web-original/lib/attachments/format';
import type { AttachmentView } from '@web-original/lib/attachments/types';
import { sniffClipFormat, type ClipFormat } from '@web-original/lib/media/clipFormat';
import {
  ATTACHMENT_CRYPTO_MAX_BYTES,
  AttachmentCryptoError,
  decryptAttachmentFile,
} from '../overrides/media/attachments/crypto';
import {
  absoluteUrl,
  deleteFileQuietly,
  extensionFromMime,
  extensionOf,
  mediaDirectory,
  randomName,
  readHeadBytes,
  wipeMediaDirectory,
} from './files';

export const DEFAULT_ATTACHMENT_CACHE_BYTES = 256 * 1024 * 1024;
const MAX_CONCURRENT_JOBS = 2;

/** A decrypted attachment, ready for an image view or player. */
export interface DecryptedAttachment {
  /** `file://` URI of the plaintext. */
  uri: string;
  size: number;
  /** The audio/video container its bytes hold, when it is one sniffClipFormat knows. */
  format: ClipFormat | null;
}

export type AttachmentFetchErrorReason = 'notEncrypted' | 'tooLarge' | 'network' | 'corrupt' | 'storage' | 'cancelled';

export class AttachmentFetchError extends Error {
  readonly reason: AttachmentFetchErrorReason;
  constructor(reason: AttachmentFetchErrorReason, message?: string) {
    super(message ?? reason);
    this.name = 'AttachmentFetchError';
    this.reason = reason;
  }
}

/** What the cache needs of an attachment: where the ciphertext is and how to open it. */
export type EncryptedAttachmentRef = Pick<AttachmentView, 'id' | 'url' | 'filename' | 'contentType' | 'size' | 'encryption'>;

interface Entry {
  uri: string;
  size: number;
  lastUsed: number;
  format: ClipFormat | null;
}

let maxBytes = DEFAULT_ATTACHMENT_CACHE_BYTES;
let index: Map<string, Entry> | null = null;
const inflight = new Map<string, Promise<DecryptedAttachment>>();
/** Bumped by a clear, so a job that started before it never writes into the new session. */
let generation = 0;

export function configureAttachmentCache(opts: { maxBytes?: number }): void {
  if (typeof opts.maxBytes === 'number' && opts.maxBytes > 0) {
    maxBytes = opts.maxBytes;
    evict(null);
  }
}

function base64Url(s: string): string {
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** The cache entry's file name without extension: `${id}-${iv}`, made filesystem-safe. */
export function cacheBaseName(att: Pick<AttachmentView, 'id' | 'encryption'>): string {
  const id = att.id.replace(/[^0-9A-Za-z_]/g, '_').slice(0, 48) || 'att';
  const iv = base64Url(att.encryption?.iv ?? '').replace(/[^0-9A-Za-z_-]/g, '_').slice(0, 48);
  return `${id}-${iv}`;
}

/** Extensions sniffClipFormat can produce, read back into a format for entries found on disk. */
const SNIFFABLE: Record<string, ClipFormat> = {
  webm: { ext: 'webm', type: 'audio/webm' },
  ogg: { ext: 'ogg', type: 'audio/ogg' },
  m4a: { ext: 'm4a', type: 'audio/mp4' },
  mp4: { ext: 'mp4', type: 'audio/mp4' },
};

/** The extension to store a decrypted attachment under. */
export function cacheExtension(att: Pick<AttachmentView, 'filename' | 'contentType'>, sniffed: ClipFormat | null): string {
  const kind = attachmentKind(att.contentType, att.filename);
  if (sniffed && (kind === 'audio' || kind === 'video')) {
    return kind === 'video' && sniffed.ext === 'm4a' ? 'mp4' : sniffed.ext;
  }
  const fromName = extensionOf(att.filename);
  if (/^[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  return extensionFromMime(att.contentType) ?? 'bin';
}

function loadIndex(): Map<string, Entry> {
  if (index) return index;
  const next = new Map<string, Entry>();
  try {
    for (const item of mediaDirectory('decrypted').list()) {
      if (!(item instanceof File)) continue;
      const name = item.name;
      // Leftovers of a write the app was killed in the middle of.
      if (name.includes('.tmp-') || name.includes('.part-')) {
        deleteFileQuietly(item.uri);
        continue;
      }
      const dot = name.lastIndexOf('.');
      if (dot <= 0) continue;
      let size = 0;
      let mtime = 0;
      try {
        size = item.size ?? 0;
        mtime = item.modificationTime ?? 0;
      } catch {
        /* keep zeros */
      }
      next.set(name.slice(0, dot), { uri: item.uri, size, lastUsed: mtime, format: SNIFFABLE[name.slice(dot + 1)] ?? null });
    }
  } catch (e) {
    console.warn('[media] could not read the attachment cache', e);
  }
  index = next;
  return next;
}

function evict(keep: string | null): void {
  const idx = loadIndex();
  let total = 0;
  for (const e of idx.values()) total += e.size;
  while (total > maxBytes && idx.size > (keep ? 1 : 0)) {
    let victim: string | null = null;
    let oldest = Infinity;
    for (const [base, e] of idx) {
      if (base === keep) continue;
      if (e.lastUsed < oldest) {
        oldest = e.lastUsed;
        victim = base;
      }
    }
    if (victim === null) break;
    const e = idx.get(victim)!;
    deleteFileQuietly(e.uri);
    idx.delete(victim);
    total -= e.size;
  }
}

function exists(uri: string): boolean {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

function hit(base: string): DecryptedAttachment | null {
  const idx = loadIndex();
  const e = idx.get(base);
  if (!e) return null;
  // The OS may have reclaimed the cache directory under storage pressure.
  if (!exists(e.uri)) {
    idx.delete(base);
    return null;
  }
  e.lastUsed = Date.now();
  return { uri: e.uri, size: e.size, format: e.format };
}

/** The decrypted file if it is already cached - synchronously, for building viewer lists. */
export function peekDecryptedAttachment(att: Pick<AttachmentView, 'id' | 'encryption'>): DecryptedAttachment | null {
  if (!att.encryption) return null;
  return hit(cacheBaseName(att));
}

let active = 0;
const waiting: (() => void)[] = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT_JOBS) await new Promise<void>((resolve) => waiting.push(resolve));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function fromCryptoError(e: unknown): AttachmentFetchError {
  if (e instanceof AttachmentFetchError) return e;
  if (e instanceof AttachmentCryptoError) {
    if (e.reason === 'tooLarge') return new AttachmentFetchError('tooLarge');
    if (e.reason === 'corrupt') return new AttachmentFetchError('corrupt', e.message);
    return new AttachmentFetchError('storage', e.message);
  }
  return new AttachmentFetchError('storage', e instanceof Error ? e.message : String(e));
}

async function fetchAndDecrypt(
  att: EncryptedAttachmentRef,
  base: string,
  gen: number,
  onProgress?: (fraction: number) => void,
): Promise<DecryptedAttachment> {
  const material = att.encryption!;
  // The sender's claimed size is checked before anything is downloaded; the real ciphertext
  // size is checked again before it is read.
  if (att.size > ATTACHMENT_CRYPTO_MAX_BYTES) throw new AttachmentFetchError('tooLarge');
  const incoming = new File(mediaDirectory('incoming'), `${randomName()}.bin`);
  try {
    try {
      await File.downloadFileAsync(absoluteUrl(att.url), incoming, {
        idempotent: true,
        ...(onProgress
          ? { onProgress: ({ bytesWritten, totalBytes }) => totalBytes > 0 && onProgress(bytesWritten / totalBytes) }
          : {}),
      });
    } catch (e) {
      throw new AttachmentFetchError('network', e instanceof Error ? e.message : String(e));
    }
    const tmp = new File(mediaDirectory('decrypted'), `${base}.tmp-${randomName(6)}`);
    let decrypted: { size: number; head: Uint8Array };
    try {
      decrypted = await decryptAttachmentFile(incoming.uri, material, tmp);
    } catch (e) {
      deleteFileQuietly(tmp.uri);
      throw fromCryptoError(e);
    }
    if (gen !== generation) {
      deleteFileQuietly(tmp.uri);
      throw new AttachmentFetchError('cancelled', 'the media cache was cleared');
    }
    const format = sniffClipFormat(decrypted.head);
    const dest = new File(mediaDirectory('decrypted'), `${base}.${cacheExtension(att, format)}`);
    try {
      if (dest.exists) dest.delete();
      tmp.moveSync(dest);
    } catch (e) {
      deleteFileQuietly(tmp.uri);
      throw fromCryptoError(e);
    }
    loadIndex().set(base, { uri: dest.uri, size: decrypted.size, lastUsed: Date.now(), format });
    evict(base);
    return { uri: dest.uri, size: decrypted.size, format };
  } finally {
    deleteFileQuietly(incoming.uri);
  }
}

/**
 * The decrypted file for an encrypted attachment: from the cache, or downloaded and decrypted
 * now. Rejects with `AttachmentFetchError` ('tooLarge' | 'network' | 'corrupt' | 'storage' |
 * 'cancelled'); a failure is not remembered, so asking again retries.
 */
export function getDecryptedAttachment(
  att: EncryptedAttachmentRef,
  opts: { onProgress?: (fraction: number) => void } = {},
): Promise<DecryptedAttachment> {
  if (!att.encryption) return Promise.reject(new AttachmentFetchError('notEncrypted'));
  const base = cacheBaseName(att);
  const cached = hit(base);
  if (cached) return Promise.resolve(cached);
  const running = inflight.get(base);
  if (running) return running;
  const gen = generation;
  const job = withSlot(() => {
    // Another caller may have finished the same attachment while this one queued.
    const done = hit(base);
    return done ? Promise.resolve(done) : fetchAndDecrypt(att, base, gen, opts.onProgress);
  });
  inflight.set(base, job);
  const forget = () => {
    if (inflight.get(base) === job) inflight.delete(base);
  };
  job.then(forget, forget);
  return job;
}

/**
 * File the sender's own plaintext under the key recipients use, once its upload has an id
 * and URL - so the sender never downloads and decrypts their own attachment back.
 */
export async function seedDecryptedAttachment(
  att: Pick<AttachmentView, 'id' | 'filename' | 'contentType' | 'encryption'>,
  plaintextUri: string,
): Promise<void> {
  if (!att.encryption) return;
  const base = cacheBaseName(att);
  if (hit(base)) return;
  const gen = generation;
  const source = new File(plaintextUri);
  if (!source.exists) return;
  const format = sniffClipFormat(readHeadBytes(plaintextUri, 16));
  const dest = new File(mediaDirectory('decrypted'), `${base}.${cacheExtension(att, format)}`);
  await source.copy(dest, { overwrite: true });
  if (gen !== generation) {
    deleteFileQuietly(dest.uri);
    return;
  }
  let size = 0;
  try {
    size = dest.size ?? 0;
  } catch {
    /* keep 0 */
  }
  loadIndex().set(base, { uri: dest.uri, size, lastUsed: Date.now(), format });
  evict(base);
}

/** Total bytes and files currently cached (for a storage setting). */
export function attachmentCacheUsage(): { bytes: number; files: number } {
  let bytes = 0;
  const idx = loadIndex();
  for (const e of idx.values()) bytes += e.size;
  return { bytes, files: idx.size };
}

/** Delete every decrypted attachment (sign-out, or a "clear cache" setting). */
export function clearAttachmentCache(): void {
  generation++;
  inflight.clear();
  index = null;
  wipeMediaDirectory('decrypted');
  wipeMediaDirectory('incoming');
}
