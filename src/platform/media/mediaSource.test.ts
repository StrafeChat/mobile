/**
 * Attachment -> displayable source: previews, encrypted (decrypt + cache), plaintext audio
 * (re-typed local copy), plaintext media (URL), and the iOS container check on top.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Platform } from 'react-native';

import { memoryFs } from './testing/memoryFileSystem';
import type { AttachmentView } from '@web-original/lib/attachments/types';
import { encryptBytes } from '../overrides/media/attachments/crypto';
import { clearAttachmentCache } from './attachmentCache';
import { attachmentSourceSync, resolveAttachmentSource, useAttachmentSource } from './mediaSource';

jest.mock('expo-file-system', () => require('./testing/memoryFileSystem'));

const OGG = [0x4f, 0x67, 0x67, 0x53, 0, 2];
const FTYP = [0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70];

function bytes(head: number[], n = 256): Uint8Array {
  const out = new Uint8Array(n);
  out.set(head);
  return out;
}

let n = 1;
async function encrypted(plain: Uint8Array, meta: Partial<AttachmentView>): Promise<AttachmentView> {
  const { ciphertext, material } = await encryptBytes(plain);
  const id = String(500 + n++);
  const url = `https://cdn.test/attachments/9/${id}/blob`;
  memoryFs.serve(url, ciphertext);
  return { id, url, filename: 'f', contentType: 'application/octet-stream', size: plain.length, encryption: material, ...meta };
}

function plain(meta: Partial<AttachmentView> & { url: string }): AttachmentView {
  return { id: String(900 + n++), filename: 'f', contentType: 'application/octet-stream', size: 10, ...meta };
}

let restorePlatform: (() => void) | null = null;
function onPlatform(os: 'ios' | 'android'): void {
  const original = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  restorePlatform = () => Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
}

beforeEach(() => {
  memoryFs.reset();
  clearAttachmentCache();
  onPlatform('ios');
});

afterEach(() => {
  restorePlatform?.();
});

describe('resolveAttachmentSource', () => {
  it('shows an encrypted image from its decrypted file, never the ciphertext URL', async () => {
    const att = await encrypted(bytes([0x89, 0x50]), { filename: 'cat.png', contentType: 'image/png' });
    expect(attachmentSourceSync(att)).toBeNull();
    const src = await resolveAttachmentSource(att);
    expect(src).toMatchObject({ status: 'ready', kind: 'image', local: true, encrypted: true, voice: false });
    expect(src.uri.startsWith(`${memoryFs.cacheUri}/strafe-media/decrypted/`)).toBe(true);
    expect(src.uri).not.toBe(att.url);
    // Cached now: known synchronously.
    expect(attachmentSourceSync(att)?.uri).toBe(src.uri);
  });

  it('reports an encrypted WebM/Ogg voice message as unplayable on iOS, with its file', async () => {
    const att = await encrypted(bytes(OGG), { filename: 'voice-message.webm', contentType: 'audio/webm' });
    const src = await resolveAttachmentSource(att);
    expect(src).toMatchObject({ status: 'unsupported', reason: 'ios-container', kind: 'audio', voice: true, format: { ext: 'ogg' } });
    expect(memoryFs.exists(src.uri)).toBe(true);
  });

  it('plays the same clip on Android', async () => {
    onPlatform('android');
    const att = await encrypted(bytes(OGG), { filename: 'voice-message.webm', contentType: 'audio/webm' });
    expect(await resolveAttachmentSource(att)).toMatchObject({ status: 'ready', voice: true });
  });

  it('re-types plaintext audio from its bytes', async () => {
    const url = 'https://cdn.test/attachments/1/2/voice-message.webm';
    memoryFs.serve(url, bytes(FTYP)); // misnamed: really MP4
    const att = plain({ url, filename: 'voice-message.webm', contentType: 'audio/webm' });
    const src = await resolveAttachmentSource(att);
    expect(src).toMatchObject({ status: 'ready', local: true, encrypted: false, format: { ext: 'm4a' } });
    expect(src.uri.endsWith('.m4a')).toBe(true);
  });

  it('falls back to the URL when a plaintext clip cannot be fetched, judging by its name', async () => {
    const att = plain({ url: 'https://cdn.test/missing/voice-message.ogg', filename: 'voice-message.ogg', contentType: 'audio/ogg' });
    expect(await resolveAttachmentSource(att)).toMatchObject({ status: 'unsupported', uri: att.url, local: false, format: null });
    const mp3 = plain({ url: 'https://cdn.test/missing/song.mp3', filename: 'song.mp3', contentType: 'audio/mpeg' });
    expect(await resolveAttachmentSource(mp3)).toMatchObject({ status: 'ready', uri: mp3.url });
  });

  it('streams large plaintext audio from its URL instead of fetching it whole', () => {
    const big = plain({ url: 'https://cdn.test/album/track.flac', filename: 'track.flac', contentType: 'audio/flac', size: 20 * 1024 * 1024 });
    expect(attachmentSourceSync(big)).toMatchObject({ status: 'ready', uri: big.url, local: false });
  });

  it('shows plaintext images and video from their URL, synchronously', () => {
    const img = plain({ url: 'https://cdn.test/a.jpg', filename: 'a.jpg', contentType: 'image/jpeg' });
    expect(attachmentSourceSync(img)).toMatchObject({ status: 'ready', uri: img.url, local: false, kind: 'image' });
    const webm = plain({ url: 'https://cdn.test/s.webm', filename: 's.webm', contentType: 'video/webm' });
    expect(attachmentSourceSync(webm)).toMatchObject({ status: 'unsupported', kind: 'video' });
    expect(memoryFs.downloads()).toEqual([]);
  });

  it('shows a file being sent from its preview', () => {
    const uri = memoryFs.put(`${memoryFs.cacheUri}/strafe-media/recordings/r.m4a`, bytes(FTYP));
    const att = plain({ url: '', previewUrl: uri, filename: 'voice-message.m4a', contentType: 'audio/mp4', uploading: true });
    expect(attachmentSourceSync(att)).toMatchObject({ status: 'ready', uri, local: true, voice: true, format: { ext: 'm4a' } });
  });
});

describe('useAttachmentSource', () => {
  it('goes loading -> ready for an encrypted attachment', async () => {
    const att = await encrypted(bytes([0xff, 0xd8]), { filename: 'p.jpg', contentType: 'image/jpeg' });
    const seen: string[] = [];
    const { result } = await renderHook(() => {
      const state = useAttachmentSource(att);
      seen.push(state.status);
      return state;
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(seen[0]).toBe('loading');
  });

  it('surfaces a failure with a retry that works', async () => {
    const plainBytes = bytes([0xff, 0xd8]);
    const { ciphertext, material } = await encryptBytes(plainBytes);
    const att: AttachmentView = {
      id: '777',
      url: 'https://cdn.test/attachments/9/777/blob',
      filename: 'p.jpg',
      contentType: 'image/jpeg',
      size: plainBytes.length,
      encryption: material,
    };
    memoryFs.serve(att.url, 500);
    const { result } = await renderHook(() => useAttachmentSource(att));
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current).toMatchObject({ reason: 'network' });

    memoryFs.serve(att.url, ciphertext);
    await act(async () => {
      (result.current as { retry: () => void }).retry();
    });
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('answers immediately for a source that needs no fetch', async () => {
    const img = plain({ url: 'https://cdn.test/a.png', filename: 'a.png', contentType: 'image/png' });
    const { result } = await renderHook(() => useAttachmentSource(img));
    expect(result.current).toMatchObject({ status: 'ready', uri: img.url });
  });
});
