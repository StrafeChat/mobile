/**
 * The Intl APIs the shared web code uses, polyfilled only where the engine lacks them.
 *
 * Hermes ships Intl.DateTimeFormat, NumberFormat, Collator and getCanonicalLocales, but on
 * the versions this app targets not (reliably) PluralRules or RelativeTimeFormat. Both are
 * load-bearing: i18next picks `_one/_other` (and Arabic's six forms) with PluralRules, and
 * falls back to English rules without it; message timestamps ("yesterday", "3 minutes
 * ago") use RelativeTimeFormat and throw without it.
 *
 * Each API is tested for, including support for all six app locales, and only a missing or
 * incomplete one is replaced - a native implementation is faster and already has its data.
 * The formatjs polyfills need Intl.getCanonicalLocales and Intl.Locale themselves, so those
 * come first, through their own conditional entry points. Locale data is limited to the
 * six app locales (pt covers pt-BR: Brazilian Portuguese is CLDR's default "pt").
 *
 * Must run before i18next initialises (src/platform/i18n.ts), so shims/index.ts imports it
 * ahead of '../i18n'. `require` rather than `import` so nothing loads unless it is needed.
 */

/** The app's locales as Intl tags (src/i18n/locales, web/src/i18n/locales). */
const APP_LOCALES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ar'];

function pluralRulesUsable(): boolean {
  try {
    if (typeof Intl === 'undefined' || typeof Intl.PluralRules !== 'function') return false;
    // An old ICU bug formatjs also checks for: fraction digits must make 1 "other" in English.
    if (new Intl.PluralRules('en', { minimumFractionDigits: 2 }).select(1) === 'one') return false;
    return Intl.PluralRules.supportedLocalesOf(APP_LOCALES).length === APP_LOCALES.length;
  } catch {
    return false;
  }
}

function relativeTimeFormatUsable(): boolean {
  try {
    if (typeof Intl === 'undefined' || typeof Intl.RelativeTimeFormat !== 'function') return false;
    if (Intl.RelativeTimeFormat.supportedLocalesOf(APP_LOCALES).length !== APP_LOCALES.length) return false;
    return typeof new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-1, 'day') === 'string';
  } catch {
    return false;
  }
}

/** What was installed, for the self-check's log and for tests. */
export const installedIntlPolyfills: string[] = [];

export function installIntlPolyfills(): void {
  const needPluralRules = !pluralRulesUsable();
  const needRelativeTimeFormat = !relativeTimeFormatUsable();
  if (!needPluralRules && !needRelativeTimeFormat) return;

  // Prerequisites of both polyfills; each entry point checks the engine itself.
  require('@formatjs/intl-getcanonicallocales/polyfill.js');
  require('@formatjs/intl-locale/polyfill.js');

  if (needPluralRules) {
    require('@formatjs/intl-pluralrules/polyfill-force.js');
    require('@formatjs/intl-pluralrules/locale-data/en.js');
    require('@formatjs/intl-pluralrules/locale-data/es.js');
    require('@formatjs/intl-pluralrules/locale-data/pt.js');
    require('@formatjs/intl-pluralrules/locale-data/fr.js');
    require('@formatjs/intl-pluralrules/locale-data/de.js');
    require('@formatjs/intl-pluralrules/locale-data/ar.js');
    installedIntlPolyfills.push('PluralRules');
  }
  if (needRelativeTimeFormat) {
    // Formats through PluralRules, so after it.
    require('@formatjs/intl-relativetimeformat/polyfill-force.js');
    require('@formatjs/intl-relativetimeformat/locale-data/en.js');
    require('@formatjs/intl-relativetimeformat/locale-data/es.js');
    require('@formatjs/intl-relativetimeformat/locale-data/pt.js');
    require('@formatjs/intl-relativetimeformat/locale-data/fr.js');
    require('@formatjs/intl-relativetimeformat/locale-data/de.js');
    require('@formatjs/intl-relativetimeformat/locale-data/ar.js');
    installedIntlPolyfills.push('RelativeTimeFormat');
  }
}

installIntlPolyfills();
