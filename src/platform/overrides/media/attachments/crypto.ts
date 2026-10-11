/**
 * Mobile replacement for web/src/lib/attachments/crypto.ts - client-side encryption of
 * attachments in E2EE rooms.
 *
 * The format is the web's, byte for byte, because the same file is opened by both clients:
 * a fresh random AES-256-GCM key per file, a random 12-byte IV, no additional data, and the
 * upload is `ciphertext || 16-byte tag` (WebCrypto's output). The key and IV travel as
 * standard padded base64 inside the Megolm-encrypted message body, never to the server.
 *
 * What differs is the I/O. React Native cannot build a Blob from bytes or read one back, so
 * files come and go as `file://` URIs read and written with expo-file-system, and the
 * ciphertext is written to a temp file the uploader sends and then deletes. The cipher is the
 * global `crypto.subtle` (react-native-quick-crypto: OpenSSL over JSI), the same WebCrypto
 * calls the web makes.
 *
 * GCM through WebCrypto is single-shot: the whole file is in memory as plaintext and as
 * ciphertext at once (about twice its size at the peak). `ATTACHMENT_CRYPTO_MAX_BYTES`
 * (32 MiB) bounds that - above the 25 MiB attachment limit every client enforces, so nothing
 * a client can send is refused, and low enough that two copies fit comfortably on a low-end
 * phone. Anything larger is refused with `AttachmentCryptoError('tooLarge')` before a byte
 * is read.
 */
import { File } from 'expo-file-system';
import { deleteFileQuietly, mediaDirectory, randomName } from '../../../media/files';
import type { LocalFile } from '../../../media/types';
import { rememberUploadSeed } from '../../../media/uploadSeeds';

export interface AttachmentKeyMaterial {
  /** base64 raw AES-256 key. */
  key: string;
  /** base64 12-byte GCM nonce. */
  iv: string;
}

/** Largest plaintext (and ciphertext minus its tag) handled in one piece. */
export const ATTACHMENT_CRYPTO_MAX_BYTES = 32 * 1024 * 1024;

const GCM_TAG_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

export type AttachmentCryptoErrorReason = 'tooLarge' | 'unreadable' | 'corrupt' | 'unavailable';

export class AttachmentCryptoError extends Error {
  readonly reason: AttachmentCryptoErrorReason;
  constructor(reason: AttachmentCryptoErrorReason, message?: string) {
    super(message ?? reason);
    this.name = 'AttachmentCryptoError';
    this.reason = reason;
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  let s: string;
  try {
    s = atob(b64);
  } catch {
    throw new AttachmentCryptoError('corrupt', 'attachment key material is not base64');
  }
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  const s = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (!s) throw new AttachmentCryptoError('unavailable', 'WebCrypto is not installed');
  return s;
}

/**
 * `bytes` as a view that spans its whole, plain ArrayBuffer. A file read already is one; a
 * subarray is copied, so the native cipher can never see bytes outside the view.
 */
function exact(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes as Uint8Array<ArrayBuffer>;
  }
  return new Uint8Array(bytes);
}

/**
 * Encrypt bytes the web's way. The key comes straight from the CSPRNG and is imported
 * non-extractable: the same uniformly random 256-bit key `generateKey` + `exportKey` would
 * give, with one fewer WebCrypto operation for the native implementation to get right.
 */
export async function encryptBytes(plaintext: Uint8Array): Promise<{ ciphertext: Uint8Array; material: AttachmentKeyMaterial }> {
  if (plaintext.byteLength > ATTACHMENT_CRYPTO_MAX_BYTES) throw new AttachmentCryptoError('tooLarge');
  const rawKey = crypto.getRandomValues(new Uint8Array(KEY_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await subtle().importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = await subtle().encrypt({ name: 'AES-GCM', iv }, key, exact(plaintext));
  return { ciphertext: new Uint8Array(ciphertext), material: { key: bytesToBase64(rawKey), iv: bytesToBase64(iv) } };
}

/** Decrypt `ciphertext || tag`. A wrong key, IV or any altered byte fails as 'corrupt'. */
export async function decryptBytes(ciphertext: Uint8Array, material: AttachmentKeyMaterial): Promise<Uint8Array> {
  if (ciphertext.byteLength > ATTACHMENT_CRYPTO_MAX_BYTES + GCM_TAG_BYTES) throw new AttachmentCryptoError('tooLarge');
  if (ciphertext.byteLength < GCM_TAG_BYTES) throw new AttachmentCryptoError('corrupt', 'ciphertext shorter than its tag');
  let key: CryptoKey;
  try {
    key = await subtle().importKey('raw', base64ToBytes(material.key), { name: 'AES-GCM' }, false, ['decrypt']);
  } catch (e) {
    if (e instanceof AttachmentCryptoError) throw e;
    throw new AttachmentCryptoError('corrupt', 'attachment key is not an AES key');
  }
  try {
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: base64ToBytes(material.iv) }, key, exact(ciphertext));
    return new Uint8Array(plain);
  } catch (e) {
    if (e instanceof AttachmentCryptoError) throw e;
    throw new AttachmentCryptoError('corrupt', 'attachment failed authentication');
  }
}

async function readWhole(uri: string, limit: number): Promise<Uint8Array> {
  let file: File;
  try {
    file = new File(uri);
  } catch {
    throw new AttachmentCryptoError('unreadable');
  }
  let size: number | null = null;
  try {
    size = file.exists ? file.size : null;
  } catch {
    size = null;
  }
  if (size === null) throw new AttachmentCryptoError('unreadable', 'file is missing');
  // Refuse before reading: the point of the cap is never to allocate past it.
  if (size > limit) throw new AttachmentCryptoError('tooLarge');
  try {
    return await file.bytes();
  } catch {
    throw new AttachmentCryptoError('unreadable');
  }
}

/** Write bytes to `dest` through a sibling temp file, so a crash never leaves half a file under the real name. */
export function writeAtomically(dest: File, bytes: Uint8Array): void {
  const part = new File(dest.parentDirectory, `${dest.name}.part-${randomName(6)}`);
  try {
    part.create({ overwrite: true });
    part.write(bytes);
    if (dest.exists) dest.delete();
    part.moveSync(dest);
  } catch (e) {
    deleteFileQuietly(part.uri);
    throw e;
  }
}

/**
 * Encrypt a local file for upload into an E2EE room. Returns the ciphertext as a temp
 * LocalFile (named 'blob', as every encrypted upload is) that `uploadAttachment` sends and
 * then deletes, plus the key material for the message body.
 *
 * Same name and shape as the web's `encryptAttachment(file) -> {blob, material}`, so
 * stores/messages' send path is unchanged.
 */
export async function encryptAttachment(file: LocalFile): Promise<{ blob: LocalFile; material: AttachmentKeyMaterial }> {
  const plaintext = await readWhole(file.uri, ATTACHMENT_CRYPTO_MAX_BYTES);
  const { ciphertext, material } = await encryptBytes(plaintext);
  const out = new File(mediaDirectory('outgoing'), `${randomName()}.bin`);
  try {
    writeAtomically(out, ciphertext);
  } catch {
    throw new AttachmentCryptoError('unreadable', 'could not write the encrypted copy');
  }
  const blob: LocalFile = {
    uri: out.uri,
    name: 'blob',
    type: 'application/octet-stream',
    size: ciphertext.byteLength,
    deleteAfterUpload: true,
  };
  // The sender already has the plaintext; once the upload has an id, the uploader files it
  // in the decrypted cache so the sender's own attachment never has to be fetched back.
  rememberUploadSeed(blob, { plaintextUri: file.uri, material, contentType: file.type, filename: file.name });
  return { blob, material };
}

/**
 * Decrypt ciphertext that is already in memory. The web's version returns a Blob of
 * `contentType`; React Native cannot build one from bytes, so this returns the plaintext
 * bytes and leaves storing them to the caller (see `decryptAttachmentFile`, and the cache in
 * src/platform/media/attachmentCache.ts, which is what the UI should use).
 */
export async function decryptAttachment(
  ciphertext: ArrayBuffer | Uint8Array,
  material: AttachmentKeyMaterial,
  _contentType?: string,
): Promise<Uint8Array> {
  const bytes = ciphertext instanceof Uint8Array ? ciphertext : new Uint8Array(ciphertext);
  return decryptBytes(bytes, material);
}

/**
 * Decrypt the ciphertext file at `sourceUri` into `dest`. Nothing is written unless the GCM
 * tag verifies, so a tampered or truncated download never becomes a file anyone opens.
 * Returns the plaintext size and its first bytes (for container sniffing).
 */
export async function decryptAttachmentFile(
  sourceUri: string,
  material: AttachmentKeyMaterial,
  dest: File,
): Promise<{ size: number; head: Uint8Array }> {
  const ciphertext = await readWhole(sourceUri, ATTACHMENT_CRYPTO_MAX_BYTES + GCM_TAG_BYTES);
  const plaintext = await decryptBytes(ciphertext, material);
  writeAtomically(dest, plaintext);
  return { size: plaintext.byteLength, head: plaintext.slice(0, 16) };
}
