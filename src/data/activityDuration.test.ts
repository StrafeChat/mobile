/**
 * "for 1 hr 2 min" on the engines the app runs on. The duration is the web's
 * formatActivityDuration (lib/activity), built from Intl.NumberFormat's unit style and
 * Intl.ListFormat. Hermes has no Intl.ListFormat at all, and a build whose NumberFormat lacks
 * unit formatting either throws on `style: 'unit'` or quietly formats a bare number (an engine
 * ignoring options it does not know). The app ships no polyfill for either, so each of those
 * must still read sensibly: the parts joined by a space, or "h:mm".
 */
import { afterEach, beforeAll, describe, expect, test } from '@jest/globals';
import './testing/webMocks';
import i18next from 'i18next';
import en from '@web/i18n/locales/en';
import { formatActivityDuration } from '@web/lib/activity';
import { activityElapsedLabel } from './activity';

const MIN = 60_000;
const LOCALES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ar'];

type NumberFormatCtor = typeof Intl.NumberFormat;
const RealNumberFormat: NumberFormatCtor = Intl.NumberFormat;
const RealListFormat: unknown = (Intl as unknown as { ListFormat?: unknown }).ListFormat;

function setIntl(name: 'NumberFormat' | 'ListFormat', value: unknown): void {
  if (value === undefined) delete (Intl as unknown as Record<string, unknown>)[name];
  else Object.defineProperty(Intl, name, { value, configurable: true, writable: true });
}

/** A NumberFormat that ignores the unit options, as an engine without unit support may. */
function IgnoresUnits(this: unknown, locale?: string | string[], opts: Intl.NumberFormatOptions = {}) {
  const { style, unit: _unit, unitDisplay: _unitDisplay, ...rest } = opts;
  return new RealNumberFormat(locale, style === 'unit' ? rest : opts);
}

/** A NumberFormat that refuses the unit style, as an engine without unit support may. */
function RefusesUnits(this: unknown, locale?: string | string[], opts: Intl.NumberFormatOptions = {}) {
  if (opts.style === 'unit') throw new RangeError('Invalid style');
  return new RealNumberFormat(locale, opts);
}

beforeAll(() => {
  i18next.addResourceBundle('en', 'translation', { activity: en.activity }, true, true);
});

afterEach(() => {
  setIntl('NumberFormat', RealNumberFormat);
  setIntl('ListFormat', RealListFormat);
});

describe('with full Intl (the reference)', () => {
  test('whole minutes, hours from sixty on, never zero or negative', () => {
    expect(formatActivityDuration(62 * MIN, 'en')).toBe('1 hr 2 min');
    expect(formatActivityDuration(45 * MIN + 59_000, 'en')).toBe('45 min');
    expect(formatActivityDuration(120 * MIN, 'en')).toBe('2 hr');
    expect(formatActivityDuration(10_000, 'en')).toBe('1 min');
    // A sender's clock ahead of ours, or garbage: still a minute.
    expect(formatActivityDuration(-5 * MIN, 'en')).toBe('1 min');
    expect(formatActivityDuration(Number.NaN, 'en')).toBe('1 min');
  });

  test('every app language formats it', () => {
    for (const lng of LOCALES) {
      const s = formatActivityDuration(62 * MIN, lng);
      expect(s).toMatch(/1/);
      expect(s).toMatch(/2/);
      expect(s).not.toMatch(/^\d+:\d\d$/);
    }
  });
});

describe('Hermes-like engines', () => {
  test('no Intl.ListFormat (Hermes has none): the parts joined with a space', () => {
    setIntl('ListFormat', undefined);
    expect((Intl as unknown as { ListFormat?: unknown }).ListFormat).toBeUndefined();
    expect(formatActivityDuration(62 * MIN, 'en')).toBe('1 hr 2 min');
    expect(formatActivityDuration(62 * MIN, 'de')).toBe('1 Std. 2 Min.');
    expect(formatActivityDuration(45 * MIN, 'en')).toBe('45 min');
  });

  test('a NumberFormat that ignores the unit style: "h:mm"', () => {
    setIntl('NumberFormat', IgnoresUnits);
    setIntl('ListFormat', undefined);
    expect(formatActivityDuration(62 * MIN, 'en')).toBe('1:02');
    expect(formatActivityDuration(45 * MIN, 'en')).toBe('0:45');
    expect(formatActivityDuration(125 * MIN, 'en')).toBe('2:05');
    expect(formatActivityDuration(0, 'en')).toBe('0:01');
    for (const lng of LOCALES) expect(formatActivityDuration(62 * MIN, lng)).toBe('1:02');
  });

  test('a NumberFormat that throws on the unit style: "h:mm"', () => {
    setIntl('NumberFormat', RefusesUnits);
    expect(formatActivityDuration(62 * MIN, 'en')).toBe('1:02');
    for (const lng of LOCALES) expect(formatActivityDuration(3 * 60 * MIN, lng)).toBe('3:00');
  });

  test('no NumberFormat at all: "h:mm", never a throw', () => {
    setIntl('NumberFormat', undefined);
    setIntl('ListFormat', undefined);
    expect(formatActivityDuration(62 * MIN, 'en')).toBe('1:02');
  });

  test('the profile card\'s line reads the same way', () => {
    const start = 1_761_000_000_000;
    expect(activityElapsedLabel(start, start + 62 * MIN, 'en')).toBe('for 1 hr 2 min');
    setIntl('ListFormat', undefined);
    expect(activityElapsedLabel(start, start + 62 * MIN, 'en')).toBe('for 1 hr 2 min');
    setIntl('NumberFormat', IgnoresUnits);
    expect(activityElapsedLabel(start, start + 62 * MIN, 'en')).toBe('for 1:02');
  });
});
