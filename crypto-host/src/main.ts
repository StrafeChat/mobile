/**
 * Entry point of the crypto host page - the script build.mjs inlines into the HTML the hidden
 * WebView loads (src/platform/crypto/CryptoHost.tsx).
 *
 * The page has no network: its origin (https://e2ee.strafe.invalid) never resolves and its
 * CSP forbids connections. The engine's wasm arrives from the app as base64 slices
 * (`host.wasmChunk`), is checked against the digest the build baked in, and is instantiated
 * from those bytes. Everything else is the RPC server in ./server.ts.
 */
// The wasm-bindgen glue, resolved by build.mjs to the package's pkg/matrix_sdk_crypto_wasm_bg.js.
import * as bindings from 'matrix-sdk-crypto-wasm-bindings';
import { createHostServer } from './server';
import type { Sdk } from './sdk';

declare const __WASM_SHA256__: string;

interface RNWindow {
  ReactNativeWebView?: { postMessage(message: string): void };
}

const bridge = (window as unknown as RNWindow).ReactNativeWebView;

function send(message: string): void {
  bridge?.postMessage(message);
}

const server = createHostServer({
  sdk: bindings as unknown as Sdk,
  send,
  indexedDB: window.indexedDB,
  wasmSha256: __WASM_SHA256__,
  subtle: window.crypto?.subtle,
});

// react-native-webview delivers postMessage() as a MessageEvent on `document` (Android) or
// `window` (iOS). Listening on both is safe: each message arrives on exactly one of them.
function onMessage(ev: Event): void {
  const data = (ev as MessageEvent).data;
  if (typeof data === 'string') server.receive(data);
}
window.addEventListener('message', onMessage);
document.addEventListener('message', onMessage);

// Anything that escapes a call (a wasm panic in a background task) is reported rather than
// lost in a console nobody can open.
function report(level: 'warn' | 'error', message: string): void {
  send(JSON.stringify({ t: 'log', level, message }));
}
window.addEventListener('error', (ev) => report('error', `${ev.message} (${ev.filename}:${ev.lineno})`));
window.addEventListener('unhandledrejection', (ev) => {
  const r = ev.reason as unknown;
  report('error', r instanceof Error ? `${r.name}: ${r.message}` : String(r));
});

// Release the store's connections promptly when the WebView tears the page down normally.
window.addEventListener('pagehide', () => server.dispose());

server.hello();
