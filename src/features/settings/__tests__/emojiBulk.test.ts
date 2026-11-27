/// <reference types="jest" />
/**
 * The bulk emoji upload logic the app shares with the web (`@web/lib/emojiBulk`): names from
 * file names, the review problems, batching, and the uploader's rate-limit, body-limit and
 * old-instance handling.
 */
import { ApiError } from '@web/api/ApiError';
import type { CustomEmoji } from '@web/api/emojis';
import {
  batchEmojiItems,
  emojiDraftProblems,
  emojiNameFromFile,
  emojiUploadErrorText,
  namesForNewFiles,
  uniqueEmojiName,
  uploadEmojiItems,
  type EmojiUploadItem,
  type EmojiUploadOutcome,
} from '@web/lib/emojiBulk';

const mockBulk = jest.fn();
const mockSingle = jest.fn();

// The store is only written on success (rememberSpaceEmoji); keep the gateway out of the test.
jest.mock('@web/stores/customEmojis', () => ({ setCustomEmojis: jest.fn() }));

jest.mock('@web/api/emojis', () => ({
  ...jest.requireActual('@web/api/emojis'),
  uploadSpaceEmojisBulk: (...args: unknown[]) => mockBulk(...args),
  uploadSpaceEmoji: (...args: unknown[]) => mockSingle(...args),
}));

function emoji(name: string): CustomEmoji {
  return { id: `id_${name}`, space_id: 's', name, url: `https://cdn.test/${name}.png`, animated: false };
}

function items(n: number, size = 100): EmojiUploadItem[] {
  return Array.from({ length: n }, (_, i) => ({ key: `k${i}`, file: { name: `e${i}.png` } as unknown as File, name: `e${i}`, size }));
}

/** A bulk answer that creates every item it is sent. */
function createAll(_space: string, batch: { name: string }[]) {
  return Promise.resolve({ created: batch.length, results: batch.map((b, index) => ({ index, name: b.name, status: 201, emoji: emoji(b.name) })) });
}

beforeEach(() => {
  mockBulk.mockReset();
  mockSingle.mockReset();
});

describe('names', () => {
  it('cleans file names to the server rule', () => {
    expect(emojiNameFromFile('Party Blob!.png')).toBe('party_blob');
    expect(emojiNameFromFile('folder/sub/Wave.GIF')).toBe('wave');
    expect(emojiNameFromFile('a.png')).toBe('a_emoji');
    expect(emojiNameFromFile('🎉.png')).toBe('emoji');
    expect(emojiNameFromFile(`${'x'.repeat(40)}.png`)).toHaveLength(32);
  });

  it('makes names unique against the space and the batch, within 32 characters', () => {
    expect(uniqueEmojiName('wave', new Set(['wave', 'wave_2']))).toBe('wave_3');
    expect(uniqueEmojiName('x'.repeat(32), new Set(['x'.repeat(32)]))).toBe(`${'x'.repeat(30)}_2`);
    expect(namesForNewFiles(['Wave.png', 'wave.gif', 'blob.png'], ['WAVE'])).toEqual(['wave_2', 'wave_3', 'blob']);
  });
});

describe('review problems', () => {
  const row = (key: string, name: string, filename = `${name}.png`, size = 100) => ({ key, name, filename, size });

  it('flags type, size, name, taken, duplicate and slots, in that order', () => {
    const problems = emojiDraftProblems(
      [
        row('a', 'ok_one'),
        row('b', 'bmp', 'x.bmp'),
        row('c', 'big', 'big.png', 600 * 1024),
        row('d', 'x'),
        row('e', 'Existing'),
        row('f', 'OK_ONE'),
        row('g', ':ok_two:'),
        row('h', 'ok_three'),
      ],
      { existingNames: ['existing'], free: 2 },
    );
    expect(problems).toEqual({ a: null, b: 'type', c: 'size', d: 'name', e: 'taken', f: 'duplicate', g: null, h: 'noSlot' });
  });
});

describe('batches', () => {
  it('splits by count and by bytes', () => {
    expect(batchEmojiItems(items(23)).map((b) => b.length)).toEqual([10, 10, 3]);
    expect(batchEmojiItems(items(5, 3 * 1024 * 1024)).map((b) => b.length)).toEqual([2, 2, 1]);
  });
});

describe('uploader', () => {
  it('reports each item, successes and refusals, in order', async () => {
    mockBulk.mockImplementation((_s: string, batch: { name: string }[]) =>
      Promise.resolve({
        created: 1,
        results: batch.map((b, index) =>
          index === 1 ? { index, name: b.name, status: 400, error: 'an emoji with that name already exists in this space' } : { index, name: b.name, status: 201, emoji: emoji(b.name) },
        ),
      }),
    );
    const outcomes: EmojiUploadOutcome[] = [];
    const summary = await uploadEmojiItems('s', items(3), { onResult: (o) => outcomes.push(o) });
    expect(summary).toEqual({ created: 2, failed: 1, aborted: false });
    expect(outcomes.map((o) => [o.key, o.ok])).toEqual([
      ['k0', true],
      ['k1', false],
      ['k2', true],
    ]);
  });

  it('waits out a 429 for retry_after and tries the same batch again', async () => {
    mockBulk.mockRejectedValueOnce(new ApiError('rate limited', 429, undefined, undefined, { retry_after: 7 })).mockImplementation(createAll);
    const sleep = jest.fn(async () => undefined);
    const waits: number[] = [];
    const summary = await uploadEmojiItems('s', items(12), { onResult: () => undefined, onWait: (s) => waits.push(s), sleep });
    expect(summary.created).toBe(12);
    expect(waits).toEqual([7]);
    expect(sleep).toHaveBeenCalledWith(7000, undefined);
    expect(mockBulk).toHaveBeenCalledTimes(3);
  });

  it('splits a batch the body limit refused', async () => {
    mockBulk.mockImplementation((s: string, batch: { name: string }[]) =>
      batch.length > 3 ? Promise.reject(new ApiError('HTTP 413', 413)) : createAll(s, batch),
    );
    const summary = await uploadEmojiItems('s', items(8), { onResult: () => undefined });
    expect(summary.created).toBe(8);
  });

  it('falls back to the single route on an instance without the bulk one', async () => {
    mockBulk.mockRejectedValue(new ApiError('HTTP 404', 404, undefined, undefined, {}));
    mockSingle.mockImplementation((_s: string, _f: File, name: string) => Promise.resolve(emoji(name)));
    const summary = await uploadEmojiItems('s', items(3), { onResult: () => undefined });
    expect(summary.created).toBe(3);
    expect(mockBulk).toHaveBeenCalledTimes(1);
    expect(mockSingle).toHaveBeenCalledTimes(3);
  });

  it('fails a batch whose request was refused as a whole, and carries on', async () => {
    mockBulk.mockRejectedValueOnce(new ApiError('missing permission', 403, undefined, undefined, { error: 'missing permission' })).mockImplementation(createAll);
    const outcomes: EmojiUploadOutcome[] = [];
    const summary = await uploadEmojiItems('s', items(11), { onResult: (o) => outcomes.push(o) });
    expect(summary).toEqual({ created: 1, failed: 10, aborted: false });
    expect(outcomes[0]).toEqual({ key: 'k0', ok: false, status: 403, error: 'missing permission' });
  });

  it('stops before the next request once aborted', async () => {
    const controller = new AbortController();
    mockBulk.mockImplementation((s: string, batch: { name: string }[]) => {
      controller.abort();
      return createAll(s, batch);
    });
    const summary = await uploadEmojiItems('s', items(25), { onResult: () => undefined, signal: controller.signal });
    expect(summary).toEqual({ created: 10, failed: 0, aborted: true });
  });

  it('translates the refusals a reader can act on', () => {
    const t = (key: string, opts?: Record<string, string>) => (opts?.max ? `${key}:${opts.max}` : key);
    expect(emojiUploadErrorText('emoji images must be under 512 KB', t, 512 * 1024, () => '512 KB')).toBe('spaceEmoji.tooLarge:512 KB');
    expect(emojiUploadErrorText('an emoji with that name already exists in this space', t)).toBe('spaceEmoji.nameTaken');
    expect(emojiUploadErrorText('', t)).toBe('spaceEmoji.uploadFailed');
  });
});
