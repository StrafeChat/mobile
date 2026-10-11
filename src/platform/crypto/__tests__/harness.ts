/**
 * Test harness: the real crypto host server (crypto-host/src/server.ts) running the real
 * matrix-sdk-crypto-wasm in Node, wired to the app-side client (`cryptoHost`) through an
 * in-memory channel that carries the same JSON strings the WebView bridge would.
 *
 * Needs @matrix-org/matrix-sdk-crypto-wasm installed (or MATRIX_SDK_CRYPTO_WASM_DIR), and
 * fake-indexeddb for the engine's store. Tests that use it run in the `node` environment.
 */
import { createHash, webcrypto } from 'crypto';
import fs from 'fs';
import { createHostServer, type HostServer } from '../../../../crypto-host/src/server';
import type { Sdk } from '../../../../crypto-host/src/sdk';
import { cryptoHost } from '../host';

interface LocatedPackage {
  dir: string;
  version: string;
  bindingsCjs: string;
  wasm: string;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { locateMatrixSdkCryptoWasm } = require('../../../../crypto-host/locatePackage.cjs') as {
  locateMatrixSdkCryptoWasm(): LocatedPackage | null;
};

export function locateEngine(): LocatedPackage {
  const pkg = locateMatrixSdkCryptoWasm();
  if (!pkg) {
    throw new Error(
      '@matrix-org/matrix-sdk-crypto-wasm is not installed; the engine integration tests need it ' +
        '(or MATRIX_SDK_CRYPTO_WASM_DIR pointing at an installed copy)',
    );
  }
  return pkg;
}

/** Node's WebCrypto as `globalThis.crypto`, as the page and the app both have one. */
export function ensureWebCrypto(): void {
  const g = globalThis as { crypto?: Crypto };
  if (!g.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
  }
}

/**
 * A fresh copy of the wasm-bindgen glue: each page life instantiates its own wasm, and the
 * glue caches views of the instance's memory, so two "pages" must not share one module.
 */
export function loadBindings(pkg: LocatedPackage): Sdk {
  let mod: Sdk | undefined;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require(pkg.bindingsCjs) as Sdk;
  });
  return mod!;
}

/**
 * The bridge between `cryptoHost` and whichever page (server) is current. Delivery is
 * asynchronous in both directions, like postMessage. `hold()` stops delivering app->page
 * messages, to simulate a page that dies with calls in flight.
 */
export class Channel {
  server: HostServer | null = null;
  private held = false;
  sent: string[] = [];

  hold(): void {
    this.held = true;
  }

  release(): void {
    this.held = false;
  }

  post = (message: string): void => {
    this.sent.push(message);
    if (this.held) return;
    const server = this.server;
    setTimeout(() => server?.receive(message), 0);
  };

  /** Start a new page: a fresh server on a fresh wasm module, then its hello. */
  startPage(pkg: LocatedPackage, opts: { wasmSha256?: string | null } = {}): HostServer {
    // The previous page is dead: its IndexedDB connections go with it, as a WebView
    // process's do.
    this.server?.dispose();
    const wasm = fs.readFileSync(pkg.wasm);
    const server = createHostServer({
      sdk: loadBindings(pkg),
      send: (m) => setTimeout(() => cryptoHost.receive(m), 0),
      indexedDB: globalThis.indexedDB,
      wasmSha256: opts.wasmSha256 === undefined ? createHash('sha256').update(wasm).digest('hex') : opts.wasmSha256,
      subtle: webcrypto.subtle as unknown as SubtleCrypto,
    });
    this.server = server;
    setTimeout(() => server.hello(), 0);
    return server;
  }
}

/** Attach `cryptoHost` to a channel and boot a page with the real wasm. */
export async function bootEngine(pkg = locateEngine()): Promise<Channel> {
  ensureWebCrypto();
  const channel = new Channel();
  const wasmB64 = fs.readFileSync(pkg.wasm).toString('base64');
  cryptoHost.attach(
    { post: channel.post },
    { loadWasmBase64: async () => wasmB64, takeWipe: () => false, restoreWipe: () => undefined },
  );
  channel.startPage(pkg);
  await cryptoHost.whenReady();
  return channel;
}

/**
 * A miniature of equinox's /devices endpoints, enough for two engines to find each other:
 * key upload, query, one-time-key claim and to-device delivery, all in Matrix's shapes.
 */
export class FakeKeyServer {
  deviceKeys: Record<string, Record<string, unknown>> = {};
  oneTimeKeys: Record<string, Record<string, Record<string, unknown>>> = {};
  inbox: Record<string, { type: string; sender: string; content: unknown }[]> = {};

  upload(userId: string, deviceId: string, body: { device_keys?: unknown; one_time_keys?: Record<string, unknown> }) {
    if (body.device_keys) (this.deviceKeys[userId] ??= {})[deviceId] = body.device_keys;
    const pool = ((this.oneTimeKeys[userId] ??= {})[deviceId] ??= {});
    Object.assign(pool, body.one_time_keys ?? {});
    return { one_time_key_counts: { signed_curve25519: Object.keys(pool).length } };
  }

  query(body: { device_keys: Record<string, string[]> }) {
    const out: Record<string, Record<string, unknown>> = {};
    for (const user of Object.keys(body.device_keys)) out[user] = this.deviceKeys[user] ?? {};
    return { device_keys: out, failures: {} };
  }

  claim(body: { one_time_keys: Record<string, Record<string, string>> }) {
    const out: Record<string, Record<string, Record<string, unknown>>> = {};
    for (const [user, devices] of Object.entries(body.one_time_keys)) {
      for (const device of Object.keys(devices)) {
        const pool = this.oneTimeKeys[user]?.[device] ?? {};
        const keyId = Object.keys(pool)[0];
        if (!keyId) continue;
        ((out[user] ??= {})[device] = { [keyId]: pool[keyId] });
        delete pool[keyId];
      }
    }
    return { one_time_keys: out, failures: {} };
  }

  deliver(sender: string, eventType: string, messages: Record<string, Record<string, unknown>>) {
    for (const [user, devices] of Object.entries(messages)) {
      for (const [device, content] of Object.entries(devices)) {
        (this.inbox[`${user}|${device}`] ??= []).push({ type: eventType, sender, content });
      }
    }
  }

  take(userId: string, deviceId: string) {
    const key = `${userId}|${deviceId}`;
    const events = this.inbox[key] ?? [];
    this.inbox[key] = [];
    return events;
  }

  otkCount(userId: string, deviceId: string): number {
    return Object.keys(this.oneTimeKeys[userId]?.[deviceId] ?? {}).length;
  }
}
