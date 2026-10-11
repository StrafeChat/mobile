/**
 * The decrypted-attachment cache: download + decrypt once, name by real container, share
 * concurrent work, survive a cold start, evict least-recently-used, wipe completely.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { memoryFs } from './testing/memoryFileSystem';
import { encryptBytes } from '../overrides/media/attachments/crypto';
import type { AttachmentView } from '@web-original/lib/attachments/types';

jest.mock('expo-file-system', () => require('./testing/memoryFileSystem'));

type Cache = typeof import('./attachmentCache');

/** A fresh copy of the module, as after an app restart (its in-memory index starts empty). */
function freshCache(): Cache {
  let mod!: Cache;
  jest.isolateModules(() => {
    mod = require('./attachmentCache') as Cache;
  });
  return mod;
}

const OGG_HEAD = [0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0];
const FTYP_HEAD = [0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70];

function bytesWithHead(head: number[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  out.set(head);
  for (let i = head.length; i < total; i++) out[i] = i & 0xff;
  return out;
}

let nextId = 100;

/** An encrypted attachment served at its URL, as a recipient would see it. */
async function served(plain: Uint8Array, meta: Partial<AttachmentView> = {}): Promise<AttachmentView> {
  const { ciphertext, material } = await encryptBytes(plain);
  const id = String(nextId++);
  const url = `https://cdn.test/attachments/1/${id}-abc/blob`;
  memoryFs.serve(url, ciphertext);
  return { id, url, filename: 'file.bin', contentType: 'application/octet-stream', size: plain.length, encryption: material, ...meta };
}

const decryptedDir = () => `${memoryFs.cacheUri}/strafe-media/decrypted`;

beforeEach(() => {
  memoryFs.reset();
});

describe('getDecryptedAttachment', () => {
  it('downloads, decrypts and caches under the sniffed container', async () => {
    const cache = freshCache();
    const plain = bytesWithHead(OGG_HEAD, 4000);
    const att = await served(plain, { filename: 'voice-message.webm', contentType: 'audio/webm' });

    const got = await cache.getDecryptedAttachment(att);
    // Named for what the bytes are (Ogg), not what the name claims (WebM).
    expect(got.uri).toBe(`${decryptedDir()}/${cache.cacheBaseName(att)}.ogg`);
    expect(got.format).toEqual({ ext: 'ogg', type: 'audio/ogg' });
    expect(got.size).toBe(4000);
    expect(memoryFs.read(got.uri)).toEqual(plain);
    // Nothing left behind but the cached file.
    expect(memoryFs.filesUnder(`${memoryFs.cacheUri}/strafe-media`)).toEqual([got.uri]);

    // Second time: no download.
    const again = await cache.getDecryptedAttachment(att);
    expect(again.uri).toBe(got.uri);
    expect(memoryFs.downloads()).toEqual([att.url]);
    expect(cache.peekDecryptedAttachment(att)?.uri).toBe(got.uri);
  });

  it('keeps an image under its own extension and stores video MP4 as .mp4', async () => {
    const cache = freshCache();
    const img = await served(bytesWithHead([0x89, 0x50, 0x4e, 0x47], 500), { filename: 'Cat Photo.PNG', contentType: 'image/png' });
    expect((await cache.getDecryptedAttachment(img)).uri.endsWith('.png')).toBe(true);
    const vid = await served(bytesWithHead(FTYP_HEAD, 500), { filename: 'clip', contentType: 'video/mp4' });
    expect((await cache.getDecryptedAttachment(vid)).uri.endsWith('.mp4')).toBe(true);
  });

  it('shares one job between concurrent callers', async () => {
    const cache = freshCache();
    const att = await served(bytesWithHead(OGG_HEAD, 1000));
    const [a, b, c] = await Promise.all([
      cache.getDecryptedAttachment(att),
      cache.getDecryptedAttachment(att),
      cache.getDecryptedAttachment(att),
    ]);
    expect(a.uri).toBe(b.uri);
    expect(b.uri).toBe(c.uri);
    expect(memoryFs.downloads()).toHaveLength(1);
  });

  it('finds earlier entries after a restart', async () => {
    const first = freshCache();
    const att = await served(bytesWithHead(OGG_HEAD, 1000), { contentType: 'audio/ogg', filename: 'a.ogg' });
    const uri = (await first.getDecryptedAttachment(att)).uri;

    const second = freshCache();
    expect(second.peekDecryptedAttachment(att)).toEqual({ uri, size: 1000, format: { ext: 'ogg', type: 'audio/ogg' } });
    await second.getDecryptedAttachment(att);
    expect(memoryFs.downloads()).toHaveLength(1);
  });

  it('fails as corrupt on a tampered download and writes nothing', async () => {
    const cache = freshCache();
    const plain = bytesWithHead(OGG_HEAD, 1000);
    const att = await served(plain);
    const { ciphertext } = await encryptBytes(plain); // another key: authentication fails
    memoryFs.serve(att.url, ciphertext);

    await expect(cache.getDecryptedAttachment(att)).rejects.toMatchObject({ name: 'AttachmentFetchError', reason: 'corrupt' });
    expect(memoryFs.filesUnder(`${memoryFs.cacheUri}/strafe-media`)).toEqual([]);
    expect(cache.peekDecryptedAttachment(att)).toBeNull();
  });

  it('does not remember a failure: asking again retries', async () => {
    const cache = freshCache();
    const plain = bytesWithHead(OGG_HEAD, 1000);
    const { ciphertext, material } = await encryptBytes(plain);
    const att: AttachmentView = { id: '77', url: 'https://cdn.test/a/77/blob', filename: 'a.ogg', contentType: 'audio/ogg', size: 1000, encryption: material };
    memoryFs.serve(att.url, 503);
    await expect(cache.getDecryptedAttachment(att)).rejects.toMatchObject({ reason: 'network' });
    memoryFs.serve(att.url, ciphertext);
    expect(memoryFs.read((await cache.getDecryptedAttachment(att)).uri)).toEqual(plain);
  });

  it('reports network failures and over-cap sizes', async () => {
    const cache = freshCache();
    const att = await served(new Uint8Array(10));
    memoryFs.serve(att.url, 404);
    await expect(cache.getDecryptedAttachment(att)).rejects.toMatchObject({ reason: 'network' });

    const huge = { ...att, id: '9', size: 64 * 1024 * 1024 };
    await expect(cache.getDecryptedAttachment(huge)).rejects.toMatchObject({ reason: 'tooLarge' });
    expect(memoryFs.downloads()).toEqual([att.url]);

    await expect(cache.getDecryptedAttachment({ ...att, encryption: undefined })).rejects.toMatchObject({ reason: 'notEncrypted' });
  });

  it('notices files the OS deleted behind its back', async () => {
    const cache = freshCache();
    const att = await served(bytesWithHead(OGG_HEAD, 100));
    const { uri } = await cache.getDecryptedAttachment(att);
    memoryFs.remove(uri);
    expect(cache.peekDecryptedAttachment(att)).toBeNull();
    // ...and fetches it again rather than handing out a dead URI.
    expect((await cache.getDecryptedAttachment(att)).uri).toBe(uri);
    expect(memoryFs.downloads()).toEqual([att.url, att.url]);
  });
});

describe('eviction and clearing', () => {
  it('evicts the least recently used past the cap', async () => {
    const cache = freshCache();
    cache.configureAttachmentCache({ maxBytes: 2500 });
    const a = await served(new Uint8Array(1000).fill(1));
    const b = await served(new Uint8Array(1000).fill(2));
    const c = await served(new Uint8Array(1000).fill(3));
    const ua = (await cache.getDecryptedAttachment(a)).uri;
    await new Promise((r) => setTimeout(r, 2));
    const ub = (await cache.getDecryptedAttachment(b)).uri;
    await new Promise((r) => setTimeout(r, 2));
    // Touch a, so b is now the oldest.
    expect(cache.peekDecryptedAttachment(a)).not.toBeNull();
    await new Promise((r) => setTimeout(r, 2));
    const uc = (await cache.getDecryptedAttachment(c)).uri;

    expect(memoryFs.exists(ua)).toBe(true);
    expect(memoryFs.exists(ub)).toBe(false);
    expect(memoryFs.exists(uc)).toBe(true);
    expect(cache.attachmentCacheUsage()).toEqual({ bytes: 2000, files: 2 });
  });

  it('clears everything, and an in-flight job does not write into the cleared cache', async () => {
    const cache = freshCache();
    const a = await served(new Uint8Array(100).fill(1));
    await cache.getDecryptedAttachment(a);
    const b = await served(new Uint8Array(100).fill(2));
    const pending = cache.getDecryptedAttachment(b);
    cache.clearAttachmentCache();
    await expect(pending).rejects.toMatchObject({ reason: expect.stringMatching(/cancelled|storage/) });
    expect(memoryFs.filesUnder(`${memoryFs.cacheUri}/strafe-media`)).toEqual([]);
    expect(cache.attachmentCacheUsage()).toEqual({ bytes: 0, files: 0 });
  });
});

describe('seedDecryptedAttachment', () => {
  it("files the sender's plaintext under the recipients' key", async () => {
    const cache = freshCache();
    const plain = bytesWithHead(FTYP_HEAD, 300);
    const local = memoryFs.put(`${memoryFs.cacheUri}/ExpoAudio/rec.m4a`, plain);
    const att = await served(plain, { filename: 'voice-message.m4a', contentType: 'audio/mp4' });

    await cache.seedDecryptedAttachment(att, local);
    const got = await cache.getDecryptedAttachment(att);
    expect(got.uri.endsWith('.m4a')).toBe(true);
    expect(memoryFs.read(got.uri)).toEqual(plain);
    expect(memoryFs.downloads()).toEqual([]);
  });
});
