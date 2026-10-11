/**
 * The E2EE engine's home: a hidden WebView running matrix-sdk-crypto-wasm.
 *
 * Hermes cannot run WebAssembly, and the web client's encryption is the audited Rust
 * implementation (vodozemac) compiled to WASM. Rather than a different crypto library with
 * a different store - and different bugs - the app runs that same WASM build inside a
 * WebView and talks to it over postMessage; see ./README.md for the protocol.
 *
 * This file is the RN-side registry: the WebView component (CryptoHost.tsx) registers its
 * sender here, and the proxy (matrixSdkCrypto.ts) sends requests through it.
 */
import { appStorage } from '../storage';

const WIPE_FLAG = 'crypto.wipeOnNextStart';

/** Clear the engine's storage the next time the host starts (before the store opens). */
export function scheduleCryptoStorageWipe(): void {
  appStorage.set(WIPE_FLAG, true);
}

/** Read-and-clear the wipe request; the host component calls this before loading. */
export function takeCryptoStorageWipe(): boolean {
  const pending = appStorage.getBoolean(WIPE_FLAG) === true;
  if (pending) appStorage.remove(WIPE_FLAG);
  return pending;
}
