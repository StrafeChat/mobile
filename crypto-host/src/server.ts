/**
 * The crypto host's RPC server: owns the engine, its OlmMachines (by handle) and the backup
 * sessions, and answers the app's calls. Environment-agnostic - the page (./main.ts) gives it
 * postMessage and the page's IndexedDB; the integration test gives it an in-memory channel,
 * fake-indexeddb and the same wasm.
 *
 * What it guarantees the app:
 * - every engine result crosses as a snapshot (protocol.ts), never as a wasm handle;
 * - every exception crosses with its name and message verbatim;
 * - one machine per store: opening a store closes whatever machine still holds it.
 */
import {
  PROTOCOL_VERSION,
  servedBeforeEngine,
  toWireError,
  type CallMessage,
  type EngineInfo,
  type FromHostMessage,
  type HostMethod,
  type ParamsOf,
  type ResultOf,
  type WireCollectStrategy,
  type WireDecryptedRoomEvent,
  type WireDevice,
  type WireEncryptionSettings,
  type WireImportResult,
  type WireProcessedToDeviceEvent,
  type WireRequest,
  type WireShieldState,
} from '../../src/platform/crypto/protocol';
import { BackupFlows, NamedError, safeFree } from './backup';
import type {
  Sdk,
  SdkCollectStrategy,
  SdkDecryptedRoomEvent,
  SdkDevice,
  SdkImportResult,
  SdkOlmMachine,
  SdkProcessedToDeviceEvent,
  SdkRequest,
  SdkShieldState,
  SdkUserId,
} from './sdk';
import * as storage from './storage';

export interface HostServerOptions {
  /** The wasm-bindgen glue module; also the wasm instance's import object. */
  sdk: Sdk;
  /** Deliver one message to the app. */
  send(message: string): void;
  indexedDB: IDBFactory;
  /** SHA-256 (hex) the assembled .wasm must have; null skips the check. */
  wasmSha256: string | null;
  subtle?: SubtleCrypto;
}

export interface HostServer {
  /** Handle one message from the app. */
  receive(raw: string): void;
  /** Announce the page; the app starts the boot when it sees this. */
  hello(): void;
  /** Close every machine and backup session (page unload; a test's dead page). */
  dispose(): void;
}

interface OpenMachine {
  machine: SdkOlmMachine;
  storeName?: string;
}

type Handler<K extends HostMethod> = (params: ParamsOf<K>, progress: (...args: number[]) => void) => Promise<ResultOf<K>>;

export function createHostServer(opts: HostServerOptions): HostServer {
  const { sdk } = opts;
  const idb = opts.indexedDB;
  const backup = new BackupFlows(sdk);

  let engine: EngineInfo | null = null;
  let engineLoading: Promise<EngineInfo> | null = null;
  let wasm: Uint8Array<ArrayBuffer> | null = null;
  let wasmReceived = 0;

  const machines = new Map<number, OpenMachine>();
  const storeOwner = new Map<string, number>();
  let nextHandle = 1;

  // ---- plumbing -------------------------------------------------------------------------------

  function post(message: FromHostMessage): void {
    opts.send(JSON.stringify(message));
  }

  /**
   * Opening, closing and deleting a store are serialised per store, so two opens racing
   * (a stale reopen and a fresh one) can never leave two machines on one store.
   */
  const storeLocks = new Map<string, Promise<unknown>>();
  function withStoreLock<T>(storeName: string | undefined, fn: () => Promise<T>): Promise<T> {
    if (!storeName) return fn();
    const prev = storeLocks.get(storeName) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const tail = next.catch(() => undefined);
    storeLocks.set(storeName, tail);
    void tail.then(() => {
      if (storeLocks.get(storeName) === tail) storeLocks.delete(storeName);
    });
    return next;
  }

  function machineOf(handle: number): SdkOlmMachine {
    const open = machines.get(handle);
    if (!open) {
      throw new NamedError('CryptoHostMachineClosed', `no open machine with handle ${handle} (closed, replaced on its store, or the page restarted)`);
    }
    return open.machine;
  }

  function closeMachine(handle: number): void {
    const open = machines.get(handle);
    if (!open) return;
    machines.delete(handle);
    if (open.storeName && storeOwner.get(open.storeName) === handle) storeOwner.delete(open.storeName);
    try {
      open.machine.close();
    } catch (e) {
      console.warn('[crypto-host] machine close failed', e);
    }
  }

  const userIds = (ids: string[]): SdkUserId[] => ids.map((id) => new sdk.UserId(id));

  // ---- the engine -----------------------------------------------------------------------------

  async function loadEngine(): Promise<EngineInfo> {
    if (!wasm || wasmReceived !== wasm.length) {
      throw new NamedError('CryptoHostWasmIncomplete', `received ${wasmReceived} of ${wasm?.length ?? 0} wasm bytes`);
    }
    const bytes = wasm;
    if (opts.wasmSha256) {
      if (!opts.subtle) throw new NamedError('E2eeUnavailableError', 'the crypto host has no WebCrypto (not a secure context)');
      const digest = hex(new Uint8Array(await opts.subtle.digest('SHA-256', bytes)));
      if (digest !== opts.wasmSha256) {
        throw new NamedError('CryptoHostIntegrityError', `engine wasm digest ${digest} does not match the build's ${opts.wasmSha256}`);
      }
    }
    const { instance } = (await WebAssembly.instantiate(bytes, {
      './matrix_sdk_crypto_wasm_bg.js': sdk as unknown as WebAssembly.ModuleImports,
    })) as unknown as WebAssembly.WebAssemblyInstantiatedSource;
    sdk.__wbg_set_wasm(instance.exports);
    (instance.exports.__wbindgen_start as () => void)();
    wasm = null;

    const v = sdk.getVersions();
    const versions = { vodozemac: v.vodozemac, matrix_sdk_crypto: v.matrix_sdk_crypto, git_sha: v.git_sha, git_description: v.git_description };
    safeFree(v);
    const s = new sdk.EncryptionSettings();
    const encryptionSettingsDefaults = {
      algorithm: s.algorithm,
      encryptStateEvents: s.encryptStateEvents,
      historyVisibility: s.historyVisibility,
      rotationPeriod: s.rotationPeriod.toString(),
      rotationPeriodMessages: s.rotationPeriodMessages.toString(),
    };
    safeFree(s);
    return { versions, encryptionSettingsDefaults };
  }

  // ---- value codecs ---------------------------------------------------------------------------

  function collectStrategy(w: WireCollectStrategy): SdkCollectStrategy {
    switch (w.kind) {
      case 'allDevices':
        return sdk.CollectStrategy.allDevices();
      case 'errorOnUnverifiedUserProblem':
        return sdk.CollectStrategy.errorOnUnverifiedUserProblem();
      case 'identityBasedStrategy':
        return sdk.CollectStrategy.identityBasedStrategy();
      case 'onlyTrustedDevices':
        return sdk.CollectStrategy.onlyTrustedDevices();
      case 'deviceBasedStrategy':
        return sdk.CollectStrategy.deviceBasedStrategy(w.onlyAllowTrustedDevices, w.errorOnVerifiedUserProblem);
    }
  }

  function encryptionSettings(w: WireEncryptionSettings) {
    const s = new sdk.EncryptionSettings();
    if (w.algorithm !== undefined) s.algorithm = w.algorithm;
    if (w.encryptStateEvents !== undefined) s.encryptStateEvents = w.encryptStateEvents;
    if (w.historyVisibility !== undefined) s.historyVisibility = w.historyVisibility;
    if (w.rotationPeriod !== undefined) s.rotationPeriod = BigInt(w.rotationPeriod);
    if (w.rotationPeriodMessages !== undefined) s.rotationPeriodMessages = BigInt(w.rotationPeriodMessages);
    if (w.sharingStrategy) s.sharingStrategy = collectStrategy(w.sharingStrategy);
    return s;
  }

  const handles: Partial<{ [K in HostMethod]: Handler<K> }> = {};
  function on<K extends HostMethod>(method: K, handler: Handler<K>): void {
    (handles as Record<string, unknown>)[method] = handler;
  }

  // ---- host.* / store.* (no engine needed) ----------------------------------------------------

  on('host.ping', async () => ({ protocol: PROTOCOL_VERSION, engineLoaded: engine !== null }));

  on('host.wipeStorage', async () => {
    if (engine && machines.size > 0) {
      throw new NamedError('CryptoHostBusy', 'cannot wipe storage while machines are open');
    }
    return { deleted: await storage.wipeAll(idb) };
  });

  on('host.wasmChunk', async ({ offset, total, data }) => {
    if (engine) return { received: wasmReceived };
    if (!wasm || offset === 0) {
      wasm = new Uint8Array(total);
      wasmReceived = 0;
    }
    wasmReceived += decodeBase64Into(wasm, offset, data);
    return { received: wasmReceived };
  });

  on('host.wasmFinish', async () => {
    if (engine) return engine;
    if (!engineLoading) {
      engineLoading = loadEngine().then(
        (info) => (engine = info),
        (e) => {
          engineLoading = null;
          throw e;
        },
      );
    }
    return engineLoading;
  });

  on('store.inspect', async ({ storeName }) => ({
    exists: await storage.storeExists(idb, storeName),
    marker: await storage.readMarker(idb, storeName),
    openHandle: storeOwner.get(storeName) ?? null,
  }));

  on('store.setMarker', async ({ storeName, userId, deviceId }) => {
    await storage.writeMarker(idb, storeName, { userId, deviceId });
    return null;
  });

  on('store.delete', ({ storeName, strict }) =>
    withStoreLock(storeName, async () => {
      const owner = storeOwner.get(storeName);
      if (owner !== undefined) closeMachine(owner);
      await storage.deleteStoreDatabases(idb, storeName, strict === true);
      return null;
    }),
  );

  // ---- machine.* ------------------------------------------------------------------------------

  on('machine.initialize', ({ userId, deviceId, storeName, passphrase }) =>
    withStoreLock(storeName, async () => {
      if (storeName) {
        const owner = storeOwner.get(storeName);
        if (owner !== undefined) closeMachine(owner);
      }
      const machine = await sdk.OlmMachine.initialize(new sdk.UserId(userId), new sdk.DeviceId(deviceId), storeName, passphrase);
      const handle = nextHandle++;
      machines.set(handle, { machine, storeName });
      if (storeName) storeOwner.set(storeName, handle);
      const keys = machine.identityKeys;
      const identityKeys = { ed25519: keys.ed25519.toBase64(), curve25519: keys.curve25519.toBase64() };
      safeFree(keys);
      return {
        handle,
        userId: str(machine.userId),
        deviceId: str(machine.deviceId),
        identityKeys,
        deviceCreationTimeMs: Number(machine.deviceCreationTimeMs),
      };
    }),
  );

  on('machine.close', async ({ handle }) => {
    const open = machines.get(handle);
    if (open) await withStoreLock(open.storeName, async () => closeMachine(handle));
    return null;
  });

  on('machine.displayName', async ({ handle }) => (await machineOf(handle).displayName) ?? null);

  on('machine.outgoingRequests', async ({ handle }) => (await machineOf(handle).outgoingRequests()).map(snapRequest));

  on('machine.markRequestAsSent', async ({ handle, requestId, requestType, response }) =>
    Boolean(await machineOf(handle).markRequestAsSent(requestId, requestType, response)),
  );

  on('machine.receiveSyncChanges', async (p) => {
    const m = machineOf(p.handle);
    const changed = new sdk.DeviceLists(userIds(p.changed), userIds(p.left));
    const counts = new Map<string, number>(p.oneTimeKeyCounts);
    const fallback = p.unusedFallbackKeys === null ? undefined : new Set(p.unusedFallbackKeys);
    const settings = p.decryptionTrust === null ? undefined : new sdk.DecryptionSettings(p.decryptionTrust);
    const processed = await m.receiveSyncChanges(p.events, changed, counts, fallback, settings);
    return processed.map(snapProcessed);
  });

  on('machine.updateTrackedUsers', async ({ handle, users }) => {
    await machineOf(handle).updateTrackedUsers(userIds(users));
    return null;
  });

  on('machine.markAllTrackedUsersAsDirty', async ({ handle }) => {
    await machineOf(handle).markAllTrackedUsersAsDirty();
    return null;
  });

  on('machine.trackedUsers', async ({ handle }) => [...(await machineOf(handle).trackedUsers())].map(str));

  on('machine.getMissingSessions', async ({ handle, users }) => {
    const req = await machineOf(handle).getMissingSessions(userIds(users));
    return req ? snapRequest(req) : null;
  });

  on('machine.shareRoomKey', async ({ handle, roomId, users, settings }) => {
    const room = new sdk.RoomId(roomId);
    try {
      const reqs = await machineOf(handle).shareRoomKey(room, userIds(users), encryptionSettings(settings));
      return reqs.map(snapRequest);
    } finally {
      safeFree(room);
    }
  });

  on('machine.encryptRoomEvent', async ({ handle, roomId, eventType, content }) => {
    const room = new sdk.RoomId(roomId);
    try {
      return await machineOf(handle).encryptRoomEvent(room, eventType, content);
    } finally {
      safeFree(room);
    }
  });

  on('machine.invalidateGroupSession', async ({ handle, roomId }) => {
    const room = new sdk.RoomId(roomId);
    try {
      return await machineOf(handle).invalidateGroupSession(room);
    } finally {
      safeFree(room);
    }
  });

  on('machine.decryptRoomEvents', async ({ handle, items }) => {
    const m = machineOf(handle);
    return Promise.all(
      items.map(async (item) => {
        const room = new sdk.RoomId(item.roomId);
        const settings = new sdk.DecryptionSettings(item.trust);
        try {
          return { ok: true as const, value: snapDecrypted(await m.decryptRoomEvent(item.event, room, settings)) };
        } catch (e) {
          return { ok: false as const, error: toWireError(e) };
        } finally {
          safeFree(room);
          safeFree(settings);
        }
      }),
    );
  });

  on('machine.getUserDevices', async ({ handle, userId, timeoutSecs }) => {
    const ud = await machineOf(handle).getUserDevices(new sdk.UserId(userId), timeoutSecs);
    try {
      return { devices: ud.devices().map(snapDevice), isAnyVerified: ud.isAnyVerified() };
    } finally {
      safeFree(ud);
    }
  });

  on('machine.getDevice', async ({ handle, userId, deviceId, timeoutSecs }) => {
    const d = await machineOf(handle).getDevice(new sdk.UserId(userId), new sdk.DeviceId(deviceId), timeoutSecs);
    return d ? snapDevice(d) : null;
  });

  on('machine.sign', async ({ handle, message }) => {
    const sig = await machineOf(handle).sign(message);
    try {
      return { json: sig.asJSON(), count: sig.count };
    } finally {
      safeFree(sig);
    }
  });

  on('machine.isBackupEnabled', async ({ handle }) => machineOf(handle).isBackupEnabled());

  on('machine.disableBackup', async ({ handle }) => {
    await machineOf(handle).disableBackup();
    return null;
  });

  on('machine.enableBackupV1', async ({ handle, publicKey, version }) => {
    await machineOf(handle).enableBackupV1(publicKey, version);
    return null;
  });

  on('machine.backupRoomKeys', async ({ handle }) => {
    const req = await machineOf(handle).backupRoomKeys();
    return req ? snapRequest(req) : null;
  });

  on('machine.roomKeyCounts', async ({ handle }) => {
    const c = await machineOf(handle).roomKeyCounts();
    try {
      return { total: c.total, backedUp: c.backedUp };
    } finally {
      safeFree(c);
    }
  });

  on('machine.importExportedRoomKeys', async ({ handle, exported }, progress) => {
    const result = await machineOf(handle).importExportedRoomKeys(exported, (done, total) => progress(Number(done), Number(total)));
    return snapImport(result);
  });

  // ---- device.* -------------------------------------------------------------------------------
  //
  // A Device is re-read from the store per call rather than kept as a live handle: the app's
  // Device is a snapshot that can outlive any number of calls, and getDevice is a store read.

  async function deviceOf(handle: number, userId: string, deviceId: string): Promise<SdkDevice> {
    const d = await machineOf(handle).getDevice(new sdk.UserId(userId), new sdk.DeviceId(deviceId));
    if (!d) throw new NamedError('CryptoHostDeviceNotFound', `device ${deviceId} of ${userId} is not known to the store`);
    return d;
  }

  on('device.setLocalTrust', async ({ handle, userId, deviceId, trust }) => {
    const d = await deviceOf(handle, userId, deviceId);
    try {
      await d.setLocalTrust(trust);
      return null;
    } finally {
      safeFree(d);
    }
  });

  on('device.encryptToDeviceEvent', async ({ handle, userId, deviceId, eventType, content, strategy }) => {
    const d = await deviceOf(handle, userId, deviceId);
    try {
      return await d.encryptToDeviceEvent(eventType, content, strategy ? collectStrategy(strategy) : undefined);
    } finally {
      safeFree(d);
    }
  });

  // ---- backup.* -------------------------------------------------------------------------------

  on('backup.prepare', () => backup.prepare());
  on('backup.restoreOpen', (p) => backup.open(p));
  on('backup.restoreAddPage', async ({ session, rooms }) => backup.addPage(session, rooms));
  on('backup.restoreImport', ({ handle, session, version }, progress) => backup.importInto(machineOf(handle), session, version, progress));
  on('backup.restoreClose', async ({ session }) => {
    backup.close(session);
    return null;
  });

  // ---- dispatch -------------------------------------------------------------------------------

  async function dispatch(msg: CallMessage): Promise<void> {
    const progress = msg.progress
      ? (...args: number[]) => post({ t: 'progress', id: msg.id, args })
      : () => undefined;
    try {
      const handler = handles[msg.method] as Handler<HostMethod> | undefined;
      if (!handler) throw new NamedError('CryptoHostUnknownMethod', `the crypto host has no method ${msg.method}`);
      if (!engine && !servedBeforeEngine(msg.method)) {
        throw new NamedError('CryptoHostNotReady', `${msg.method} called before the engine loaded`);
      }
      const value = await handler(msg.params as ParamsOf<HostMethod>, progress);
      post({ t: 'result', id: msg.id, ok: true, value });
    } catch (e) {
      post({ t: 'result', id: msg.id, ok: false, error: toWireError(e) });
    }
  }

  return {
    receive(raw: string) {
      let msg: CallMessage;
      try {
        msg = JSON.parse(raw) as CallMessage;
      } catch {
        return;
      }
      if (msg?.t !== 'call' || typeof msg.id !== 'number') return;
      void dispatch(msg);
    },
    hello() {
      post({ t: 'hello', protocol: PROTOCOL_VERSION });
    },
    dispose() {
      for (const handle of [...machines.keys()]) closeMachine(handle);
      backup.closeAll();
    },
  };
}

// ---- snapshots ----------------------------------------------------------------------------------

/** toString() a wasm value and release it. */
function str(o: { toString(): string; free(): void }): string {
  const s = o.toString();
  safeFree(o);
  return s;
}

function optStr(o: { toString(): string; free(): void } | undefined | null): string | undefined {
  return o ? str(o) : undefined;
}

function snapRequest(r: SdkRequest): WireRequest {
  const w: WireRequest = { type: r.type, body: r.body };
  // Each request class has a different subset of these; absent getters read undefined.
  if (r.id !== undefined) w.id = r.id;
  if (r.event_type !== undefined) w.event_type = r.event_type;
  if (r.txn_id !== undefined) w.txn_id = r.txn_id;
  if (r.room_id !== undefined) w.room_id = r.room_id;
  if (r.version !== undefined) w.version = r.version;
  safeFree(r);
  return w;
}

function snapDevice(d: SdkDevice): WireDevice {
  const keys: WireDevice['keys'] = [];
  for (const [id, key] of d.keys) {
    keys.push({ id: id.toString(), name: key.name, base64: key.toBase64() });
    safeFree(id);
    safeFree(key);
  }
  const sigs = d.signatures;
  const w: WireDevice = {
    userId: str(d.userId),
    deviceId: str(d.deviceId),
    displayName: d.displayName ?? undefined,
    algorithms: [...d.algorithms],
    keys,
    signatures: sigs.asJSON(),
    localTrustState: d.localTrustState,
    isBlacklisted: d.isBlacklisted(),
    isDeleted: d.isDeleted(),
    isLocallyTrusted: d.isLocallyTrusted(),
    isVerified: d.isVerified(),
    isCrossSigningTrusted: d.isCrossSigningTrusted(),
    isCrossSignedByOwner: d.isCrossSignedByOwner(),
    isDehydrated: d.isDehydrated,
    firstTimeSeen: d.firstTimeSeen().toString(),
  };
  safeFree(sigs);
  safeFree(d);
  return w;
}

function snapProcessed(e: SdkProcessedToDeviceEvent): WireProcessedToDeviceEvent {
  const w: WireProcessedToDeviceEvent = { type: e.type, rawEvent: e.rawEvent };
  const info = e.encryptionInfo;
  if (info) {
    w.encryptionInfo = {
      sender: str(info.sender),
      senderDevice: optStr(info.senderDevice),
      senderCurve25519Key: info.senderCurve25519Key,
      senderVerified: info.isSenderVerified(),
    };
    safeFree(info);
  }
  const utd = e.utdInfo;
  if (utd) {
    w.utdReason = utd.reason;
    safeFree(utd);
  }
  safeFree(e);
  return w;
}

function snapShield(s: SdkShieldState): WireShieldState {
  const w: WireShieldState = { color: s.color };
  if (s.code !== undefined && s.code !== null) w.code = s.code;
  if (s.message !== undefined && s.message !== null) w.message = s.message;
  safeFree(s);
  return w;
}

function snapDecrypted(ev: SdkDecryptedRoomEvent): WireDecryptedRoomEvent {
  const w: WireDecryptedRoomEvent = {
    event: ev.event,
    sender: str(ev.sender),
    senderDevice: optStr(ev.senderDevice),
    senderCurve25519Key: ev.senderCurve25519Key,
    senderClaimedEd25519Key: ev.senderClaimedEd25519Key ?? undefined,
    forwardingCurve25519KeyChain: [...(ev.forwardingCurve25519KeyChain ?? [])],
    forwarder: optStr(ev.forwarder),
    forwarderDevice: optStr(ev.forwarderDevice),
    shieldStrict: snapShield(ev.shieldState(true)),
    shieldLax: snapShield(ev.shieldState(false)),
  };
  safeFree(ev);
  return w;
}

function snapImport(r: SdkImportResult): WireImportResult {
  const keys: WireImportResult['keys'] = {};
  for (const [room, bySender] of r.keys()) {
    const out: Record<string, string[]> = {};
    for (const [sender, sessions] of bySender) out[sender] = [...sessions];
    keys[room] = out;
  }
  const w = { importedCount: Number(r.importedCount ?? 0), totalCount: Number(r.totalCount ?? 0), keys };
  safeFree(r);
  return w;
}

function hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** Decode base64 straight into `target` at `offset`; returns the bytes written. */
function decodeBase64Into(target: Uint8Array<ArrayBuffer>, offset: number, data: string): number {
  const bin = atob(data);
  if (offset + bin.length > target.length) {
    throw new NamedError('CryptoHostWasmIncomplete', `wasm chunk at ${offset} overruns the declared ${target.length} bytes`);
  }
  for (let i = 0; i < bin.length; i++) target[offset + i] = bin.charCodeAt(i);
  return bin.length;
}
