/**
 * The slice of matrix-sdk-crypto-wasm's generated bindings the host page uses, typed
 * structurally.
 *
 * The page imports the wasm-bindgen glue module (pkg/matrix_sdk_crypto_wasm_bg.js) rather
 * than the package entry, because the entry fetches the .wasm by URL and the page has no URL
 * to fetch from - it instantiates from bytes (see ./engine.ts). The package name itself is
 * aliased to the app's facade for type-checking, so these types are declared here instead
 * of imported: they describe the real engine, not the facade.
 */

export interface WasmObject {
  free(): void;
}

export interface SdkUserId extends WasmObject {
  toString(): string;
}
export interface SdkDeviceId extends WasmObject {
  toString(): string;
}
export interface SdkRoomId extends WasmObject {
  toString(): string;
}
export interface SdkPublicKey extends WasmObject {
  toBase64(): string;
}

export interface SdkRequest extends WasmObject {
  readonly type: number;
  readonly id?: string;
  readonly body: string;
  readonly event_type?: string;
  readonly txn_id?: string;
  readonly room_id?: string;
  readonly version?: string;
}

export interface SdkDeviceKey extends WasmObject {
  readonly name: number;
  toBase64(): string;
}

export interface SdkDevice extends WasmObject {
  readonly userId: SdkUserId;
  readonly deviceId: SdkDeviceId;
  readonly displayName: string | undefined;
  readonly algorithms: number[];
  readonly keys: Map<{ toString(): string; free(): void }, SdkDeviceKey>;
  readonly signatures: WasmObject & { asJSON(): string };
  readonly localTrustState: number;
  readonly isDehydrated: boolean;
  isBlacklisted(): boolean;
  isDeleted(): boolean;
  isLocallyTrusted(): boolean;
  isVerified(): boolean;
  isCrossSigningTrusted(): boolean;
  isCrossSignedByOwner(): boolean;
  firstTimeSeen(): bigint;
  setLocalTrust(trust: number): Promise<unknown>;
  encryptToDeviceEvent(eventType: string, content: unknown, strategy?: SdkCollectStrategy | null): Promise<string>;
}

export interface SdkUserDevices extends WasmObject {
  devices(): SdkDevice[];
  isAnyVerified(): boolean;
}

export interface SdkToDeviceEncryptionInfo extends WasmObject {
  readonly sender: SdkUserId;
  readonly senderDevice: SdkDeviceId | undefined;
  readonly senderCurve25519Key: string;
  isSenderVerified(): boolean;
}

export interface SdkProcessedToDeviceEvent extends WasmObject {
  readonly type: number;
  readonly rawEvent: string;
  readonly encryptionInfo?: SdkToDeviceEncryptionInfo;
  readonly utdInfo?: WasmObject & { reason: number };
}

export interface SdkShieldState extends WasmObject {
  readonly color: number;
  readonly code: number | undefined;
  readonly message: string | undefined;
}

export interface SdkDecryptedRoomEvent extends WasmObject {
  readonly event: string;
  readonly sender: SdkUserId;
  readonly senderDevice: SdkDeviceId | undefined;
  readonly senderCurve25519Key: string;
  readonly senderClaimedEd25519Key: string | undefined;
  readonly forwardingCurve25519KeyChain: string[];
  readonly forwarder: SdkUserId | undefined;
  readonly forwarderDevice: SdkDeviceId | undefined;
  shieldState(strict: boolean): SdkShieldState;
}

export interface SdkCollectStrategy extends WasmObject {}

export interface SdkEncryptionSettings extends WasmObject {
  algorithm: number;
  encryptStateEvents: boolean;
  historyVisibility: number;
  rotationPeriod: bigint;
  rotationPeriodMessages: bigint;
  sharingStrategy: SdkCollectStrategy;
}

export interface SdkImportResult extends WasmObject {
  readonly importedCount: number;
  readonly totalCount: number;
  keys(): Map<string, Map<string, Set<string>>>;
}

export interface SdkOlmMachine extends WasmObject {
  readonly userId: SdkUserId;
  readonly deviceId: SdkDeviceId;
  readonly identityKeys: WasmObject & { ed25519: SdkPublicKey; curve25519: SdkPublicKey };
  readonly deviceCreationTimeMs: number;
  readonly displayName: Promise<string | undefined>;
  close(): void;
  outgoingRequests(): Promise<SdkRequest[]>;
  markRequestAsSent(id: string, type: number, response: string): Promise<boolean>;
  receiveSyncChanges(
    events: string,
    changed: WasmObject,
    otkCounts: Map<string, number>,
    unusedFallbackKeys?: Set<string>,
    settings?: WasmObject,
  ): Promise<SdkProcessedToDeviceEvent[]>;
  updateTrackedUsers(users: SdkUserId[]): Promise<void>;
  markAllTrackedUsersAsDirty(): Promise<void>;
  trackedUsers(): Promise<Set<SdkUserId>>;
  getMissingSessions(users: SdkUserId[]): Promise<SdkRequest | null | undefined>;
  shareRoomKey(roomId: SdkRoomId, users: SdkUserId[], settings: SdkEncryptionSettings): Promise<SdkRequest[]>;
  encryptRoomEvent(roomId: SdkRoomId, eventType: string, content: string): Promise<string>;
  invalidateGroupSession(roomId: SdkRoomId): Promise<boolean>;
  decryptRoomEvent(event: string, roomId: SdkRoomId, settings: WasmObject): Promise<SdkDecryptedRoomEvent>;
  getUserDevices(userId: SdkUserId, timeoutSecs?: number | null): Promise<SdkUserDevices>;
  getDevice(userId: SdkUserId, deviceId: SdkDeviceId, timeoutSecs?: number | null): Promise<SdkDevice | undefined>;
  sign(message: string): Promise<WasmObject & { asJSON(): string; readonly count: number }>;
  isBackupEnabled(): Promise<boolean>;
  disableBackup(): Promise<void>;
  enableBackupV1(publicKey: string, version: string): Promise<void>;
  backupRoomKeys(): Promise<SdkRequest | undefined>;
  roomKeyCounts(): Promise<WasmObject & { total: number; backedUp: number }>;
  importExportedRoomKeys(exported: string, progress: (progress: bigint, total: bigint) => void): Promise<SdkImportResult>;
  importBackedUpRoomKeys(
    keys: Map<SdkRoomId, Map<string, unknown>>,
    progress: (progress: bigint, total: bigint, failures: bigint) => void,
    version: string,
  ): Promise<SdkImportResult>;
}

export interface SdkBackupDecryptionKey extends WasmObject {
  readonly megolmV1PublicKey: WasmObject & { readonly publicKeyBase64: string };
  toBase64(): string;
  decryptV1(ephemeral: string, mac: string, ciphertext: string): string;
}

/** The bindings module (namespace) - also the wasm instance's import object. */
export interface Sdk {
  __wbg_set_wasm(exports: unknown): void;
  getVersions(): WasmObject & { vodozemac: string; matrix_sdk_crypto: string; git_sha: string; git_description: string };
  UserId: new (id: string) => SdkUserId;
  DeviceId: new (id: string) => SdkDeviceId;
  RoomId: new (id: string) => SdkRoomId;
  DeviceLists: new (changed?: SdkUserId[] | null, left?: SdkUserId[] | null) => WasmObject;
  EncryptionSettings: new () => SdkEncryptionSettings;
  DecryptionSettings: new (trust: number) => WasmObject;
  CollectStrategy: {
    allDevices(): SdkCollectStrategy;
    errorOnUnverifiedUserProblem(): SdkCollectStrategy;
    identityBasedStrategy(): SdkCollectStrategy;
    onlyTrustedDevices(): SdkCollectStrategy;
    deviceBasedStrategy(onlyAllowTrustedDevices: boolean, errorOnVerifiedUserProblem: boolean): SdkCollectStrategy;
  };
  OlmMachine: {
    initialize(userId: SdkUserId, deviceId: SdkDeviceId, storeName?: string, passphrase?: string): Promise<SdkOlmMachine>;
  };
  BackupDecryptionKey: {
    createRandomKey(): SdkBackupDecryptionKey;
    fromBase64(key: string): SdkBackupDecryptionKey;
  };
}
