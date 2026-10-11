import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { memoryFs } from '../../media/testing/memoryFileSystem';
import { bareMediaType, clearTypedClips, clipFormatFromName, readHead, sniffClipFormat, typedClip, typedClipUrl } from './clipFormat';

jest.mock('expo-file-system', () => require('../../media/testing/memoryFileSystem'));

const WEBM = [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42];
const OGG = [0x4f, 0x67, 0x67, 0x53, 0x00];

function file(head: number[]): Uint8Array {
  const out = new Uint8Array(64);
  out.set(head);
  return out;
}

beforeEach(() => {
  memoryFs.reset();
  clearTypedClips();
});

describe('clipFormat override', () => {
  it("re-exports the web's pure helpers", () => {
    expect(sniffClipFormat(new Uint8Array(WEBM))).toEqual({ ext: 'webm', type: 'audio/webm' });
    expect(bareMediaType('audio/webm;codecs=opus', '')).toBe('audio/webm');
    expect(clipFormatFromName(undefined, 'a.oga')).toEqual({ ext: 'oga', type: 'audio/ogg' });
  });

  it('reads the head of a file by URI or LocalFile', async () => {
    const uri = memoryFs.put(`${memoryFs.cacheUri}/a.ogg`, file(OGG));
    expect((await readHead(uri)).length).toBe(16);
    expect(sniffClipFormat(await readHead({ uri }))).toEqual({ ext: 'ogg', type: 'audio/ogg' });
  });

  it('saves a clip under the container its bytes name, once per URL', async () => {
    const url = 'https://cdn.test/attachments/1/2/voice-message.webm';
    memoryFs.serve(url, file(OGG));
    const clip = await typedClip(url, 'audio/webm', 'voice-message.webm');
    expect(clip).toMatchObject({ format: { ext: 'ogg', type: 'audio/ogg' }, sniffed: true });
    expect(clip!.uri.startsWith(`${memoryFs.cacheUri}/strafe-media/clips/`)).toBe(true);
    expect(clip!.uri.endsWith('.ogg')).toBe(true);
    expect(await typedClipUrl(url, 'audio/webm', 'voice-message.webm')).toBe(clip!.uri);
    expect(memoryFs.downloads()).toEqual([url]);
    // The download temp file is gone.
    expect(memoryFs.filesUnder(`${memoryFs.cacheUri}/strafe-media/incoming`)).toEqual([]);
  });

  it('falls back to the name for unknown bytes, and does not remember a failure', async () => {
    const url = 'https://cdn.test/x/song.mp3';
    memoryFs.serve(url, 404);
    expect(await typedClipUrl(url, 'audio/mpeg', 'song.mp3')).toBeNull();
    memoryFs.serve(url, file([0x49, 0x44, 0x33]));
    const clip = await typedClip(url, 'audio/mpeg', 'song.mp3');
    expect(clip).toMatchObject({ format: { ext: 'mp3', type: 'audio/mpeg' }, sniffed: false });
  });
});
