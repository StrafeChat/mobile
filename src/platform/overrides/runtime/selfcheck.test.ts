import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { runSelfCheck } from './selfcheck';

const OriginalURL = globalThis.URL;

afterEach(() => {
  globalThis.URL = OriginalURL;
});

function quietLog() {
  return { log: jest.fn(), error: jest.fn() };
}

describe('runSelfCheck', () => {
  test('passes every check on a complete engine, one log line each', async () => {
    const log = quietLog();
    const results = await runSelfCheck(log);
    expect(results.map((r) => r.name)).toEqual(['emoji regex', 'intl', 'crypto.subtle', 'url', 'solid reactivity', 'engine']);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenLastCalledWith('[selfcheck] all 6 checks passed');
  });

  test('reports a broken API by name and keeps checking the rest', async () => {
    globalThis.URL = class extends OriginalURL {
      get hostname(): string {
        throw new TypeError('not implemented');
      }
    } as typeof URL;
    const log = quietLog();
    const results = await runSelfCheck(log);
    const url = results.find((r) => r.name === 'url');
    expect(url).toEqual({ name: 'url', ok: false, detail: 'not implemented' });
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(log.error).toHaveBeenCalledWith('[selfcheck] FAIL  url: not implemented');
    expect(log.error).toHaveBeenLastCalledWith('[selfcheck] 1 of 6 checks failed - see above');
  });
});
