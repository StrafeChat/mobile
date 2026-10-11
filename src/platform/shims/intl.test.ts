import { afterEach, describe, expect, jest, test } from '@jest/globals';

// Which polyfill entry points got loaded. The real ones are ESM that jest does not
// transform; what matters here is the decision to load them, and the order.
const mockRequired: string[] = [];
jest.mock('@formatjs/intl-getcanonicallocales/polyfill.js', () => void mockRequired.push('getCanonicalLocales'));
jest.mock('@formatjs/intl-locale/polyfill.js', () => void mockRequired.push('Locale'));
jest.mock('@formatjs/intl-pluralrules/polyfill-force.js', () => void mockRequired.push('PluralRules'));
jest.mock('@formatjs/intl-pluralrules/locale-data/en.js', () => void mockRequired.push('PluralRules:en'));
jest.mock('@formatjs/intl-pluralrules/locale-data/es.js', () => void mockRequired.push('PluralRules:es'));
jest.mock('@formatjs/intl-pluralrules/locale-data/pt.js', () => void mockRequired.push('PluralRules:pt'));
jest.mock('@formatjs/intl-pluralrules/locale-data/fr.js', () => void mockRequired.push('PluralRules:fr'));
jest.mock('@formatjs/intl-pluralrules/locale-data/de.js', () => void mockRequired.push('PluralRules:de'));
jest.mock('@formatjs/intl-pluralrules/locale-data/ar.js', () => void mockRequired.push('PluralRules:ar'));
jest.mock('@formatjs/intl-relativetimeformat/polyfill-force.js', () => void mockRequired.push('RelativeTimeFormat'));
jest.mock('@formatjs/intl-relativetimeformat/locale-data/en.js', () => void mockRequired.push('RelativeTimeFormat:en'));
jest.mock('@formatjs/intl-relativetimeformat/locale-data/es.js', () => void mockRequired.push('RelativeTimeFormat:es'));
jest.mock('@formatjs/intl-relativetimeformat/locale-data/pt.js', () => void mockRequired.push('RelativeTimeFormat:pt'));
jest.mock('@formatjs/intl-relativetimeformat/locale-data/fr.js', () => void mockRequired.push('RelativeTimeFormat:fr'));
jest.mock('@formatjs/intl-relativetimeformat/locale-data/de.js', () => void mockRequired.push('RelativeTimeFormat:de'));
jest.mock('@formatjs/intl-relativetimeformat/locale-data/ar.js', () => void mockRequired.push('RelativeTimeFormat:ar'));

const original = { PluralRules: Intl.PluralRules, RelativeTimeFormat: Intl.RelativeTimeFormat };

function loadShim(): { installedIntlPolyfills: string[] } {
  let mod: { installedIntlPolyfills: string[] } | undefined;
  jest.isolateModules(() => {
    mod = require('./intl') as { installedIntlPolyfills: string[] };
  });
  return mod!;
}

afterEach(() => {
  mockRequired.length = 0;
  Object.assign(Intl, original);
});

describe('Intl polyfills', () => {
  test('a complete engine gets nothing', () => {
    expect(loadShim().installedIntlPolyfills).toEqual([]);
    expect(mockRequired).toEqual([]);
  });

  test('a missing RelativeTimeFormat is polyfilled with the six locales, after its prerequisites', () => {
    (Intl as { RelativeTimeFormat?: unknown }).RelativeTimeFormat = undefined;
    expect(loadShim().installedIntlPolyfills).toEqual(['RelativeTimeFormat']);
    expect(mockRequired).toEqual([
      'getCanonicalLocales',
      'Locale',
      'RelativeTimeFormat',
      'RelativeTimeFormat:en',
      'RelativeTimeFormat:es',
      'RelativeTimeFormat:pt',
      'RelativeTimeFormat:fr',
      'RelativeTimeFormat:de',
      'RelativeTimeFormat:ar',
    ]);
  });

  test('PluralRules without one of the app locales is replaced', () => {
    const Native = original.PluralRules;
    class WithoutArabic extends Native {
      static supportedLocalesOf(locales: string | string[]): string[] {
        return Native.supportedLocalesOf(locales).filter((l) => !l.startsWith('ar'));
      }
    }
    (Intl as { PluralRules: unknown }).PluralRules = WithoutArabic;
    expect(loadShim().installedIntlPolyfills).toEqual(['PluralRules']);
    expect(mockRequired.slice(0, 3)).toEqual(['getCanonicalLocales', 'Locale', 'PluralRules']);
    expect(mockRequired).toContain('PluralRules:ar');
    expect(mockRequired).not.toContain('RelativeTimeFormat');
  });
});
