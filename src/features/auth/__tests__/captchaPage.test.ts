/**
 * @jest-environment node
 *
 * The captcha pages: what the app lets them fetch, how their messages are read, and - run in
 * jsdom with the real bundled widgets - that each page comes up and talks to the app the way
 * CaptchaWebView expects.
 */
import { JSDOM, VirtualConsole } from 'jsdom';
import {
  RESET_SCRIPT,
  allowFetch,
  altchaChallengeUrl,
  buildCaptchaPage,
  capEndpoint,
  fetchResultScript,
  isKnownProvider,
  parseCaptchaMessage,
  type CaptchaMessage,
  type CaptchaPageInput,
} from '../captcha/captchaPage';

const palette = {
  dark: true,
  background: '#101114',
  foreground: '#f3f5f7',
  muted: '#26282c',
  border: '#2f3237',
  primary: '#509b6b',
  primaryForeground: '#f5f9f7',
  destructive: '#a63030',
  success: '#3ba55d',
  radius: 10,
};

const capStrings = { initial: "I'm a human", verifying: 'Verifying…', solved: 'Verified', error: 'Verification failed', wasmDisabled: 'WASM' };

function input(over: Partial<CaptchaPageInput>): CaptchaPageInput {
  return {
    provider: 'altcha',
    siteKey: '',
    instanceApiUrl: 'https://chat.example.org/api',
    language: 'pt-BR',
    palette,
    capStrings,
    ...over,
  };
}

/** Load a page in jsdom with a ReactNativeWebView that records what the page posts. */
async function load(html: string, url: string, before?: (w: Window & Record<string, unknown>) => void) {
  const posted: CaptchaMessage[] = [];
  const dom = new JSDOM(html, {
    url,
    runScripts: 'dangerously',
    // The vendor widgets log their own retries (no network here); keep the output readable.
    virtualConsole: new VirtualConsole(),
    beforeParse(window) {
      const w = window as unknown as Window & Record<string, unknown>;
      w.ReactNativeWebView = { postMessage: (s: string) => posted.push(parseCaptchaMessage(s)!) };
      // jsdom has no Response; the page only builds one for proxied fetches.
      w.Response = Response;
      // Nothing in these tests reaches a network (Cap prefetches its wasm at load).
      w.fetch = () => Promise.reject(new TypeError('Failed to fetch'));
      // jsdom lacks blob URLs (Cap's worker pool makes one when it connects).
      (w.URL as unknown as Record<string, unknown>).createObjectURL = () => 'blob:test';
      (w.URL as unknown as Record<string, unknown>).revokeObjectURL = () => undefined;
      // ...and Workers, which the widgets spawn ahead of solving; a WebView has both.
      w.Worker = class {
        postMessage() {}
        terminate() {}
        addEventListener() {}
        removeEventListener() {}
      };
      // The app gives these pages an https origin; jsdom does not count a URL as secure.
      Object.defineProperty(w, 'isSecureContext', { value: true });
      // The page polls its height every 500 ms; not needed here, and it would hold jest open.
      w.setInterval = (() => 0) as unknown as typeof setInterval;
      w.ResizeObserver = class {
        observe() {}
        disconnect() {}
      };
      before?.(w);
    },
  });
  open.push(dom);
  await new Promise((r) => setTimeout(r, 50));
  return { dom, posted, window: dom.window as unknown as Window & Record<string, unknown> };
}

// ALTCHA's window stays open: closing it tears its Svelte component down asynchronously,
// after the window is gone, which throws into whatever runs next. The others are closed so
// their retry timers (no network here) do not hold jest open.
const open: JSDOM[] = [];
afterAll(() => {
  for (const d of open.splice(0)) {
    if (!d.window.document.querySelector('altcha-widget')) d.window.close();
  }
});

async function until(fn: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('fetch allow-list', () => {
  test('ALTCHA may only fetch its challenge', () => {
    const i = input({ provider: 'altcha' });
    expect(altchaChallengeUrl('https://chat.example.org/api/')).toBe('https://chat.example.org/api/auth/captcha/challenge');
    expect(allowFetch(i, 'https://chat.example.org/api/auth/captcha/challenge')).toBe(true);
    expect(allowFetch(i, 'https://chat.example.org/api/auth/captcha/challenge?x=1')).toBe(true);
    expect(allowFetch(i, 'https://chat.example.org/api/users/@me')).toBe(false);
    expect(allowFetch(i, 'https://evil.example/auth/captcha/challenge')).toBe(false);
    expect(allowFetch(i, 'https://chat.example.org/api/auth/captcha/challenge', 'DELETE')).toBe(false);
    expect(allowFetch(i, 'file:///etc/passwd')).toBe(false);
  });

  test('Cap may only reach its own site endpoint', () => {
    const i = input({ provider: 'cap', siteKey: '/abc123/', capApiUrl: 'https://chat.example.org/cap/' });
    expect(capEndpoint(i.capApiUrl, i.siteKey)).toBe('https://chat.example.org/cap/abc123/');
    expect(allowFetch(i, 'https://chat.example.org/cap/abc123/challenge', 'POST')).toBe(true);
    expect(allowFetch(i, 'https://chat.example.org/cap/abc123/redeem', 'POST')).toBe(true);
    expect(allowFetch(i, 'https://chat.example.org/cap/abc123/../admin', 'POST')).toBe(false);
    expect(allowFetch(i, 'https://chat.example.org/cap/other/challenge', 'POST')).toBe(false);
    expect(capEndpoint('', 'k')).toBeNull();
    expect(capEndpoint('ftp://x', 'k')).toBeNull();
  });

  test('Friendly and Turnstile fetch nothing through the app', () => {
    expect(allowFetch(input({ provider: 'friendly', siteKey: 'k' }), 'https://chat.example.org/api/auth/captcha/challenge')).toBe(false);
    expect(allowFetch(input({ provider: 'turnstile', siteKey: 'k' }), 'https://challenges.cloudflare.com/x')).toBe(false);
  });
});

describe('messages', () => {
  test('parses the page protocol and rejects anything else', () => {
    expect(parseCaptchaMessage('{"type":"token","token":"abc"}')).toEqual({ type: 'token', token: 'abc' });
    expect(parseCaptchaMessage('{"type":"token"}')).toEqual({ type: 'token', token: '' });
    expect(parseCaptchaMessage('{"type":"height","height":81.2}')).toEqual({ type: 'height', height: 82 });
    expect(parseCaptchaMessage('{"type":"height","height":-1}')).toBeNull();
    expect(parseCaptchaMessage('{"type":"fetch","id":3,"url":"https://x","method":"POST","headers":{"a":"b","n":1},"body":"{}"}')).toEqual({
      type: 'fetch',
      id: 3,
      url: 'https://x',
      method: 'POST',
      headers: { a: 'b' },
      body: '{}',
    });
    expect(parseCaptchaMessage('{"type":"navigate"}')).toBeNull();
    expect(parseCaptchaMessage('nope')).toBeNull();
  });

  test('injected answers cannot break out of their string', () => {
    const s = fetchResultScript(1, 200, 'application/json', '</script><script>alert(1)</script>');
    expect(s).not.toContain('</script>');
    expect(s.startsWith('window.__strafeFetchResult')).toBe(true);
    expect(RESET_SCRIPT).toContain('__strafeCaptchaReset');
  });

  test('providers', () => {
    expect(isKnownProvider('altcha')).toBe(true);
    expect(isKnownProvider('hcaptcha')).toBe(false);
  });
});

describe('pages (jsdom, real widgets)', () => {
  jest.setTimeout(15000);

  test('ALTCHA: comes up, asks the app for its challenge, and gets the answer back', async () => {
    const html = buildCaptchaPage(input({ provider: 'altcha' }));
    expect(html).toContain('altcha-widget');
    expect(html).toContain('--altcha-color-primary: #509b6b');
    const { posted, window } = await load(html, 'https://captcha.strafe.invalid/');
    await until(() => posted.some((m) => m.type === 'ready'));
    expect(typeof window.__strafeCaptchaReset).toBe('function');
    // auto: 'onload' starts a verification, whose first step is the challenge request.
    await until(() => posted.some((m) => m.type === 'fetch'));
    const req = posted.find((m) => m.type === 'fetch')!;
    expect(req.url).toBe('https://chat.example.org/api/auth/captcha/challenge');
    expect(allowFetch(input({ provider: 'altcha' }), req.url!, req.method)).toBe(true);
    // The app's answer resolves the page's fetch (a refusal comes back as a network error).
    const proxy = (window.__strafeFetch as (u: string) => Promise<Response>)('https://chat.example.org/x');
    const next = posted.filter((m) => m.type === 'fetch').at(-1)!;
    (window.eval as (code: string) => unknown)(fetchResultScript(next.id!, 200, 'application/json', '{"ok":true}'));
    await expect((await proxy).json()).resolves.toEqual({ ok: true });
    const refused = (window.__strafeFetch as (u: string) => Promise<Response>)('https://chat.example.org/y');
    (window.eval as (code: string) => unknown)(fetchResultScript(posted.filter((m) => m.type === 'fetch').at(-1)!.id!, 0, '', ''));
    await expect(refused).rejects.toThrow('Failed to fetch');
  });

  test('Cap: comes up with the site endpoint and its translated labels', async () => {
    const html = buildCaptchaPage(input({ provider: 'cap', siteKey: 'abc', capApiUrl: 'https://chat.example.org/cap' }));
    const { posted, window } = await load(html, 'https://captcha.strafe.invalid/');
    await until(() => posted.some((m) => m.type === 'ready'));
    const el = window.document.querySelector('cap-widget')!;
    expect(el.getAttribute('data-cap-api-endpoint')).toBe('https://chat.example.org/cap/abc/');
    expect(el.getAttribute('data-cap-i18n-initial-state')).toBe("I'm a human");
    expect(window.CAP_CUSTOM_FETCH).toBe(window.__strafeFetch);
  });

  test('Cap without an endpoint is a load error', async () => {
    const { posted, window } = await load(buildCaptchaPage(input({ provider: 'cap', siteKey: '', capApiUrl: '' })), 'https://captcha.strafe.invalid/');
    await until(() => posted.some((m) => m.type === 'loadError'));
    expect(posted.find((m) => m.type === 'loadError')!.detail).toBe('missing_endpoint');
  });

  test('Friendly Captcha: the bundled SDK creates the widget', async () => {
    const html = buildCaptchaPage(input({ provider: 'friendly', siteKey: 'FCMSITEKEY' }));
    const { posted, window } = await load(html, 'https://chat.example.org/');
    await until(() => posted.some((m) => m.type === 'ready' || m.type === 'loadError'));
    expect(posted.find((m) => m.type === 'loadError')).toBeUndefined();
    expect(window.frcaptcha).toBeDefined();
  });

  test("Turnstile: renders once Cloudflare's script calls back, and relays its token", async () => {
    const html = buildCaptchaPage(input({ provider: 'turnstile', siteKey: '0xKEY', palette: { ...palette, dark: false } }));
    expect(html).toContain('https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=__strafeTurnstileLoaded');
    const { posted, window } = await load(html, 'https://chat.example.org/');
    let options: Record<string, unknown> = {};
    window.turnstile = {
      render: (_el: unknown, o: Record<string, unknown>) => {
        options = o;
        return 'w1';
      },
      reset: jest.fn(),
    };
    (window.__strafeTurnstileLoaded as () => void)();
    expect(options.sitekey).toBe('0xKEY');
    expect(options.theme).toBe('light');
    expect(posted.some((m) => m.type === 'ready')).toBe(true);
    (options.callback as (t: string) => void)('tok');
    expect(posted.at(-1)).toEqual({ type: 'token', token: 'tok' });
    (options['expired-callback'] as () => void)();
    expect(posted.at(-1)).toEqual({ type: 'token', token: '' });
    (window.__strafeCaptchaReset as () => void)();
    expect((window.turnstile as { reset: jest.Mock }).reset).toHaveBeenCalledWith('w1');
  });
});
