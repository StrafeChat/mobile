/**
 * Hand-off between encrypting an attachment and uploading it.
 *
 * The sender of an encrypted attachment already holds its plaintext. Once the upload returns
 * the attachment's id and URL, the uploader files that plaintext in the decrypted cache under
 * the same key a recipient would use, so the sender's own attachment is never downloaded and
 * decrypted again (after a restart, say). stores/messages calls encrypt and upload back to
 * back with the ciphertext object in between, so that object is the key.
 */
import type { LocalFile } from './types';

export interface UploadSeed {
  plaintextUri: string;
  material: { key: string; iv: string };
  contentType: string;
  filename: string;
}

const seeds = new WeakMap<LocalFile, UploadSeed>();

export function rememberUploadSeed(ciphertext: LocalFile, seed: UploadSeed): void {
  seeds.set(ciphertext, seed);
}

/** Take (and forget) the seed for an uploaded ciphertext file. */
export function takeUploadSeed(ciphertext: LocalFile): UploadSeed | null {
  const seed = seeds.get(ciphertext) ?? null;
  seeds.delete(ciphertext);
  return seed;
}
