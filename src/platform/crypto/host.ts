/**
 * The E2EE engine's home: a hidden WebView running matrix-sdk-crypto-wasm.
 *
 * Hermes cannot run WebAssembly, and the web client's encryption is the audited Rust
 * implementation (vodozemac) compiled to WASM. Rather than a different crypto library with
 * a different store - and different bugs - the app runs that same WASM build inside a
 * WebView and talks to it over postMessage; see ./README.md for the protocol.
 *
 * This file is the RN-side client: the WebView component (CryptoHost.tsx) attaches a
 * transport and feeds it the page's messages; the facade (matrixSdkCrypto.ts) and the
 * machine/keyBackup overrides call through `cryptoHost`. It owns the boot (wipe, wasm,
 * ready gate), request/response correlation, timeouts and crash handling, and knows nothing
 * about React - the engine integration test drives it over an in-memory channel.
 */
import { appStorage } from '../storage';
import {
  CryptoHostCrashedError,
  CryptoHostRestartedError,
  CryptoHostTimeoutError,
  CryptoHostUnavailableError,
  fromWireError,
} from './errors';
import {
  PROTOCOL_VERSION,
  servedBeforeEngine,
  type EngineInfo,
  type FromHostMessage,
  type HostMethod,
  type ParamsOf,
  type ResultOf,
  type ToHostMessage,
} from './protocol';

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

// ---- client -----------------------------------------------------------------------------------

export interface HostTransport {
  /** Deliver one message to the page. */
  post(message: string): void;
}

export interface HostBoot {
  /** The engine wasm, base64. Read per boot rather than kept: it is ~10 MB of string. */
  loadWasmBase64(): Promise<string>;
  /** Whether to wipe the page's storage before anything opens it (takeCryptoStorageWipe). */
  takeWipe(): boolean;
  /** Put a wipe request back when the wipe did not happen (scheduleCryptoStorageWipe). */
  restoreWipe(): void;
}

export interface CallOptions {
  timeoutMs?: number;
  /** Progress events of this call (key imports): the page's numbers, as sent. */
  onProgress?: (...args: number[]) => void;
  /**
   * The host generation a machine handle belongs to. A call bound to an older generation is
   * rejected with CryptoHostRestartedError instead of reaching a page that never heard of it.
   */
  generation?: number;
}

export type HostState = 'detached' | 'loading' | 'booting' | 'ready' | 'failed';

interface Pending {
  method: HostMethod;
  resolve(value: unknown): void;
  reject(err: Error): void;
  onProgress?: (...args: number[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Queued {
  method: HostMethod;
  params: unknown;
  opts: CallOptions;
  resolve(value: unknown): void;
  reject(err: Error): void;
  /** Bounds the wait for a page that never comes up (not mounted, stuck loading). */
  waitTimer?: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
/** Calls that legitimately run long: store opens, PBKDF2, imports of a whole backup. */
const METHOD_TIMEOUT_MS: Partial<Record<HostMethod, number>> = {
  'host.wipeStorage': 60_000,
  'host.wasmFinish': 120_000,
  'store.delete': 60_000,
  'machine.initialize': 120_000,
  'machine.decryptRoomEvents': 60_000,
  'machine.receiveSyncChanges': 60_000,
  'machine.shareRoomKey': 60_000,
  'machine.importExportedRoomKeys': 600_000,
  'backup.prepare': 120_000,
  'backup.restoreOpen': 120_000,
  'backup.restoreAddPage': 120_000,
  'backup.restoreImport': 600_000,
};

/** How long a call may wait for the host to come up before it is sent at all. */
const QUEUE_TIMEOUT_MS = 120_000;

/** base64 characters per wasm slice; a multiple of 4 so each slice decodes on its own. */
const WASM_CHUNK_CHARS = 1 << 20;

/** More crashes than this inside CRASH_WINDOW_MS and the host stops restarting itself. */
const MAX_CRASHES = 4;
const CRASH_WINDOW_MS = 120_000;

export class CryptoHostClient {
  private transport: HostTransport | null = null;
  private boot: HostBoot | null = null;
  private _state: HostState = 'detached';
  private _generation = 0;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private queue: Queued[] = [];
  private readyWaiters: { resolve(): void; reject(e: Error): void }[] = [];
  private failure: Error | null = null;
  private crashes: number[] = [];
  private restartListeners = new Set<() => void>();
  private stateListeners = new Set<(state: HostState) => void>();
  private _engine: EngineInfo | null = null;
  /** A page has said hello and not died since: its end must invalidate machine handles. */
  private pageAlive = false;

  get state(): HostState {
    return this._state;
  }

  /** Increments every time a page life ends; machine handles are only valid within one. */
  get generation(): number {
    return this._generation;
  }

  /** Engine versions and defaults, once ready. */
  get engine(): EngineInfo | null {
    return this._engine;
  }

  /**
   * A page (WebView) is mounted and will send `hello`. Called by CryptoHost.tsx on every
   * mount; returns the detach for its unmount.
   */
  attach(transport: HostTransport, boot: HostBoot): () => void {
    if (this.transport) this.endPageLife('replaced by a new host');
    this.transport = transport;
    this.boot = boot;
    if (this._state !== 'failed') this.setState('loading');
    return () => {
      if (this.transport !== transport) return;
      this.transport = null;
      this.boot = null;
      // Detached first, so restart listeners see that no page is coming back.
      if (this._state !== 'failed') this.setState('detached');
      this.endPageLife('host unmounted');
    };
  }

  /** One message from the page. */
  receive(raw: string): void {
    let msg: FromHostMessage;
    try {
      msg = JSON.parse(raw) as FromHostMessage;
    } catch {
      return;
    }
    switch (msg?.t) {
      case 'hello':
        this.onHello(msg.protocol);
        return;
      case 'result': {
        const p = this.pending.get(msg.id);
        if (!p) return; // timed out, or from a page life that already ended
        this.pending.delete(msg.id);
        clearTimeout(p.timer);
        if (msg.ok) p.resolve(msg.value);
        else p.reject(fromWireError(msg.error));
        return;
      }
      case 'progress':
        this.pending.get(msg.id)?.onProgress?.(...msg.args);
        return;
      case 'log':
        (msg.level === 'error' ? console.error : console.warn)('[crypto-host]', msg.message);
        return;
    }
  }

  /**
   * The WebView's process died. Fails everything in flight and reports whether the component
   * should mount a fresh WebView (false once it keeps crashing - see MAX_CRASHES).
   */
  crashed(reason: string): boolean {
    this.endPageLife(reason);
    const now = Date.now();
    this.crashes = this.crashes.filter((t) => now - t < CRASH_WINDOW_MS);
    this.crashes.push(now);
    if (this.crashes.length > MAX_CRASHES) {
      this.fail(new CryptoHostUnavailableError(`the crypto host crashed ${this.crashes.length} times in two minutes (${reason})`));
      return false;
    }
    this.setState('loading');
    return true;
  }

  /** Resolves once the engine is loaded; rejects if the host failed. */
  whenReady(): Promise<void> {
    if (this._state === 'ready') return Promise.resolve();
    if (this._state === 'failed') return Promise.reject(this.failure);
    return new Promise((resolve, reject) => this.readyWaiters.push({ resolve, reject }));
  }

  /** Subscribe to page restarts (crash, reload, remount). Every machine handle is gone by then. */
  onRestart(listener: () => void): () => void {
    this.restartListeners.add(listener);
    return () => this.restartListeners.delete(listener);
  }

  onStateChange(listener: (state: HostState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /**
   * Call the page. Engine methods wait for the boot to finish; housekeeping (host.*, store.*)
   * goes as soon as the page has said hello.
   */
  call<K extends HostMethod>(method: K, params: ParamsOf<K>, opts: CallOptions = {}): Promise<ResultOf<K>> {
    return new Promise<ResultOf<K>>((resolve, reject) => {
      if (this._state === 'failed') {
        reject(this.failure ?? new CryptoHostUnavailableError('failed'));
        return;
      }
      if (opts.generation !== undefined && opts.generation !== this._generation) {
        reject(new CryptoHostRestartedError());
        return;
      }
      const item: Queued = { method, params, opts, resolve: resolve as (v: unknown) => void, reject };
      if (this.canSend(method)) this.send(item);
      else this.enqueue(item);
    });
  }

  // ---- internals -----------------------------------------------------------------------------

  private canSend(method: HostMethod): boolean {
    if (!this.transport) return false;
    if (this._state === 'ready') return true;
    return this._state === 'booting' && servedBeforeEngine(method);
  }

  private enqueue(item: Queued): void {
    item.waitTimer = setTimeout(() => {
      const i = this.queue.indexOf(item);
      if (i < 0) return;
      this.queue.splice(i, 1);
      item.reject(new CryptoHostTimeoutError(`${item.method} (waiting for the host to start)`, QUEUE_TIMEOUT_MS));
    }, QUEUE_TIMEOUT_MS);
    this.queue.push(item);
  }

  private send(item: Queued): void {
    if (item.waitTimer) clearTimeout(item.waitTimer);
    if (item.opts.generation !== undefined && item.opts.generation !== this._generation) {
      item.reject(new CryptoHostRestartedError());
      return;
    }
    const id = this.nextId++;
    const ms = item.opts.timeoutMs ?? METHOD_TIMEOUT_MS[item.method] ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      if (!this.pending.delete(id)) return;
      item.reject(new CryptoHostTimeoutError(item.method, ms));
    }, ms);
    this.pending.set(id, { method: item.method, resolve: item.resolve, reject: item.reject, onProgress: item.opts.onProgress, timer });
    const msg: ToHostMessage = { t: 'call', id, method: item.method, params: item.params };
    if (item.opts.onProgress) msg.progress = true;
    try {
      this.transport!.post(JSON.stringify(msg));
    } catch (e) {
      this.pending.delete(id);
      clearTimeout(timer);
      item.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  private flush(): void {
    const waiting = this.queue;
    this.queue = [];
    for (const item of waiting) {
      if (this.canSend(item.method)) this.send(item);
      else this.queue.push(item); // its wait timer is still running
    }
  }

  private setState(state: HostState): void {
    if (this._state === state) return;
    this._state = state;
    for (const l of [...this.stateListeners]) {
      try {
        l(state);
      } catch (e) {
        console.error('[crypto-host] state listener failed', e);
      }
    }
  }

  private onHello(protocol: number): void {
    if (!this.transport || this._state === 'failed') return;
    // A second hello on a live page means it reloaded under us (WKWebView does this after a
    // content-process termination it handled itself): that page life is over.
    if (this._state === 'booting' || this._state === 'ready') this.endPageLife('page reloaded');
    if (protocol !== PROTOCOL_VERSION) {
      this.fail(new CryptoHostUnavailableError(`page speaks protocol ${protocol}, app ${PROTOCOL_VERSION} - rebuild the crypto host`));
      return;
    }
    this.pageAlive = true;
    this.setState('booting');
    const generation = this._generation;
    void this.runBoot(generation);
  }

  private async runBoot(generation: number): Promise<void> {
    const boot = this.boot!;
    const call = <K extends HostMethod>(m: K, p: ParamsOf<K>) => this.call(m, p, { generation });
    let wiping = false;
    try {
      this.flush(); // housekeeping queued before the page was up
      wiping = boot.takeWipe();
      if (wiping) {
        await call('host.wipeStorage', {});
        wiping = false;
      }
      let b64 = await boot.loadWasmBase64();
      // Some readers wrap base64 at 76 columns; slices must be whitespace-free to line up.
      if (/\s/.test(b64.slice(0, 200))) b64 = b64.replace(/\s+/g, '');
      const total = base64DecodedLength(b64);
      let offset = 0;
      for (let i = 0; i < b64.length; i += WASM_CHUNK_CHARS) {
        const data = b64.slice(i, i + WASM_CHUNK_CHARS);
        await call('host.wasmChunk', { offset, total, data });
        offset += base64DecodedLength(data);
      }
      const info = await call('host.wasmFinish', {});
      if (generation !== this._generation) return;
      this._engine = info;
      this.setState('ready');
      for (const w of this.readyWaiters.splice(0)) w.resolve();
      this.flush();
    } catch (e) {
      if (wiping) boot.restoreWipe();
      // A crash during boot is handled by crashed(); only a page that answered with an error
      // (corrupt wasm, failed digest, no WebCrypto) is a failed host.
      if (generation !== this._generation || e instanceof CryptoHostCrashedError || e instanceof CryptoHostRestartedError) return;
      const err = e instanceof Error ? e : new Error(String(e));
      this.fail(new CryptoHostUnavailableError(`${err.name}: ${err.message}`));
    }
  }

  /** The current page is gone: fail what it was doing and invalidate its handles. */
  private endPageLife(reason: string): void {
    const hadLife = this.pageAlive || this.pending.size > 0;
    this.pageAlive = false;
    this._generation++;
    this._engine = null;
    const inFlight = [...this.pending.values()];
    this.pending.clear();
    for (const p of inFlight) {
      clearTimeout(p.timer);
      p.reject(new CryptoHostCrashedError(reason));
    }
    // Queued calls bound to a machine of the old page can never succeed; unbound ones wait
    // for the next boot.
    const keep: Queued[] = [];
    for (const q of this.queue) {
      if (q.opts.generation === undefined) {
        keep.push(q);
        continue;
      }
      if (q.waitTimer) clearTimeout(q.waitTimer);
      q.reject(new CryptoHostRestartedError());
    }
    this.queue = keep;
    if (this._state === 'booting' || this._state === 'ready') this.setState('loading');
    if (hadLife) {
      for (const l of [...this.restartListeners]) {
        try {
          l();
        } catch (e) {
          console.error('[crypto-host] restart listener failed', e);
        }
      }
    }
  }

  private fail(err: Error): void {
    this.failure = err;
    this.setState('failed');
    for (const w of this.readyWaiters.splice(0)) w.reject(err);
    for (const q of this.queue.splice(0)) {
      if (q.waitTimer) clearTimeout(q.waitTimer);
      q.reject(err);
    }
    console.error('[crypto-host]', err.message);
  }

  /** For tests: forget everything, as a fresh app start would. */
  resetForTests(): void {
    this.transport = null;
    this.boot = null;
    this._state = 'detached';
    this.endPageLife('reset');
    this.failure = null;
    this.crashes = [];
    for (const q of this.queue) if (q.waitTimer) clearTimeout(q.waitTimer);
    this.queue = [];
    this.readyWaiters = [];
    this._state = 'detached';
  }
}

function base64DecodedLength(b64: string): number {
  let pad = 0;
  if (b64.endsWith('==')) pad = 2;
  else if (b64.endsWith('=')) pad = 1;
  return (b64.length / 4) * 3 - pad;
}

/** The app's one crypto host. */
export const cryptoHost = new CryptoHostClient();
