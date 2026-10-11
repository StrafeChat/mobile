/**
 * The wire protocol between the app (Hermes) and the crypto host page (the hidden WebView
 * running matrix-sdk-crypto-wasm). Imported by both sides - src/platform/crypto on the app
 * side and crypto-host/src in the page - so the two can never disagree about a shape.
 *
 * Every message is one JSON string. Nothing here may carry a wasm object: values cross as
 * plain data (ids as strings, enums as their numbers, Maps and Sets as explicit arrays,
 * bigints as decimal strings) and each side rebuilds what it needs. See ./README.md.
 */

/** Bumped whenever a message or method shape changes; the app refuses a page that differs. */
export const PROTOCOL_VERSION = 1;

/**
 * The page's origin. `.invalid` is reserved (RFC 6761) and never resolves, so nothing can
 * ever be served from it; the WebView only uses it as a stable, secure origin, which is what
 * keeps the IndexedDB store across launches and gives the page WebCrypto.
 */
export const HOST_ORIGIN = 'https://e2ee.strafe.invalid';

// ---- envelopes ---------------------------------------------------------------------------------

export interface CallMessage {
  t: 'call';
  id: number;
  method: HostMethod;
  params: unknown;
  /** Ask the page to stream progress events for this call (key imports). */
  progress?: boolean;
}

/** App -> page. */
export type ToHostMessage = CallMessage;

/** The page loaded and is listening. Sent once per page life. */
export interface HelloMessage {
  t: 'hello';
  protocol: number;
}

export interface ResultMessage {
  t: 'result';
  id: number;
  ok: boolean;
  value?: unknown;
  error?: WireError;
}

export interface ProgressMessage {
  t: 'progress';
  id: number;
  args: number[];
}

/** Something the page logged outside any call (an unhandled rejection, a wasm panic). */
export interface LogMessage {
  t: 'log';
  level: 'warn' | 'error';
  message: string;
}

/** Page -> app. */
export type FromHostMessage = HelloMessage | ResultMessage | ProgressMessage | LogMessage;

/**
 * An exception, by value. `name` and `message` are forwarded VERBATIM: the machine layer
 * recovers from a device mismatch by regex-parsing the engine's initialize error, and the
 * reset dialog prints `name: message`. `data` carries the extra fields of the engine's
 * non-Error throwables (MegolmDecryptionError's code, withheld reason...).
 */
export interface WireError {
  name: string;
  message: string;
  stack?: string;
  data?: Record<string, unknown>;
}

/** Serialise anything thrown, keeping name and message exactly as they were. */
export function toWireError(e: unknown): WireError {
  if (e instanceof Error) {
    return { name: e.name || 'Error', message: e.message, stack: e.stack };
  }
  if (e && typeof e === 'object') {
    // wasm-bindgen throwables that are not Errors (MegolmDecryptionError): keep their fields.
    const o = e as Record<string, unknown>;
    const ctor = (o.constructor as { name?: string } | undefined)?.name;
    const data: Record<string, unknown> = {};
    for (const key of ['code', 'description', 'maybe_withheld', 'withheldCode'] as const) {
      try {
        const v = o[key];
        if (v !== undefined) data[key] = v;
      } catch {
        /* a getter on a freed object */
      }
    }
    const message =
      typeof data.description === 'string' ? data.description : typeof o.message === 'string' ? o.message : String(e);
    return { name: ctor && ctor !== 'Object' ? ctor : 'Error', message, data };
  }
  return { name: 'Error', message: String(e) };
}

// ---- value shapes ------------------------------------------------------------------------------

/** One of OlmMachine.outgoingRequests()'s request objects, by value. */
export interface WireRequest {
  /** RequestType. */
  type: number;
  id?: string;
  body: string;
  event_type?: string;
  txn_id?: string;
  room_id?: string;
  version?: string;
}

export interface WireDeviceKey {
  /** The DeviceKeyId string, e.g. `ed25519:DEVICE`. */
  id: string;
  /** DeviceKeyName. */
  name: number;
  base64: string;
}

export interface WireDevice {
  userId: string;
  deviceId: string;
  displayName?: string;
  algorithms: number[];
  keys: WireDeviceKey[];
  /** Signatures.asJSON(). */
  signatures: string;
  localTrustState: number;
  isBlacklisted: boolean;
  isDeleted: boolean;
  isLocallyTrusted: boolean;
  isVerified: boolean;
  isCrossSigningTrusted: boolean;
  isCrossSignedByOwner: boolean;
  isDehydrated: boolean;
  /** firstTimeSeen() as a decimal string (a u64 in milliseconds). */
  firstTimeSeen: string;
}

export interface WireUserDevices {
  devices: WireDevice[];
  isAnyVerified: boolean;
}

export interface WireToDeviceEncryptionInfo {
  sender: string;
  senderDevice?: string;
  senderCurve25519Key: string;
  senderVerified: boolean;
}

/** One of receiveSyncChanges()'s processed events, by value. */
export interface WireProcessedToDeviceEvent {
  /** ProcessedToDeviceEventType. */
  type: number;
  rawEvent: string;
  encryptionInfo?: WireToDeviceEncryptionInfo;
  /** ToDeviceUnableToDecryptReason, for UnableToDecrypt events. */
  utdReason?: number;
}

export interface WireShieldState {
  color: number;
  code?: number;
  message?: string;
}

export interface WireDecryptedRoomEvent {
  event: string;
  sender: string;
  senderDevice?: string;
  senderCurve25519Key: string;
  senderClaimedEd25519Key?: string;
  forwardingCurve25519KeyChain: string[];
  forwarder?: string;
  forwarderDevice?: string;
  /** shieldState(true) and shieldState(false), computed at decryption time. */
  shieldStrict: WireShieldState;
  shieldLax: WireShieldState;
}

export type WireCollectStrategy =
  | { kind: 'allDevices' | 'errorOnUnverifiedUserProblem' | 'identityBasedStrategy' | 'onlyTrustedDevices' }
  | { kind: 'deviceBasedStrategy'; onlyAllowTrustedDevices: boolean; errorOnVerifiedUserProblem: boolean };

/**
 * EncryptionSettings, sparse: only fields the caller assigned. The page starts from the
 * engine's own `new EncryptionSettings()`, so an unset field keeps the engine's default
 * rather than whatever this side believed the default to be.
 */
export interface WireEncryptionSettings {
  algorithm?: number;
  encryptStateEvents?: boolean;
  historyVisibility?: number;
  /** bigint as a decimal string. */
  rotationPeriod?: string;
  rotationPeriodMessages?: string;
  sharingStrategy?: WireCollectStrategy;
}

/** The engine's EncryptionSettings defaults, read once at boot, for the facade's getters. */
export interface EncryptionSettingsDefaults {
  algorithm: number;
  encryptStateEvents: boolean;
  historyVisibility: number;
  rotationPeriod: string;
  rotationPeriodMessages: string;
}

export interface EngineInfo {
  versions: { vodozemac: string; matrix_sdk_crypto: string; git_sha: string; git_description: string };
  encryptionSettingsDefaults: EncryptionSettingsDefaults;
}

export type WireDecryptResult = { ok: true; value: WireDecryptedRoomEvent } | { ok: false; error: WireError };

export interface WireImportResult {
  importedCount: number;
  totalCount: number;
  /** keys(): room id -> sender key -> session ids. */
  keys: Record<string, Record<string, string[]>>;
}

/** A backed-up session as the server returns it (GET /devices/backup/keys pages). */
export interface WireBackupRooms {
  [roomId: string]: {
    sessions?: Record<string, { session_data?: { ephemeral?: string; mac?: string; ciphertext?: string } }>;
  };
}

// ---- methods -----------------------------------------------------------------------------------

interface M<P, R> {
  params: P;
  result: R;
}
type H = { handle: number };

/**
 * Every RPC the page serves, with its parameter and result shapes. `machine.*` and
 * `device.*` need a machine handle from `machine.initialize`; handles die with the page.
 */
export interface HostMethods {
  'host.ping': M<Record<string, never>, { protocol: number; engineLoaded: boolean }>;
  /** Delete every IndexedDB database on the page's origin. Run before the engine loads. */
  'host.wipeStorage': M<Record<string, never>, { deleted: string[] }>;
  /** One slice of the .wasm, base64. `offset` is in bytes; the first slice allocates `total`. */
  'host.wasmChunk': M<{ offset: number; total: number; data: string }, { received: number }>;
  /** Verify the assembled bytes against the digest baked into the page, then instantiate. */
  'host.wasmFinish': M<Record<string, never>, EngineInfo>;

  'store.inspect': M<
    { storeName: string },
    { exists: boolean; marker: { userId: string; deviceId: string } | null; openHandle: number | null }
  >;
  'store.setMarker': M<{ storeName: string; userId: string; deviceId: string }, null>;
  /** Close any machine on the store, then delete its databases (and the marker). */
  'store.delete': M<{ storeName: string; strict?: boolean }, null>;

  'machine.initialize': M<
    { userId: string; deviceId: string; storeName?: string; passphrase?: string },
    { handle: number; userId: string; deviceId: string; identityKeys: { ed25519: string; curve25519: string }; deviceCreationTimeMs: number }
  >;
  'machine.close': M<H, null>;
  'machine.displayName': M<H, string | null>;
  'machine.outgoingRequests': M<H, WireRequest[]>;
  'machine.markRequestAsSent': M<H & { requestId: string; requestType: number; response: string }, boolean>;
  'machine.receiveSyncChanges': M<
    H & {
      events: string;
      changed: string[];
      left: string[];
      /** The one-time-key counts Map, as entries. Never collapse this to {} - see README. */
      oneTimeKeyCounts: [string, number][];
      /** null: argument omitted. [] : an empty Set. They mean different things to the engine. */
      unusedFallbackKeys: string[] | null;
      decryptionTrust: number | null;
    },
    WireProcessedToDeviceEvent[]
  >;
  'machine.updateTrackedUsers': M<H & { users: string[] }, null>;
  'machine.markAllTrackedUsersAsDirty': M<H, null>;
  'machine.trackedUsers': M<H, string[]>;
  'machine.getMissingSessions': M<H & { users: string[] }, WireRequest | null>;
  'machine.shareRoomKey': M<H & { roomId: string; users: string[]; settings: WireEncryptionSettings }, WireRequest[]>;
  'machine.encryptRoomEvent': M<H & { roomId: string; eventType: string; content: string }, string>;
  'machine.invalidateGroupSession': M<H & { roomId: string }, boolean>;
  /** Batched decryptRoomEvent: one result per item, in order; one failure fails only its item. */
  'machine.decryptRoomEvents': M<H & { items: { event: string; roomId: string; trust: number }[] }, WireDecryptResult[]>;
  'machine.getUserDevices': M<H & { userId: string; timeoutSecs: number | null }, WireUserDevices>;
  'machine.getDevice': M<H & { userId: string; deviceId: string; timeoutSecs: number | null }, WireDevice | null>;
  'machine.sign': M<H & { message: string }, { json: string; count: number }>;
  'machine.isBackupEnabled': M<H, boolean>;
  'machine.disableBackup': M<H, null>;
  'machine.enableBackupV1': M<H & { publicKey: string; version: string }, null>;
  'machine.backupRoomKeys': M<H, WireRequest | null>;
  'machine.roomKeyCounts': M<H, { total: number; backedUp: number }>;
  'machine.importExportedRoomKeys': M<H & { exported: string }, WireImportResult>;

  'device.setLocalTrust': M<H & { userId: string; deviceId: string; trust: number }, null>;
  'device.encryptToDeviceEvent': M<
    H & { userId: string; deviceId: string; eventType: string; content: unknown; strategy: WireCollectStrategy | null },
    string
  >;

  /**
   * Make a new backup key pair and recovery code inside the page. The private key leaves the
   * page only wrapped under the code (web/src/lib/e2ee/recoveryCode.ts, run in the page).
   */
  'backup.prepare': M<Record<string, never>, { code: string; publicKey: string; wrapped: string; salt: string }>;
  /** Unwrap the backup key with a recovery code and keep it in the page under a session id. */
  'backup.restoreOpen': M<{ wrapped: string; salt: string; code: string; publicKey: string }, { session: number }>;
  /** Decrypt one page of backed-up sessions into the session; the plaintext stays in the page. */
  'backup.restoreAddPage': M<{ session: number; rooms: WireBackupRooms }, { total: number; failed: number }>;
  /** Import everything collected into the machine, then forget the key. */
  'backup.restoreImport': M<H & { session: number; version: string }, { importedCount: number; totalCount: number; total: number; failed: number }>;
  'backup.restoreClose': M<{ session: number }, null>;
}

export type HostMethod = keyof HostMethods;
export type ParamsOf<K extends HostMethod> = HostMethods[K]['params'];
export type ResultOf<K extends HostMethod> = HostMethods[K]['result'];

/** Methods the page serves before the engine is loaded: storage housekeeping and the boot itself. */
export function servedBeforeEngine(method: HostMethod): boolean {
  return method.startsWith('host.') || method.startsWith('store.');
}

/** The IndexedDB databases that make up one engine store (the engine's two plus our marker). */
export function storeDatabaseNames(storeName: string): string[] {
  return [`${storeName}::matrix-sdk-crypto`, `${storeName}::matrix-sdk-crypto-meta`, storeName, `${storeName}::strafe-device`];
}
