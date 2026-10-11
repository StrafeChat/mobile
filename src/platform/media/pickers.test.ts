import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockLibrary = jest.fn<(o: Record<string, unknown>) => Promise<unknown>>();
const mockCamera = jest.fn<(o: Record<string, unknown>) => Promise<unknown>>();

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: (o: Record<string, unknown>) => mockLibrary(o),
  launchCameraAsync: (o: Record<string, unknown>) => mockCamera(o),
  getCameraPermissionsAsync: async () => ({ granted: true, canAskAgain: true }),
  requestCameraPermissionsAsync: async () => ({ granted: true }),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: 'compatible' },
}));
jest.mock('expo-document-picker', () => ({}));
jest.mock('expo-file-system', () => require('./testing/memoryFileSystem'));

const { pickFromLibrary, takePhoto } = require('./pickers') as typeof import('./pickers');

const picked = { canceled: false, assets: [{ uri: 'file:///cache/a.jpg', fileName: 'a.jpg', mimeType: 'image/jpeg', fileSize: 10 }] };

beforeEach(() => {
  mockLibrary.mockReset().mockResolvedValue(picked);
  mockCamera.mockReset().mockResolvedValue(picked);
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
