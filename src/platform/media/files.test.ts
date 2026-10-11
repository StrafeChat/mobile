import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-file-system', () => require('./testing/memoryFileSystem'));

import { memoryFs } from './testing/memoryFileSystem';
import { absoluteUrl, extensionOf, isInMediaRoot, mediaDirectory, normalizePickedFile, readHeadBytes, sanitizeFilename } from './files';

beforeEach(() => memoryFs.reset());

describe('sanitizeFilename', () => {
  it('strips directories, control and reserved characters, and leading dots', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('..\\..\\boot.ini')).toBe('boot.ini');
    expect(sanitizeFilename('.hidden')).toBe('hidden');
    expect(sanitizeFilename('a\u0000b:c?.txt')).toBe('a_b_c_.txt');
    expect(sanitizeFilename('  ')).toBe('file');
    expect(sanitizeFilename(undefined, 'image/png')).toBe('file.png');
  });

  it('adds an extension from the type when the name has none, and bounds the length', () => {
    expect(sanitizeFilename('photo', 'image/jpeg')).toBe('photo.jpg');
    expect(sanitizeFilename('photo.jpeg', 'image/png')).toBe('photo.jpeg');
    const long = sanitizeFilename(`${'x'.repeat(300)}.pdf`);
    expect(long.length).toBe(120);
    expect(long.endsWith('.pdf')).toBe(true);
  });
});

describe('absoluteUrl', () => {
  it('resolves a path-only CDN URL against the instance origin and leaves full URLs alone', () => {
    Object.defineProperty(globalThis, 'location', { value: { origin: 'https://chat.example' }, configurable: true, writable: true });
    expect(absoluteUrl('/cdn/v1/attachments/1/2/blob')).toBe('https://chat.example/cdn/v1/attachments/1/2/blob');
    expect(absoluteUrl('https://cdn.example/v1/a')).toBe('https://cdn.example/v1/a');
    expect(absoluteUrl('file:///data/x.png')).toBe('file:///data/x.png');
    expect(absoluteUrl('//cdn.example/v1/a')).toBe('https://cdn.example/v1/a');
    delete (globalThis as { location?: unknown }).location;
  });
});

describe('extensionOf', () => {
  it('reads the last extension, lowercased, ignoring query strings and dotfiles', () => {
    expect(extensionOf('A.B.JPG')).toBe('jpg');
    expect(extensionOf('https://cdn.test/x/voice-message.webm?sig=1')).toBe('webm');
    expect(extensionOf('.bashrc')).toBe('');
    expect(extensionOf('noext')).toBe('');
    expect(extensionOf('trailing.')).toBe('');
  });
});

describe('normalizePickedFile', () => {
  it('reads an expo-image-picker asset (whose `type` is not a MIME type)', () => {
    expect(
      normalizePickedFile({ uri: 'file:///c/a.heic', fileName: 'IMG_9.HEIC', fileSize: 99, mimeType: 'image/heic', type: 'image', width: 10, height: 20 }),
    ).toEqual({ uri: 'file:///c/a.heic', name: 'IMG_9.HEIC', type: 'image/heic', size: 99, width: 10, height: 20 });
    expect(normalizePickedFile({ uri: 'file:///c/v.mp4', type: 'video', fileSize: 5 })).toEqual({
      uri: 'file:///c/v.mp4',
      name: 'v.mp4',
      type: 'video/mp4',
      size: 5,
    });
  });

  it('fills a missing size from disk and a missing type from the extension', () => {
    const uri = memoryFs.put(`${memoryFs.cacheUri}/DocumentPicker/My%20Notes.md`, 'hello');
    expect(normalizePickedFile({ uri, owned: true })).toEqual({ uri, name: 'My Notes.md', type: 'text/markdown', size: 5, owned: true });
    expect(normalizePickedFile({ uri: `${memoryFs.cacheUri}/x.unknownext` })).toMatchObject({ type: 'application/octet-stream', size: 0 });
  });
});

describe('media directories', () => {
  it('creates them under the cache and recognises their files', () => {
    const dir = mediaDirectory('decrypted');
    expect(dir.uri.startsWith(`${memoryFs.cacheUri}/strafe-media/decrypted`)).toBe(true);
    expect(isInMediaRoot(`${memoryFs.cacheUri}/strafe-media/decrypted/a.png`)).toBe(true);
    expect(isInMediaRoot(`${memoryFs.cacheUri}/ImagePicker/a.png`)).toBe(false);
  });

  it('reads a head without the whole file, and nothing from a missing one', () => {
    const uri = memoryFs.put(`${memoryFs.cacheUri}/a.bin`, new Uint8Array([1, 2, 3, 4, 5]));
    expect(readHeadBytes(uri, 3)).toEqual(new Uint8Array([1, 2, 3]));
    expect(readHeadBytes(`${memoryFs.cacheUri}/missing`, 3)).toEqual(new Uint8Array(0));
  });
});
