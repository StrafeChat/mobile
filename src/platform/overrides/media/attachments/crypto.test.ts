/**
 * The attachment cipher: file round trips, and byte-for-byte compatibility with the web
 * client's lib/attachments/crypto.ts - a fixture encrypted the web's way, and live round trips
 * through the web module itself in both directions.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createCipheriv } from 'node:crypto';
import { Blob as NodeBlob } from 'node:buffer';

jest.mock('expo-file-system', () => require('../../../media/testing/memoryFileSystem'));

import { memoryFs } from '../../../media/testing/memoryFileSystem';
import { File } from 'expo-file-system';
import * as webCrypto from '@web-original/lib/attachments/crypto';
import {
  ATTACHMENT_CRYPTO_MAX_BYTES,
  AttachmentCryptoError,
  base64ToBytes,
  bytesToBase64,
  decryptAttachment,
  decryptAttachmentFile,
  decryptBytes,
  encryptAttachment,
  encryptBytes,
} from './crypto';
import { takeUploadSeed } from '../../../media/uploadSeeds';

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Produced by the web client's scheme (WebCrypto AES-GCM, 256-bit raw key, 12-byte IV, no AAD,
 * output = ciphertext || 16-byte tag), key and IV as standard base64 - checked against
 * node:crypto's independent GCM below.
 */
const FIXTURE = {
  key: 'AwoRGB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5wMfO1dw=',
  iv: 'oKWqr7S5vsPIzdLX',
  ciphertext:
    'bD3l55GQQ9XnY1oyMIbOx59o2nwGQkW8zn62uJ66x0N9LVHCtnE5d6P/uVDy6F0SGraBsu6yOCuQS3O1orJCG5DybxiJJ4OgJbxEstn930P1Dz+Z',
  plaintext: 'Strafe attachment fixture: encrypted the web way, opened on mobile.\n',
};

/** The web module builds Blobs; make sure it gets a spec Blob with arrayBuffer(). */
const SpecBlob = NodeBlob as unknown as typeof Blob;

/** Byte equality without jest's per-element deep compare (slow on large arrays). */
function same(a: Uint8Array | null, b: Uint8Array): boolean {
  return !!a && Buffer.from(a).equals(Buffer.from(b));
}

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}

beforeEach(() => {
  memoryFs.reset();
  (globalThis as { Blob: typeof Blob }).Blob = SpecBlob;
});

describe('byte format', () => {
  it('the fixture is plain AES-256-GCM with the tag appended and no AAD', () => {
    const cipher = createCipheriv('aes-256-gcm', base64ToBytes(FIXTURE.key), base64ToBytes(FIXTURE.iv));
    const expected = Buffer.concat([cipher.update(enc.encode(FIXTURE.plaintext)), cipher.final(), cipher.getAuthTag()]);
    expect(Buffer.from(base64ToBytes(FIXTURE.ciphertext)).equals(expected)).toBe(true);
  });

  it('decrypts the web-format fixture', async () => {
    const plain = await decryptBytes(base64ToBytes(FIXTURE.ciphertext), { key: FIXTURE.key, iv: FIXTURE.iv });
    expect(dec.decode(plain)).toBe(FIXTURE.plaintext);
  });

  it('decrypts the fixture from a file', async () => {
    const src = memoryFs.put(`${memoryFs.cacheUri}/in.bin`, base64ToBytes(FIXTURE.ciphertext));
    const dest = new File(`${memoryFs.cacheUri}/out.txt`);
    const { size, head } = await decryptAttachmentFile(src, { key: FIXTURE.key, iv: FIXTURE.iv }, dest);
    expect(size).toBe(68);
    expect(dec.decode(head)).toBe(FIXTURE.plaintext.slice(0, 16));
    expect(dec.decode(memoryFs.read(dest.uri)!)).toBe(FIXTURE.plaintext);
  });

  it('produces what the web module decrypts', async () => {
    const plain = randomBytes(5000);
    const { ciphertext, material } = await encryptBytes(plain);
    expect(ciphertext.length).toBe(plain.length + 16);
    expect(base64ToBytes(material.key).length).toBe(32);
    expect(base64ToBytes(material.iv).length).toBe(12);
    const blob = await webCrypto.decryptAttachment(ciphertext.slice().buffer, material, 'application/octet-stream');
    expect(same(new Uint8Array(await blob.arrayBuffer()), plain)).toBe(true);
  });

  it('decrypts what the web module produces', async () => {
    const plain = randomBytes(7777);
    const { blob, material } = await webCrypto.encryptAttachment(new SpecBlob([plain]));
    const ciphertext = new Uint8Array(await blob.arrayBuffer());
    expect(same(await decryptAttachment(ciphertext, material), plain)).toBe(true);
    expect(same(await decryptAttachment(ciphertext.buffer, material), plain)).toBe(true);
  });

  it('round-trips base64 like the web', () => {
    const b = randomBytes(70000);
    expect(same(base64ToBytes(bytesToBase64(b)), b)).toBe(true);
    expect(bytesToBase64(new Uint8Array([0xfb, 0xff]))).toBe('+/8=');
  });
});

describe('files', () => {
  it('encrypts a file to a ciphertext temp file that decrypts back', async () => {
    const plain = randomBytes(300_000);
    const uri = memoryFs.put(`${memoryFs.cacheUri}/ImagePicker/photo.jpg`, plain);
    const { blob, material } = await encryptAttachment({ uri, name: 'photo.jpg', type: 'image/jpeg', size: plain.length });

    expect(blob).toMatchObject({ name: 'blob', type: 'application/octet-stream', size: plain.length + 16, deleteAfterUpload: true });
    expect(blob.uri.startsWith(`${memoryFs.cacheUri}/strafe-media/outgoing/`)).toBe(true);
    expect(memoryFs.read(blob.uri)!.length).toBe(plain.length + 16);
    // No temp leftovers beside it.
    expect(memoryFs.filesUnder(`${memoryFs.cacheUri}/strafe-media/outgoing`)).toEqual([blob.uri]);

    const dest = new File(`${memoryFs.cacheUri}/back.jpg`);
    await decryptAttachmentFile(blob.uri, material, dest);
    expect(same(memoryFs.read(dest.uri), plain)).toBe(true);

    // The uploader gets the plaintext to seed the sender's cache with.
    expect(takeUploadSeed(blob)).toEqual({ plaintextUri: uri, material, contentType: 'image/jpeg', filename: 'photo.jpg' });
  });

  it('refuses a file over the cap without reading it', async () => {
    const uri = memoryFs.putSparse(`${memoryFs.cacheUri}/huge.mp4`, ATTACHMENT_CRYPTO_MAX_BYTES + 1);
    await expect(encryptAttachment({ uri, name: 'huge.mp4', type: 'video/mp4', size: 1 })).rejects.toMatchObject({
      name: 'AttachmentCryptoError',
      reason: 'tooLarge',
    });
    expect(memoryFs.filesUnder(`${memoryFs.cacheUri}/strafe-media`)).toEqual([]);
  });

  it('reports a missing file as unreadable', async () => {
    await expect(
      encryptAttachment({ uri: `${memoryFs.cacheUri}/gone.png`, name: 'gone.png', type: 'image/png', size: 3 }),
    ).rejects.toMatchObject({ reason: 'unreadable' });
  });
});

describe('integrity', () => {
  it('rejects a tampered ciphertext and writes nothing', async () => {
    const bytes = base64ToBytes(FIXTURE.ciphertext);
    bytes[10] ^= 0x01;
    const src = memoryFs.put(`${memoryFs.cacheUri}/in.bin`, bytes);
    const dest = new File(`${memoryFs.cacheUri}/out.txt`);
    await expect(decryptAttachmentFile(src, { key: FIXTURE.key, iv: FIXTURE.iv }, dest)).rejects.toBeInstanceOf(AttachmentCryptoError);
    expect(memoryFs.exists(dest.uri)).toBe(false);
    expect(memoryFs.filesUnder(memoryFs.cacheUri)).toEqual([src]);
  });

  it('rejects the wrong key, a truncated tag and garbage key material as corrupt', async () => {
    const ct = base64ToBytes(FIXTURE.ciphertext);
    const wrongKey = bytesToBase64(randomBytes(32));
    await expect(decryptBytes(ct, { key: wrongKey, iv: FIXTURE.iv })).rejects.toMatchObject({ reason: 'corrupt' });
    await expect(decryptBytes(ct.slice(0, 10), { key: FIXTURE.key, iv: FIXTURE.iv })).rejects.toMatchObject({ reason: 'corrupt' });
    await expect(decryptBytes(ct, { key: '%%%not base64', iv: FIXTURE.iv })).rejects.toMatchObject({ reason: 'corrupt' });
    await expect(decryptBytes(ct, { key: bytesToBase64(randomBytes(7)), iv: FIXTURE.iv })).rejects.toMatchObject({ reason: 'corrupt' });
  });

  it('uses a fresh key and IV for every file', async () => {
    const plain = enc.encode('same bytes');
    const a = await encryptBytes(plain);
    const b = await encryptBytes(plain);
    expect(a.material.key).not.toBe(b.material.key);
    expect(a.material.iv).not.toBe(b.material.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });
});
