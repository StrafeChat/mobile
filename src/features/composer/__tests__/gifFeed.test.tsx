/**
 * The GIF feed's paging: a later page that repeats a GIF already shown (trending shifts
 * between requests) must not put the same id in the grid twice - the grid keys tiles by id.
 */
import '@/ui/__tests__/setup';
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useGifFeed } from '../hooks/useGifFeed';

const gif = (id: string) => ({ id, url: `https://g/${id}.gif`, previewUrl: '', stillUrl: '', previewWidth: 1, previewHeight: 1, title: id });

const mockFetchGifs = jest.fn<(...a: unknown[]) => Promise<unknown>>();
jest.mock('@web/lib/gif/providers', () => ({
  ...jest.requireActual<object>('@web/lib/gif/providers'),
  gifProviderConfigured: () => true,
  fetchGifs: (...a: unknown[]) => mockFetchGifs(...a),
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockFetchGifs.mockReset();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('a repeated GIF on the next page is dropped, not listed twice', async () => {
  const first = Array.from({ length: 24 }, (_, i) => gif(`a${i}`));
  mockFetchGifs
    .mockResolvedValueOnce({ results: first, nextOffset: 24, totalCount: 100 })
    .mockResolvedValueOnce({ results: [gif('a23'), gif('b1')], nextOffset: 48, totalCount: 100 });
  const { result } = await renderHook(() => useGifFeed('giphy', ''));
  await act(async () => {
    await Promise.resolve();
  });
  expect(result.current.items).toHaveLength(24);
  await act(async () => {
    result.current.loadMore();
    await Promise.resolve();
  });
  const ids = result.current.items.map((g) => g.id);
  expect(ids).toHaveLength(25);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids[ids.length - 1]).toBe('b1');
});
