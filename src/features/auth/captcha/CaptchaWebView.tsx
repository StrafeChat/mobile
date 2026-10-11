/**
 * The registration challenge, whichever one the instance runs: the web's CaptchaWidget
 * (web/src/components/auth/CaptchaWidget.tsx) with the same contract - onToken(token) when
 * solved and onToken('') when the token is gone, onReady(reset) so the form can re-arm it after
 * a failed submit, onLoadError() so the form explains instead of hanging - rendered in a
 * WebView, because every provider is browser code (custom elements, workers, WASM, a
 * third-party script).
 *
 * - ALTCHA (default) and Cap run their bundled widgets (./vendor) on a private origin; their
 *   requests go through the app (captchaPage.ts allowFetch), so neither needs CORS for it.
 * - Friendly Captcha and Turnstile have site keys bound to the instance's web hostname, so
 *   their page is given that origin as its base URL - the same origin the web client runs on.
 * - An unknown provider reports a load error at once, as on the web.
 *
 * The WebView sizes itself to the widget, follows the theme, opens any link the widget has
 * (privacy, terms) in the browser instead of navigating, and offers a retry when the widget
 * cannot load.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { apiUrl } from '@web/lib/runtimeConfig';
import { currentLanguage, t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Banner, Skeleton } from '@/ui';
import {
  RESET_SCRIPT,
  allowFetch,
  buildCaptchaPage,
  fetchResultScript,
  isKnownProvider,
  parseCaptchaMessage,
  type CaptchaMessage,
  type CaptchaPageInput,
} from './captchaPage';

export interface CaptchaWebViewProps {
  provider: string;
  siteKey: string;
  /** Cap's server URL (instance.captcha.apiUrl); empty for the other providers. */
  apiUrl?: string;
  onToken: (token: string) => void;
  onReady?: (reset: () => void) => void;
  onLoadError?: () => void;
  testID?: string;
}

/** Private origin for the widgets that need none of their own (requests go through the app). */
export const CAPTCHA_PRIVATE_ORIGIN = 'https://captcha.strafe.invalid';
/** Without a 'ready' by then, the widget is not coming (a blocked script, no network). */
const READY_TIMEOUT_MS = 20_000;
const MIN_HEIGHT = 66;
const MAX_HEIGHT = 520;
/** Response bodies the app hands back to the page are small JSON; anything bigger is refused. */
const MAX_PROXY_BODY = 256 * 1024;

/** The instance's web origin (the window shim derives it from the chosen instance). */
function instanceWebOrigin(): string {
  const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
  return typeof origin === 'string' && /^https?:\/\//.test(origin) ? origin : CAPTCHA_PRIVATE_ORIGIN;
}

export function captchaBaseUrl(provider: string): string {
  return `${provider === 'friendly' || provider === 'turnstile' ? instanceWebOrigin() : CAPTCHA_PRIVATE_ORIGIN}/`;
}

/** Headers a page may set on a proxied request; nothing that could carry a credential. */
const PASS_HEADERS = new Set(['content-type', 'accept', 'accept-language']);

export function CaptchaWebView({ provider, siteKey, apiUrl: capApiUrl, onToken, onReady, onLoadError, testID }: CaptchaWebViewProps) {
  const theme = useTheme();
  const language = useSolid(() => currentLanguage());
  const ref = useRef<WebView>(null);
  const [attempt, setAttempt] = useState(0);
  const [height, setHeight] = useState(74);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  // Callbacks change every render of the form; the page must not be rebuilt for that.
  const cb = useRef({ onToken, onReady, onLoadError });
  cb.current = { onToken, onReady, onLoadError };

  const known = isKnownProvider(provider);

  const input = useMemo<CaptchaPageInput | null>(() => {
    if (!isKnownProvider(provider)) return null;
    const c = theme.colors;
    return {
      provider,
      siteKey,
      capApiUrl,
      instanceApiUrl: apiUrl(),
      language,
      palette: {
        dark: theme.dark,
        background: c.background,
        foreground: c.foreground,
        muted: c.muted,
        border: c.border,
        primary: c.primary,
        primaryForeground: c.primaryForeground,
        destructive: c.destructive,
        success: c.success,
        radius: theme.radii.md,
      },
      capStrings: {
        initial: t('auth.captcha.cap.initial'),
        verifying: t('auth.captcha.cap.verifying'),
        solved: t('auth.captcha.cap.solved'),
        error: t('auth.captcha.cap.error'),
        wasmDisabled: t('auth.captcha.cap.wasmDisabled'),
      },
    };
    // The palette is rebuilt when the theme object changes (appearance settings).
  }, [provider, siteKey, capApiUrl, language, theme]);

  const html = useMemo(() => (input ? buildCaptchaPage(input) : ''), [input]);
  const baseUrl = captchaBaseUrl(provider);

  // An unknown provider can never render: say so once, as the web's UnknownProvider does.
  useEffect(() => {
    if (!known) cb.current.onLoadError?.();
  }, [known]);

  const fail = useCallback(() => {
    setFailed(true);
    cb.current.onToken('');
    cb.current.onLoadError?.();
  }, []);

  // A page that never says it is ready (script blocked, offline) counts as a load failure.
  useEffect(() => {
    if (!known || ready || failed) return;
    const timer = setTimeout(fail, READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [known, ready, failed, attempt, fail]);

  const inject = (script: string) => ref.current?.injectJavaScript(script);

  async function proxyFetch(msg: CaptchaMessage) {
    const id = msg.id!;
    if (!input || !msg.url || !allowFetch(input, msg.url, msg.method)) {
      inject(fetchResultScript(id, 0, '', ''));
      return;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(msg.headers ?? {})) if (PASS_HEADERS.has(k.toLowerCase())) headers[k] = v;
    try {
      const res = await fetch(msg.url, { method: (msg.method ?? 'GET').toUpperCase(), headers, body: msg.body });
      const text = await res.text();
      if (text.length > MAX_PROXY_BODY) throw new Error('response too large');
      inject(fetchResultScript(id, res.status, res.headers.get('content-type') ?? '', text));
    } catch {
      inject(fetchResultScript(id, 0, '', ''));
    }
  }

  const onMessage = (ev: WebViewMessageEvent) => {
    // Only our page speaks the protocol (Android exposes the bridge to the widgets' frames too).
    const from = ev.nativeEvent.url;
    if (from && from !== 'about:blank' && !from.startsWith(baseUrl) && `${from}/` !== baseUrl) return;
    const msg = parseCaptchaMessage(ev.nativeEvent.data);
    if (!msg) return;
    switch (msg.type) {
      case 'ready':
        setReady(true);
        setFailed(false);
        cb.current.onReady?.(() => inject(RESET_SCRIPT));
        break;
      case 'token':
        cb.current.onToken(msg.token ?? '');
        break;
      case 'loadError':
        fail();
        break;
      case 'height':
        setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, msg.height ?? MIN_HEIGHT)));
        break;
      case 'fetch':
        void proxyFetch(msg);
        break;
    }
  };

  // The page never navigates. A link the widget shows (privacy, terms, the vendor's site)
  // opens in the browser; the widgets' own frames (Turnstile's challenge iframe) load.
  const onShouldStartLoadWithRequest = (req: ShouldStartLoadRequest) => {
    const url = req.url ?? '';
    if (url === 'about:blank' || url.startsWith('data:') || url.startsWith('blob:')) return true;
    if (url.startsWith(baseUrl) || `${url}/` === baseUrl) return true;
    if (req.isTopFrame === false) return true;
    if (/^https?:\/\//i.test(url)) void Linking.openURL(url).catch(() => undefined);
    return false;
  };

  const retry = () => {
    setFailed(false);
    setReady(false);
    setAttempt((n) => n + 1);
  };

  if (!known) return null;

  return (
    <View testID={testID} style={{ alignSelf: 'stretch', gap: 8 }}>
      {failed ? (
        <Banner
          tone="error"
          message={t('auth.register.captchaUnavailable')}
          action={{ label: t('common.retry'), onPress: retry }}
          testID={testID ? `${testID}-failed` : undefined}
        />
      ) : (
        <View style={{ height, alignSelf: 'stretch', borderRadius: theme.radii.md, overflow: 'hidden' }}>
          <WebView
            key={attempt}
            ref={ref}
            source={{ html, baseUrl }}
            originWhitelist={['*']}
            onMessage={onMessage}
            onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
            setSupportMultipleWindows={false}
            javaScriptEnabled
            domStorageEnabled
            allowFileAccess={false}
            allowsLinkPreview={false}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            showsVerticalScrollIndicator={false}
            showsHorizontalScrollIndicator={false}
            automaticallyAdjustContentInsets={false}
              webviewDebuggingEnabled={__DEV__}
            onError={fail}
            onHttpError={(e) => {
              // Only the page itself failing matters; the widgets' own requests report through it.
              if (e.nativeEvent.url === baseUrl) fail();
            }}
            onContentProcessDidTerminate={retry}
            onRenderProcessGone={() => {
              retry();
              return true;
            }}
            style={{ backgroundColor: 'transparent', opacity: ready ? 1 : 0 }}
            containerStyle={{ backgroundColor: 'transparent' }}
          />
          {!ready ? (
            <View
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center' }}
              pointerEvents="none"
              accessibilityLabel={t('common.loading')}
              accessibilityRole="progressbar"
            >
              <Skeleton height={Math.max(40, height - 8)} radius={theme.radii.md} />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}
