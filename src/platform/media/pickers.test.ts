/**
 * The image pickers: the crop screen, the location scrub on every pick (both platforms), and a
 * pick that outlives the app (Android) going back to the composer that asked for it - or nowhere.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';

const mockLibrary = jest.fn<(o: Record<string, unknown>) => Promise<unknown>>();
const mockCamera = jest.fn<(o: Record<string, unknown>) => Promise<unknown>>();
const mockPending = jest.fn<() => Promise<unknown>>();
const mockStrip = jest.fn<(uri: string) => boolean>();

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (o: Record<string, unknown>) => mockLibrary(o),
  launchCameraAsync: (o: Record<string, unknown>) => mockCamera(o),
  getPendingResultAsync: () => mockPending(),
  getCameraPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-file-system', () => require('./testing/memoryFileSystem'));
jest.mock('./stripLocation', () => ({ stripLocation: (uri: string) => mockStrip(uri) }));
jest.mock('../storage', () => {
  const m = new Map<string, unknown>();
  return {
    appStorage: {
      getString: (k: string) => m.get(k) as string | undefined,
      set: (k: string, v: unknown) => void m.set(k, v),
      remove: (k: string) => void m.delete(k),
    },
  };
});

const { pickFromLibrary, recordVideo, recoverPendingPick, takePhoto } = require('./pickers') as typeof import('./pickers');
const { memoryFs } = require('./testing/memoryFileSystem') as typeof import('./testing/memoryFileSystem');
const { appStorage } = require('../storage') as { appStorage: { getString(k: string): string | undefined; set(k: string, v: string): void } };

const ORIGIN_KEY = 'media.pickOrigin';
const shot = () => memoryFs.put(`${memoryFs.cacheUri}/ImagePicker/a.jpg`, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]));
const pickedAt = (uri: string) => ({ canceled: false, assets: [{ uri, fileName: 'a.jpg', mimeType: 'image/jpeg', fileSize: 4 }] });
const picked = pickedAt('file:///cache/a.jpg');

const originalOS = Platform.OS;
function onPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

beforeEach(() => {
  memoryFs.reset();
  mockLibrary.mockReset().mockResolvedValue(picked);
  mockCamera.mockReset().mockResolvedValue(picked);
  mockPending.mockReset().mockResolvedValue(null);
  mockStrip.mockReset().mockReturnValue(false);
});

afterEach(() => {
  onPlatform(originalOS as 'ios');
});

describe('crop', () => {
  it('is off unless asked for, and the library then allows a multi-selection', async () => {
    await pickFromLibrary({ limit: 4 });
    const o = mockLibrary.mock.calls[0]![0];
    expect(o.allowsEditing).toBeUndefined();
    expect(o).toMatchObject({ allowsMultipleSelection: true, selectionLimit: 4 });
  });

  it('shows the crop screen for one image from the library, with the aspect', async () => {
    const res = await pickFromLibrary({ limit: 4, mediaTypes: ['images', 'videos'], crop: { aspect: [1, 1] } });
    expect(mockLibrary.mock.calls[0]![0]).toMatchObject({
      allowsEditing: true,
      aspect: [1, 1],
      allowsMultipleSelection: false,
      selectionLimit: 1,
      mediaTypes: ['images'],
    });
    expect(res).toMatchObject({ status: 'picked', files: [{ uri: 'file:///cache/a.jpg', owned: true }] });
  });

  it('crops a camera shot, and ignores a degenerate aspect', async () => {
    await takePhoto({ crop: { aspect: [0, 1] } });
    const o = mockCamera.mock.calls[0]![0];
    expect(o.allowsEditing).toBe(true);
    expect(o.aspect).toBeUndefined();
    await takePhoto();
    expect(mockCamera.mock.calls[1]![0].allowsEditing).toBeUndefined();
  });
});

describe('location', () => {
  it.each(['android', 'ios'] as const)('every camera and library pick has its location removed before it is handed on (%s)', async (os) => {
    onPlatform(os);
    await takePhoto();
    await recordVideo();
    await pickFromLibrary();
    expect(mockStrip.mock.calls).toEqual([['file:///cache/a.jpg'], ['file:///cache/a.jpg'], ['file:///cache/a.jpg']]);
  });

  it.each(['android', 'ios'] as const)('a pick that cannot be checked is refused, and its copies deleted (%s)', async (os) => {
    onPlatform(os);
    const photo = shot();
    const video = memoryFs.put(`${memoryFs.cacheUri}/ImagePicker/b.mov`, Uint8Array.from([0, 0, 0, 8, 0x66, 0x74, 0x79, 0x70]));
    mockLibrary.mockResolvedValue({ canceled: false, assets: [...pickedAt(photo).assets, { uri: video, fileName: 'b.mov', mimeType: 'video/quicktime', fileSize: 8 }] });
    // The photo checks out; the video after it cannot be written.
    mockStrip.mockImplementation((uri) => {
      if (uri === video) throw new Error('read-only');
      return false;
    });
    expect(await pickFromLibrary()).toEqual({ status: 'failed', message: 'read-only' });
    expect(memoryFs.exists(photo)).toBe(false);
    expect(memoryFs.exists(video)).toBe(false);
  });
});

describe('a pick that outlives the app (Android)', () => {
  it('notes the composer while the picker is open, and forgets it when the picker returns', async () => {
    onPlatform('android');
    let during: string | undefined;
    mockCamera.mockImplementation(async () => {
      during = appStorage.getString(ORIGIN_KEY);
      return picked;
    });
    await takePhoto({ origin: { kind: 'composer', roomId: 'alice' } });
    expect(JSON.parse(during!)).toEqual({ kind: 'composer', roomId: 'alice' });
    expect(appStorage.getString(ORIGIN_KEY)).toBeUndefined();
  });

  it('comes back with the room it was picked for', async () => {
    onPlatform('android');
    // The app died with the camera open from Alice's PM.
    appStorage.set(ORIGIN_KEY, JSON.stringify({ kind: 'composer', roomId: 'alice' }));
    mockPending.mockResolvedValue(picked);
    const r = await recoverPendingPick();
    expect(r).toMatchObject({ roomId: 'alice', result: { status: 'picked', files: [{ uri: 'file:///cache/a.jpg' }] } });
    expect(mockStrip).toHaveBeenCalledWith('file:///cache/a.jpg');
    expect(appStorage.getString(ORIGIN_KEY)).toBeUndefined();
  });

  it('is dropped, files and all, when it was not for a composer (an avatar, a banner)', async () => {
    onPlatform('android');
    // A composer pick earlier, then the avatar's camera: its launch replaced the origin.
    await takePhoto({ origin: { kind: 'composer', roomId: 'alice' } });
    let during: string | undefined;
    mockCamera.mockImplementation(async () => {
      during = appStorage.getString(ORIGIN_KEY);
      return picked;
    });
    await takePhoto({ crop: { aspect: [1, 1] } });
    expect(during).toBeUndefined();

    const uri = shot();
    mockPending.mockResolvedValue(pickedAt(uri));
    expect(await recoverPendingPick()).toBeNull();
    expect(memoryFs.exists(uri)).toBe(false);
  });

  it('nothing pending: nothing to recover', async () => {
    onPlatform('android');
    expect(await recoverPendingPick()).toBeNull();
    onPlatform('ios');
    mockPending.mockResolvedValue(picked);
    expect(await recoverPendingPick()).toBeNull();
  });
});
