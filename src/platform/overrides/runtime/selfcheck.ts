/**
 * A development-build check, run once at start-up on the device, that the engine gives the
 * shared web code what it silently relies on.
 *
 * Each of these fails without a red screen when missing: the emoji matcher throws at module
 * load deep inside message rendering (Unicode property escapes), i18next falls back to
 * English plural rules without Intl.PluralRules, timestamps throw without
 * Intl.RelativeTimeFormat, attachments and the key backup need crypto.subtle, the gateway
 * URL and message paging need a URL with working getters and setters, and every store
 * goes quiet if solid-js resolved to its server build. A line in the Metro log per check
 * finds such a regression on the first launch instead of in a bug report.
 *
 * Nothing here runs in release builds (boot.ts calls it under __DEV__).
 */
import { createComputed, createRoot, createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import { installedIntlPolyfills } from '../../shims/intl';

export interface SelfCheckResult {
  name: string;
  ok: boolean;
  detail: string;
}

/** The six locales the app ships (src/i18n/locales, web/src/i18n/locales). */
const APP_LOCALES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ar'];

type Check = () => string | Promise<string>;

function fail(message: string): never {
  throw new Error(message);
}

const checks: Record<string, Check> = {
  'emoji regex'() {
    // The module builds its matchers at load; a missing \p{...} escape throws right here.
    const { isSingleEmoji, EMOJI_REGEX } = require('@web/lib/emoji/regex') as typeof import('@web/lib/emoji/regex');
    if (!isSingleEmoji('\u{1F44D}\u{1F3FD}')) fail('skin-tone sequence not matched');
    if (!isSingleEmoji('\u{1F3F3}️‍\u{1F308}')) fail('ZWJ sequence not matched');
    if (!isSingleEmoji('\u{1F1EB}\u{1F1F7}')) fail('flag not matched');
    if (isSingleEmoji('©')) fail('text-presentation (c) matched as emoji');
    const found = 'hi \u{1F600} there \u{1F44B}'.match(EMOJI_REGEX)?.length ?? 0;
    if (found !== 2) fail(`expected 2 matches, got ${found}`);
    return 'Unicode property escapes work';
  },

  'game activity'() {
    // lib/activity builds its name matchers (general categories Cc, Cf, Mn, Me) at load, and
    // formats "for 1 hr 2 min" with Intl unit styles - which a Hermes build may lack, and then
    // reads "1:02". Both are fine; this says which one the profile card shows.
    const { cleanActivityName, formatActivityDuration } = require('@web/lib/activity') as typeof import('@web/lib/activity');
    const ch = (cp: number) => String.fromCodePoint(cp);
    if (cleanActivityName(`${ch(0x202e)}Hades${ch(7)}  II `) !== 'Hades II') fail('a name is not cleaned');
    if (cleanActivityName(`${ch(0x3164)} ${ch(0x2800)}`) !== null) fail('a blank name is kept');
    if (cleanActivityName(`A${ch(0x200d)}B`) !== `A${ch(0x200d)}B`) fail('a joiner is dropped');
    const d = formatActivityDuration(62 * 60_000, 'en');
    if (!d.includes('1') || !d.includes('2')) fail(`62 minutes read "${d}"`);
    for (const l of APP_LOCALES) if (!formatActivityDuration(62 * 60_000, l)) fail(`no duration in ${l}`);
    const units = /^\d+:\d\d$/.test(d) ? 'no Intl unit style, durations read "1:02"' : `durations read "${d}"`;
    const list = typeof (Intl as { ListFormat?: unknown }).ListFormat === 'function' ? '' : ' (no Intl.ListFormat: parts joined with a space)';
    return `names cleaned; ${units}${list}`;
  },

  intl() {
    if (typeof Intl === 'undefined') fail('no Intl');
    if (typeof Intl.PluralRules !== 'function') fail('Intl.PluralRules missing');
    const unsupported = APP_LOCALES.filter((l) => Intl.PluralRules.supportedLocalesOf([l]).length === 0);
    if (unsupported.length) fail(`PluralRules lacks ${unsupported.join(', ')}`);
    // Arabic is the one locale whose six plural forms the translations depend on.
    const ar = new Intl.PluralRules('ar');
    const forms = [0, 1, 2, 3, 11, 100].map((n) => ar.select(n)).join(',');
    if (forms !== 'zero,one,two,few,many,other') fail(`Arabic plural forms wrong: ${forms}`);
    if (new Intl.PluralRules('en').select(1) !== 'one') fail('English plural "one" wrong');
    if (typeof Intl.RelativeTimeFormat !== 'function') fail('Intl.RelativeTimeFormat missing');
    const yesterday = new Intl.RelativeTimeFormat('en', { numeric: 'auto' }).format(-1, 'day');
    if (yesterday !== 'yesterday') fail(`RelativeTimeFormat gave "${yesterday}"`);
    const rtfMissing = APP_LOCALES.filter((l) => Intl.RelativeTimeFormat.supportedLocalesOf([l]).length === 0);
    if (rtfMissing.length) fail(`RelativeTimeFormat lacks ${rtfMissing.join(', ')}`);
    if (typeof Intl.DateTimeFormat !== 'function') fail('Intl.DateTimeFormat missing');
    if (typeof Intl.NumberFormat !== 'function') fail('Intl.NumberFormat missing');
    // The option shapes lib/utils/messageTimestamp.ts uses.
    new Intl.DateTimeFormat('ar', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
      new Date(0),
    );
    const polyfilled = installedIntlPolyfills.length ? ` (polyfilled: ${installedIntlPolyfills.join(', ')})` : ' (all native)';
    return `PluralRules, RelativeTimeFormat, DateTimeFormat, NumberFormat for ${APP_LOCALES.join(' ')}${polyfilled}`;
  },

  async 'crypto.subtle'() {
    const c = (globalThis as { crypto?: Crypto }).crypto;
    if (!c || typeof c.getRandomValues !== 'function') fail('crypto.getRandomValues missing');
    if (!c.subtle || typeof c.subtle.digest !== 'function') fail('crypto.subtle missing');
    const digest = new Uint8Array(await c.subtle.digest('SHA-256', new TextEncoder().encode('abc')));
    const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
    if (hex !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') fail('SHA-256 of "abc" is wrong');
    const key = await c.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    const iv = c.getRandomValues(new Uint8Array(12));
    const sealed = await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode('strafe'));
    const opened = new TextDecoder().decode(await c.subtle.decrypt({ name: 'AES-GCM', iv }, key, sealed));
    if (opened !== 'strafe') fail('AES-GCM round trip failed');
    return 'SHA-256 and AES-GCM round trip';
  },

  url() {
    // The gateway client sets pathname and a search param on a parsed URL; message paging
    // and search build query strings with URLSearchParams.set.
    const u = new URL('https://chat.example.org:8443/api/x?y=1');
    if (u.hostname !== 'chat.example.org') fail(`hostname "${u.hostname}"`);
    if (u.port !== '8443' || u.host !== 'chat.example.org:8443') fail(`host "${u.host}"`);
    u.pathname = '/events';
    u.searchParams.set('token', 'a b');
    if (u.toString() !== 'https://chat.example.org:8443/events?y=1&token=a+b') fail(`built "${u.toString()}"`);
    const q = new URLSearchParams();
    q.set('before', '123');
    if (q.toString() !== 'before=123') fail('URLSearchParams.set');
    return 'getters, pathname setter, searchParams.set';
  },

  'solid reactivity'() {
    // The server build of solid-js runs computations once and never again.
    let seen = -1;
    let storeSeen = '';
    const dispose = createRoot((d) => {
      const [count, setCount] = createSignal(0);
      const [store, setStore] = createStore({ name: 'a' });
      createComputed(() => {
        seen = count();
      });
      createComputed(() => {
        storeSeen = store.name;
      });
      setCount(1);
      setStore('name', 'b');
      return d;
    });
    dispose();
    if (seen !== 1) fail('a signal did not notify');
    if (storeSeen !== 'b') fail('a store did not notify');
    return 'signals and stores notify';
  },

  engine() {
    // Smaller things the stores assume: snowflake comparison, mention parsing, timers.
    if (typeof BigInt !== 'function' || BigInt('18446744073709551615') <= BigInt('9007199254740993')) fail('BigInt');
    if (typeof ''.matchAll !== 'function') fail('String.prototype.matchAll');
    if (typeof queueMicrotask !== 'function') fail('queueMicrotask');
    if (typeof structuredClone !== 'function') fail('structuredClone');
    return 'BigInt, matchAll, queueMicrotask, structuredClone';
  },
};

/** Run every check and log one line each; resolves with the results (never throws). */
export async function runSelfCheck(log: Pick<Console, 'log' | 'error'> = console): Promise<SelfCheckResult[]> {
  const results: SelfCheckResult[] = [];
  for (const [name, check] of Object.entries(checks)) {
    try {
      results.push({ name, ok: true, detail: await check() });
    } catch (e) {
      results.push({ name, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const r of results) {
    if (r.ok) log.log(`[selfcheck] ok    ${r.name}: ${r.detail}`);
    else log.error(`[selfcheck] FAIL  ${r.name}: ${r.detail}`);
  }
  const failedCount = results.filter((r) => !r.ok).length;
  if (failedCount) log.error(`[selfcheck] ${failedCount} of ${results.length} checks failed - see above`);
  else log.log(`[selfcheck] all ${results.length} checks passed`);
  return results;
}
