/**
 * File-system plumbing for the media layer: where its files live, reading the few bytes that
 * identify a container, names and MIME types.
 *
 * Everything the media layer writes lives under one directory in the OS cache
 * (`<cache>/strafe-media/`): the OS may reclaim it under storage pressure, it is excluded from
 * iCloud and Android auto-backup, and one wipe removes it all at sign-out. Subdirectories:
 *
 * - `decrypted/` decrypted E2EE attachments (the LRU cache in ./attachmentCache.ts)
 * - `clips/`     plaintext audio clips re-saved under their real container's extension
 * - `outgoing/`  ciphertext of an attachment between encrypting and uploading it
 * - `incoming/`  ciphertext between downloading and decrypting it
 * - `export/`    named copies handed to the share sheet or the photo library
 * - `recordings/` voice messages recorded but not yet sent (or sent this session)
 *
 * Only `decrypted/` is meant to outlive a session; the rest is swept at start-up.
 */
import { Directory, File, Paths } from 'expo-file-system';
import type { LocalFile, PickedFileInput } from './types';

export type MediaDirectoryName = 'decrypted' | 'clips' | 'outgoing' | 'incoming' | 'export' | 'recordings';

const ROOT = 'strafe-media';

/** The media root, created on demand. */
export function mediaRoot(): Directory {
  const dir = new Directory(Paths.cache, ROOT);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** One of the media subdirectories, created on demand. */
export function mediaDirectory(name: MediaDirectoryName): Directory {
  const dir = new Directory(Paths.cache, ROOT, name);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** Delete one subdirectory's contents (the directory itself is recreated on next use). */
export function wipeMediaDirectory(name: MediaDirectoryName): void {
  try {
    const dir = new Directory(Paths.cache, ROOT, name);
    if (dir.exists) dir.delete();
  } catch (e) {
    console.warn(`[media] could not clear ${name}`, e);
  }
}

/** Random hex, for temp names nobody else can predict or collide with. */
export function randomName(bytes = 12): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, '0');
  return s;
}

/**
 * The first `length` bytes of a file, or an empty array when it cannot be read. Only a
 * container's magic number is wanted here, so this never reads the whole file.
 */
export function readHeadBytes(uri: string, length = 16): Uint8Array {
  try {
    const handle = new File(uri).open();
    try {
      return handle.readBytes(length);
    } finally {
      handle.close();
    }
  } catch {
    return new Uint8Array(0);
  }
}

/** Size in bytes, or null when the file is missing or unreadable. */
export function fileSize(uri: string): number | null {
  try {
    const f = new File(uri);
    if (!f.exists) return null;
    const size = f.size;
    return typeof size === 'number' && Number.isFinite(size) ? size : null;
  } catch {
    return null;
  }
}

export function deleteFileQuietly(uri: string | null | undefined): void {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    /* already gone, or not ours to delete */
  }
}

/** Whether `uri` is inside the media root (so the media layer may delete it). */
export function isInMediaRoot(uri: string): boolean {
  try {
    return uri.startsWith(new Directory(Paths.cache, ROOT).uri);
  } catch {
    return false;
  }
}

/**
 * An attachment URL as something the native loaders can fetch. The server builds them from
 * its CDN base, which an operator may set as a path on the instance's own origin
 * (`/cdn/v1/...`); a browser resolves that against the page, the app against the signed-in
 * instance's web origin (the `location` shim).
 */
export function absoluteUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (url.startsWith('//')) return `https:${url}`;
  if (!url.startsWith('/')) return url;
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return origin ? `${origin.replace(/\/+$/, '')}${url}` : url;
}

/** Lowercase extension without the dot, or '' when there is none. */
export function extensionOf(name: string | null | undefined): string {
  const n = (name ?? '').split(/[?#]/)[0]!.split('/').pop() ?? '';
  const dot = n.lastIndexOf('.');
  if (dot <= 0 || dot === n.length - 1) return '';
  return n.slice(dot + 1).toLowerCase();
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  heic: 'image/heic',
  heif: 'image/heif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  '3gp': 'video/3gpp',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  weba: 'audio/webm',
  amr: 'audio/amr',
  pdf: 'application/pdf',
  zip: 'application/zip',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
};

export function mimeFromExtension(ext: string): string | null {
  return MIME_BY_EXT[ext.toLowerCase()] ?? null;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/3gpp': '3gp',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'text/plain': 'txt',
  'application/json': 'json',
};

export function extensionFromMime(mime: string | null | undefined): string | null {
  const bare = (mime ?? '').split(';')[0]!.trim().toLowerCase();
  return EXT_BY_MIME[bare] ?? null;
}

/**
 * A filename safe to create on the device from a name someone else chose: no directories,
 * no control or reserved characters, no leading dots, bounded length, and an extension
 * (from `contentType`) when it had none - the share sheet and photo library go by it.
 */
export function sanitizeFilename(name: string | null | undefined, contentType?: string): string {
  let base = (name ?? '')
    .split(/[\\/]/)
    .pop()!
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/^[.\s]+/, '')
    .trim();
  if (!base) base = 'file';
  let ext = extensionOf(base);
  if (!ext) {
    const fromType = extensionFromMime(contentType);
    if (fromType) {
      base = `${base}.${fromType}`;
      ext = fromType;
    }
  }
  const MAX = 120;
  if (base.length > MAX) {
    const tail = ext ? `.${ext}` : '';
    base = base.slice(0, MAX - tail.length) + tail;
  }
  return base;
}

function isMimeType(v: string | null | undefined): v is string {
  return typeof v === 'string' && v.includes('/');
}

/**
 * Turn any picker's result into a LocalFile: a name (from the asset, else the URI), a MIME
 * type (declared, else from the extension), and a size (declared, else read from disk).
 */
export function normalizePickedFile(input: PickedFileInput | LocalFile): LocalFile {
  const p = input as PickedFileInput;
  const fromUri = decodeURIComponentSafe(p.uri.split(/[?#]/)[0]!.split('/').pop() ?? '');
  const name = (p.name || p.fileName || fromUri || 'file').trim() || 'file';
  const declaredType = isMimeType(p.mimeType) ? p.mimeType : isMimeType(p.type) ? p.type : '';
  const type = declaredType || mimeFromExtension(extensionOf(name)) || 'application/octet-stream';
  const declaredSize = typeof p.size === 'number' ? p.size : typeof p.fileSize === 'number' ? p.fileSize : null;
  const size = declaredSize ?? fileSize(p.uri) ?? 0;
  const out: LocalFile = { uri: p.uri, name, type, size };
  if (typeof p.width === 'number' && p.width > 0) out.width = p.width;
  if (typeof p.height === 'number' && p.height > 0) out.height = p.height;
  if (p.owned) out.owned = true;
  return out;
}

function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
