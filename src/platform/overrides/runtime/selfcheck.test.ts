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
    expect(results.map((r) => r.name)).toEqual(['emoji regex', 'game activity', 'intl', 'crypto.subtle', 'url', 'solid reactivity', 'engine']);
    expect(results.filter((r) => !r.ok)).toEqual([]);
    expect(log.error).not.toHaveBeenCalled();
    expect(log.log).toHaveBeenLastCalledWith('[selfcheck] all 7 checks passed');
  });

  test('says how game durations read: with units, or "1:02" where the engine has no unit style', async () => {
    const full = (await runSelfCheck(quietLog())).find((r) => r.name === 'game activity');
    expect(full).toEqual({ name: 'game activity', ok: true, detail: 'names cleaned; durations read "1 hr 2 min"' });
    const RealNumberFormat = Intl.NumberFormat;
    const RealListFormat = (Intl as { ListFormat?: unknown }).ListFormat;
    // A Hermes build without unit formatting ignores the option; Hermes has no ListFormat.
    function IgnoresUnits(locale?: string | string[], opts: Intl.NumberFormatOptions = {}) {
      const { style, unit: _unit, unitDisplay: _unitDisplay, ...rest } = opts;
      return new RealNumberFormat(locale, style === 'unit' ? rest : opts);
    }
    Object.defineProperty(Intl, 'NumberFormat', { value: IgnoresUnits, configurable: true, writable: true });
    delete (Intl as { ListFormat?: unknown }).ListFormat;
    try {
      const fallback = (await runSelfCheck(quietLog())).find((r) => r.name === 'game activity');
      expect(fallback).toEqual({
        name: 'game activity',
        ok: true,
        detail: 'names cleaned; no Intl unit style, durations read "1:02" (no Intl.ListFormat: parts joined with a space)',
      });
    } finally {
      Object.defineProperty(Intl, 'NumberFormat', { value: RealNumberFormat, configurable: true, writable: true });
      Object.defineProperty(Intl, 'ListFormat', { value: RealListFormat, configurable: true, writable: true });
    }
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
    expect(results.filter((r) => r.ok)).toHaveLength(6);
    expect(log.error).toHaveBeenCalledWith('[selfcheck] FAIL  url: not implemented');
    expect(log.error).toHaveBeenLastCalledWith('[selfcheck] 1 of 7 checks failed - see above');
  });
});
