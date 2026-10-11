/**
 * The HTML page each registration captcha runs in (inside ../CaptchaWebView.tsx).
 *
 * One small page per provider, the same widget the web client renders
 * (web/src/components/auth/*Widget.tsx), configured the same way, posting what happens back to
 * the app as JSON through window.ReactNativeWebView.postMessage:
 *
 *   {type:'ready'}                the widget is on screen (the form can reset it from now on)
 *   {type:'token', token}         solved ('' = expired / errored / reset: the token is gone)
 *   {type:'loadError', detail}    it can never be solved here (script failed, misconfigured)
 *   {type:'height', height}       content height, so the WebView can size to it
 *   {type:'fetch', id, url, method, headers, body}
 *                                 ALTCHA and Cap only: a request for the app to make (below)
 *
 * The app answers a fetch with window.__strafeFetchResult(id, status, contentType, body) and
 * re-arms the widget with window.__strafeCaptchaReset().
 *
 * Why the app makes the requests: ALTCHA's challenge comes from the instance's API and Cap's
 * from the instance's Cap server. From a page the browser would need CORS from both for the
 * page's origin; from the app there is no CORS at all. The app only performs requests to the
 * exact challenge URL (ALTCHA) or under the Cap site endpoint (Cap) - see allowFetch().
 *
 * Pure string building, no React Native: unit-tested in Node.
 */
import { ALTCHA_SCRIPT, CAP_SCRIPT, FRIENDLY_SCRIPT } from './vendor/scripts';

export type CaptchaProvider = 'altcha' | 'cap' | 'friendly' | 'turnstile';

export const CAPTCHA_PROVIDERS: readonly CaptchaProvider[] = ['altcha', 'cap', 'friendly', 'turnstile'];

export function isKnownProvider(p: string): p is CaptchaProvider {
  return (CAPTCHA_PROVIDERS as readonly string[]).includes(p);
}

/** Cloudflare's script, exactly as the web client loads it (TurnstileWidget.tsx). */
export const TURNSTILE_SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface CaptchaPalette {
  dark: boolean;
  background: string;
  foreground: string;
  muted: string;
  border: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  success: string;
  radius: number;
}

export interface CaptchaPageInput {
  provider: CaptchaProvider;
  /** Site key (Cap, Friendly, Turnstile); unused by ALTCHA. */
  siteKey: string;
  /** The Cap server's public URL (instance.captcha.apiUrl); Cap only. */
  capApiUrl?: string;
  /** The instance API (runtimeConfig.apiUrl()); ALTCHA's challenge lives under it. */
  instanceApiUrl: string;
  /** UI language (BCP 47); widgets that are localised get its base tag. */
  language: string;
  palette: CaptchaPalette;
  /** Cap's own labels, translated (auth.captcha.cap.*). */
  capStrings: { initial: string; verifying: string; solved: string; error: string; wasmDisabled: string };
}

export interface CaptchaMessage {
  type: 'ready' | 'token' | 'loadError' | 'height' | 'fetch';
  token?: string;
  detail?: string;
  height?: number;
  id?: number;
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** ALTCHA's challenge endpoint on this instance (AltchaWidget.tsx). */
export function altchaChallengeUrl(instanceApiUrl: string): string {
  return `${instanceApiUrl.replace(/\/+$/, '')}/auth/captcha/challenge`;
}

/** Cap addresses one site as <cap>/<site key>/ - the trailing slash matters (CapWidget.tsx). */
export function capEndpoint(capApiUrl: string | undefined, siteKey: string): string | null {
  const api = (capApiUrl ?? '').trim().replace(/\/+$/, '');
  const key = siteKey.trim().replace(/^\/+|\/+$/g, '');
  if (!api || !key || !/^https?:\/\//i.test(api)) return null;
  return `${api}/${key}/`;
}

/**
 * May the page have the app make this request? Only GET/POST, only http(s), and only to the
 * provider's own endpoints: the ALTCHA challenge URL exactly, or anything under the Cap site
 * endpoint (challenge, redeem). Everything else is refused - the page is the vendor's code
 * running against a remote service, and the app's network access must not become theirs.
 */
export function allowFetch(input: Pick<CaptchaPageInput, 'provider' | 'siteKey' | 'capApiUrl' | 'instanceApiUrl'>, url: string, method = 'GET'): boolean {
  const m = method.toUpperCase();
  if (m !== 'GET' && m !== 'POST') return false;
  if (!/^https?:\/\//i.test(url)) return false;
  if (input.provider === 'altcha') {
    const target = altchaChallengeUrl(input.instanceApiUrl);
    return url === target || url.startsWith(`${target}?`);
  }
  if (input.provider === 'cap') {
    const base = capEndpoint(input.capApiUrl, input.siteKey);
    if (!base) return false;
    if (!url.startsWith(base)) return false;
    // No climbing out of the site endpoint with dot segments.
    return !/(^|\/)\.\.?(\/|$)/.test(url.slice(base.length));
  }
  return false;
}

/** Parse a message from the page; null for anything that isn't one of ours. */
export function parseCaptchaMessage(data: string): CaptchaMessage | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'ready':
      return { type: 'ready' };
    case 'token':
      return { type: 'token', token: typeof m.token === 'string' ? m.token : '' };
    case 'loadError':
      return { type: 'loadError', detail: typeof m.detail === 'string' ? m.detail : '' };
    case 'height': {
      const h = Number(m.height);
      return Number.isFinite(h) && h > 0 ? { type: 'height', height: Math.ceil(h) } : null;
    }
    case 'fetch': {
      const id = Number(m.id);
      if (!Number.isInteger(id) || typeof m.url !== 'string') return null;
      const headers: Record<string, string> = {};
      if (m.headers && typeof m.headers === 'object') {
        for (const [k, v] of Object.entries(m.headers as Record<string, unknown>)) {
          if (typeof v === 'string') headers[k] = v;
        }
      }
      return {
        type: 'fetch',
        id,
        url: m.url,
        method: typeof m.method === 'string' ? m.method : 'GET',
        headers,
        ...(typeof m.body === 'string' ? { body: m.body } : {}),
      };
    }
    default:
      return null;
  }
}

/** A JS string literal (JSON is valid JS), safe inside an HTML <script>. */
function js(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

/** A CSS colour from the theme; anything that isn't one is dropped (the vendor default stays). */
function cssColor(c: string): string {
  return /^(#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\)|hsla?\([\d.,\s%deg]+\))$/i.test(c.trim()) ? c.trim() : 'inherit';
}

/** The script injected to answer a fetch the page asked for. */
export function fetchResultScript(id: number, status: number, contentType: string, body: string): string {
  return `window.__strafeFetchResult && window.__strafeFetchResult(${Math.trunc(id)}, ${Math.trunc(status)}, ${js(contentType)}, ${js(body)}); true;`;
}

/** The script injected to re-arm the widget after a failed submit (tokens are single-use). */
export const RESET_SCRIPT = 'window.__strafeCaptchaReset && window.__strafeCaptchaReset(); true;';

/**
 * The bridge every page shares: post(), the fetch proxy, height reporting, error capture.
 * Inline in each page, before the vendor script.
 */
function bridgeScript(): string {
  return `
(function () {
  var rn = window.ReactNativeWebView;
  function post(m) { try { rn && rn.postMessage(JSON.stringify(m)); } catch (e) {} }
  window.__strafePost = post;

  var seq = 0, pending = {};
  window.__strafeFetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || String(input);
    try { url = new URL(url, location.href).href; } catch (e) {}
    init = init || {};
    var headers = {};
    var h = init.headers;
    if (h) {
      if (typeof h.forEach === 'function') h.forEach(function (v, k) { headers[k] = String(v); });
      else if (Array.isArray(h)) h.forEach(function (p) { headers[p[0]] = String(p[1]); });
      else Object.keys(h).forEach(function (k) { headers[k] = String(h[k]); });
    }
    var body = typeof init.body === 'string' ? init.body : undefined;
    var id = ++seq;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      post({ type: 'fetch', id: id, url: url, method: init.method || 'GET', headers: headers, body: body });
    });
  };
  window.__strafeFetchResult = function (id, status, contentType, body) {
    var p = pending[id];
    if (!p) return;
    delete pending[id];
    if (status === 0) { p.reject(new TypeError('Failed to fetch')); return; }
    p.resolve(new Response(body, { status: status, headers: { 'content-type': contentType || 'application/json' } }));
  };

  var lastHeight = 0;
  function measure() {
    var root = document.getElementById('root');
    if (!root) return;
    var h = Math.ceil(root.getBoundingClientRect().height);
    if (h > 0 && Math.abs(h - lastHeight) > 1) { lastHeight = h; post({ type: 'height', height: h }); }
  }
  window.__strafeMeasure = measure;
  if (typeof ResizeObserver === 'function') {
    document.addEventListener('DOMContentLoaded', function () {
      new ResizeObserver(measure).observe(document.getElementById('root'));
    });
  }
  setInterval(measure, 500);

  window.__strafeLoadError = function (detail) { post({ type: 'loadError', detail: String(detail || '') }); };
})();`;
}

function styles(p: CaptchaPalette): string {
  const bg = cssColor(p.background);
  const fg = cssColor(p.foreground);
  const border = cssColor(p.border);
  const primary = cssColor(p.primary);
  const onPrimary = cssColor(p.primaryForeground);
  const danger = cssColor(p.destructive);
  const success = cssColor(p.success);
  const muted = cssColor(p.muted);
  const r = Math.max(0, Math.round(p.radius));
  return `
:root { color-scheme: ${p.dark ? 'dark' : 'light'}; }
html, body { margin: 0; padding: 0; background: transparent; color: ${fg};
  font-family: -apple-system, system-ui, Roboto, 'Segoe UI', sans-serif; -webkit-text-size-adjust: 100%; }
#root { display: flex; justify-content: center; align-items: center; padding: 2px 0; min-height: 70px; }
altcha-widget { display: block; width: 100%; max-width: 360px;
  --altcha-max-width: 100%;
  --altcha-color-base: ${bg};
  --altcha-color-base-content: ${fg};
  --altcha-color-neutral: ${muted};
  --altcha-color-primary: ${primary};
  --altcha-color-primary-content: ${onPrimary};
  --altcha-color-error: ${danger};
  --altcha-color-success: ${success};
  --altcha-border-color: ${border};
  --altcha-checkbox-border-color: ${border};
  --altcha-border-radius: ${r}px; }
cap-widget { display: block;
  --cap-widget-width: 100%;
  --cap-background: ${bg};
  --cap-border-color: ${border};
  --cap-border-radius: ${r}px;
  --cap-color: ${fg};
  --cap-checkbox-background: ${bg};
  --cap-checkbox-border: 1px solid ${border};
  --cap-spinner-color: ${primary};
  --cap-spinner-background-color: ${border};
  --cap-focus-ring: ${primary};
  --cap-invalid-border-color: ${danger}; }
cap-widget, .frc-captcha, #turnstile { width: 100%; max-width: 360px; }
`;
}

function providerScript(input: CaptchaPageInput): string {
  const lang = (input.language || 'en').split('-')[0]!.toLowerCase();
  switch (input.provider) {
    case 'altcha':
      return `
(function () {
  var host = document.getElementById('root');
  var widget = document.createElement('altcha-widget');
  host.appendChild(widget);
  function onState(ev) {
    var d = ev.detail || {};
    if (d.state === 'verified') __strafePost({ type: 'token', token: d.payload || '' });
    else if (d.state === 'error' || d.state === 'expired' || d.state === 'unverified') __strafePost({ type: 'token', token: '' });
  }
  widget.addEventListener('statechange', onState);
  customElements.whenDefined('altcha-widget').then(function () {
    return widget.configure({
      challenge: ${js(altchaChallengeUrl(input.instanceApiUrl))},
      fetch: window.__strafeFetch,
      language: ${js(lang)},
      auto: 'onload',
      name: ''
    });
  }).then(function () {
    window.__strafeCaptchaReset = function () { __strafePost({ type: 'token', token: '' }); widget.reset(); };
    __strafePost({ type: 'ready' });
    __strafeMeasure();
  }).catch(function (e) { __strafeLoadError(e && e.message); });
})();`;
    case 'cap': {
      const endpoint = capEndpoint(input.capApiUrl, input.siteKey);
      const s = input.capStrings;
      return `
(function () {
  var endpoint = ${js(endpoint)};
  if (!endpoint) { __strafeLoadError('missing_endpoint'); return; }
  window.CAP_CUSTOM_FETCH = window.__strafeFetch;
  var host = document.getElementById('root');
  var widget = document.createElement('cap-widget');
  widget.setAttribute('data-cap-api-endpoint', endpoint);
  widget.setAttribute('data-cap-i18n-initial-state', ${js(s.initial)});
  widget.setAttribute('data-cap-i18n-verifying-label', ${js(s.verifying)});
  widget.setAttribute('data-cap-i18n-solved-label', ${js(s.solved)});
  widget.setAttribute('data-cap-i18n-error-label', ${js(s.error)});
  widget.setAttribute('data-cap-i18n-verify-aria-label', ${js(s.initial)});
  widget.setAttribute('data-cap-i18n-verifying-aria-label', ${js(s.verifying)});
  widget.setAttribute('data-cap-i18n-verified-aria-label', ${js(s.solved)});
  widget.setAttribute('data-cap-i18n-error-aria-label', ${js(s.error)});
  widget.setAttribute('data-cap-i18n-wasm-disabled', ${js(s.wasmDisabled)});
  widget.addEventListener('solve', function (ev) { __strafePost({ type: 'token', token: (ev.detail && ev.detail.token) || '' }); });
  widget.addEventListener('reset', function () { __strafePost({ type: 'token', token: '' }); });
  widget.addEventListener('error', function (ev) {
    var d = ev.detail || {};
    __strafePost({ type: 'token', token: '' });
    var fatal = d.code === 'network_error' || d.code === 'missing_endpoint' || d.code === 'wasm_load_failed' || d.code === 'worker_spawn_failed';
    if (fatal) __strafeLoadError(d.code);
  });
  host.appendChild(widget);
  window.__strafeCaptchaReset = function () { __strafePost({ type: 'token', token: '' }); widget.reset(); };
  __strafePost({ type: 'ready' });
  __strafeMeasure();
})();`;
    }
    case 'friendly':
      return `
(function () {
  var host = document.getElementById('root');
  var el = document.createElement('div');
  host.appendChild(el);
  var sdk = window.frcaptcha;
  if (!sdk || typeof sdk.createWidget !== 'function') { __strafeLoadError('sdk'); return; }
  var widget;
  try {
    widget = sdk.createWidget({ element: el, sitekey: ${js(input.siteKey)}, formFieldName: null, startMode: 'auto', language: ${js(lang)} });
  } catch (e) { __strafeLoadError(e && e.message); return; }
  el.addEventListener('frc:widget.complete', function (ev) { __strafePost({ type: 'token', token: (ev.detail && ev.detail.response) || '' }); });
  el.addEventListener('frc:widget.expire', function () { __strafePost({ type: 'token', token: '' }); });
  el.addEventListener('frc:widget.error', function () { __strafePost({ type: 'token', token: '' }); });
  window.__strafeCaptchaReset = function () { __strafePost({ type: 'token', token: '' }); widget && widget.reset(); };
  __strafePost({ type: 'ready' });
  __strafeMeasure();
})();`;
    case 'turnstile':
      return `
(function () {
  var widgetId = null;
  window.__strafeTurnstileLoaded = function () {
    if (!window.turnstile) { __strafeLoadError('turnstile'); return; }
    try {
      widgetId = window.turnstile.render('#turnstile', {
        sitekey: ${js(input.siteKey)},
        theme: ${js(input.palette.dark ? 'dark' : 'light')},
        language: ${js(lang)},
        size: 'flexible',
        callback: function (token) { __strafePost({ type: 'token', token: token || '' }); },
        'expired-callback': function () { __strafePost({ type: 'token', token: '' }); },
        'error-callback': function () { __strafePost({ type: 'token', token: '' }); }
      });
    } catch (e) { __strafeLoadError(e && e.message); return; }
    window.__strafeCaptchaReset = function () {
      __strafePost({ type: 'token', token: '' });
      if (widgetId !== null && window.turnstile) window.turnstile.reset(widgetId);
    };
    __strafePost({ type: 'ready' });
    __strafeMeasure();
  };
})();`;
  }
}

/** The page for one provider. */
export function buildCaptchaPage(input: CaptchaPageInput): string {
  const vendor =
    input.provider === 'altcha'
      ? `<script>${ALTCHA_SCRIPT}</script>`
      : input.provider === 'cap'
        ? `<script>${CAP_SCRIPT}</script>`
        : input.provider === 'friendly'
          ? `<script>${FRIENDLY_SCRIPT}</script>`
          : '';
  const body = input.provider === 'turnstile' ? '<div id="root"><div id="turnstile"></div></div>' : '<div id="root"></div>';
  // Turnstile's script is Cloudflare's own; it calls back once it has loaded, and onerror
  // reports a blocked or unreachable script as a load failure (the web's onLoadError).
  const turnstileTag =
    input.provider === 'turnstile'
      ? `<script src="${TURNSTILE_SCRIPT_SRC}&onload=__strafeTurnstileLoaded" async defer onerror="__strafeLoadError('script')"></script>`
      : '';
  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">',
    `<style>${styles(input.palette)}</style>`,
    `<script>${bridgeScript()}</script>`,
    '</head><body>',
    body,
    vendor,
    `<script>${providerScript(input)}</script>`,
    turnstileTag,
    '</body></html>',
  ].join('');
}
