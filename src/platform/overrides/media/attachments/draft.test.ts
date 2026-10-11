/**
 * The composer queue over picker results: the web's validation and API, mobile file shapes,
 * dimensions, and deletion of app-owned copies that are discarded.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Image } from 'react-native';

import { memoryFs } from '../../../media/testing/memoryFileSystem';
import { createAttachmentDraft } from './draft';

jest.mock('expo-file-system', () => require('../../../media/testing/memoryFileSystem'));
jest.mock('@web/i18n/t', () => ({
  t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
}));

const getSize = jest.spyOn(Image, 'getSize');

function put(name: string, bytes = 10): string {
  return memoryFs.put(`${memoryFs.cacheUri}/picks/${name}`, new Uint8Array(bytes).fill(7));
}

beforeEach(() => {
  memoryFs.reset();
  getSize.mockReset();
  getSize.mockImplementation(async () => ({ width: 800, height: 600 }));
});

describe('createAttachmentDraft', () => {
  it('queues picker assets as LocalFiles with previews and dimensions', async () => {
    const draft = createAttachmentDraft();
    const imageAsset = { uri: put('a.jpg'), fileName: 'IMG_1.jpg', fileSize: 10, mimeType: 'image/jpeg', width: 4032, height: 3024, type: 'image', owned: true };
    const docAsset = { uri: put('report.pdf', 20), name: 'report.pdf', size: 20, mimeType: 'application/pdf', lastModified: 0, owned: true };
    await draft.addFiles([imageAsset, docAsset]);

    const [img, doc] = draft.items();
    expect(img!.file).toEqual({ uri: imageAsset.uri, name: 'IMG_1.jpg', type: 'image/jpeg', size: 10, width: 4032, height: 3024, owned: true });
    expect(img!.previewUrl).toBe(imageAsset.uri);
    expect([img!.width, img!.height]).toEqual([4032, 3024]);
    expect(doc!.file).toEqual({ uri: docAsset.uri, name: 'report.pdf', type: 'application/pdf', size: 20, owned: true });
    expect(doc!.previewUrl).toBeUndefined();
    // The picker knew the image's size; no need to decode it.
    expect(getSize).not.toHaveBeenCalled();
    expect(draft.error()).toBe('');
    expect(img!.localId).not.toBe(doc!.localId);
  });

  it('reads dimensions of an image the picker did not measure, and fills in type and size', async () => {
    const draft = createAttachmentDraft();
    const uri = put('shot.png', 33);
    await draft.addFiles([{ uri }]);
    const [item] = draft.items();
    expect(item!.file).toEqual({ uri, name: 'shot.png', type: 'image/png', size: 33 });
    expect([item!.width, item!.height]).toEqual([800, 600]);
    expect(getSize).toHaveBeenCalledWith(uri);
  });

  it('gives audio a preview, so a recorded voice message plays before sending', async () => {
    const draft = createAttachmentDraft();
    const uri = put('rec.m4a');
    await draft.addFiles([{ uri, name: 'voice-message.m4a', type: 'audio/mp4', size: 10, owned: true }]);
    expect(draft.items()[0]!.previewUrl).toBe(uri);
  });

  it("enforces the web's limits with the web's messages, deleting refused copies", async () => {
    const draft = createAttachmentDraft({ maxFiles: 2, maxBytes: 15 });
    const big = put('big.bin', 16);
    const empty = memoryFs.put(`${memoryFs.cacheUri}/picks/empty.txt`, new Uint8Array(0));
    await draft.addFiles([{ uri: big, owned: true }, { uri: empty, owned: true }]);
    expect(draft.items()).toHaveLength(0);
    // As on the web, the last problem is the one reported.
    expect(draft.error()).toBe('attachments.empty {"name":"empty.txt"}');
    expect(memoryFs.exists(big)).toBe(false);
    expect(memoryFs.exists(empty)).toBe(false);

    await draft.addFiles([{ uri: put('b.txt', 15) }]);
    expect(draft.error()).toBe('');
    const third = put('c.txt');
    const fourth = put('d.txt');
    await draft.addFiles([{ uri: third }, { uri: fourth, owned: true }]);
    expect(draft.items().map((i) => i.file.name)).toEqual(['b.txt', 'c.txt']);
    expect(draft.error()).toBe('attachments.tooMany {"count":2}');
    expect(memoryFs.exists(fourth)).toBe(false);
    // Not an app-owned copy: not ours to delete.
    expect(memoryFs.exists(third)).toBe(true);

    await draft.addFiles([{ uri: put('e.txt') }]);
    expect(draft.error()).toBe('attachments.tooMany {"count":2}');
  });

  it('reports a too-large file by name with the limit', async () => {
    const draft = createAttachmentDraft({ maxBytes: 1024 });
    await draft.addFiles([{ uri: put('huge.mov', 2048), name: 'huge.mov', mimeType: 'video/quicktime' }]);
    expect(draft.error()).toBe('attachments.tooLarge {"name":"huge.mov","max":"1.0 KB"}');
  });

  it('remove deletes an owned copy; take hands files off without deleting; restore puts them back', async () => {
    const draft = createAttachmentDraft();
    const a = put('a.jpg');
    const b = put('b.jpg');
    await draft.addFiles([{ uri: a, owned: true }, { uri: b, owned: true }]);
    const [first] = draft.items();
    draft.remove(first!.localId);
    expect(memoryFs.exists(a)).toBe(false);
    expect(draft.items()).toHaveLength(1);

    const taken = draft.take();
    expect(taken).toHaveLength(1);
    expect(draft.items()).toHaveLength(0);
    expect(memoryFs.exists(b)).toBe(true);

    draft.restore(taken);
    expect(draft.items()).toEqual(taken);
  });

  it('clear discards the queue and its owned copies', async () => {
    const draft = createAttachmentDraft();
    const a = put('a.jpg');
    const b = put('b.jpg');
    await draft.addFiles([{ uri: a, owned: true }, { uri: b }]);
    draft.setError('x');
    draft.clear();
    expect(draft.items()).toEqual([]);
    expect(draft.error()).toBe('');
    expect(memoryFs.exists(a)).toBe(false);
    expect(memoryFs.exists(b)).toBe(true);
  });

  it('ignores entries without a URI', async () => {
    const draft = createAttachmentDraft();
    await draft.addFiles([{ uri: '' }, null as unknown as { uri: string }]);
    expect(draft.items()).toEqual([]);
    expect(draft.error()).toBe('');
  });
});
