/**
 * `@matrix-org/matrix-sdk-crypto-wasm`, as the app sees it (PACKAGE_OVERRIDES in
 * ../overrides/crypto.manifest.js).
 *
 * Hermes has no WebAssembly, so the real engine runs in the crypto host WebView (./host.ts).
 * The web's E2EE modules (service, transport, rooms, safety, callKeys) import this package
 * and run unchanged against this facade, which keeps the package's API:
 *
 * - **Value classes** (UserId, DeviceId, RoomId, DeviceLists, EncryptionSettings,
 *   DecryptionSettings, CollectStrategy...) and the enums live here, as plain data with the
 *   same members and enum numbers; they cross the bridge as strings and numbers.
 * - **OlmMachine** methods are RPCs to the machine the page holds under a handle.
 * - **Returned objects are snapshots**, so the web's synchronous reads keep working:
 *   identityKeys (cached at initialize), request .id/.type/.body, UserDevices.devices()/get(),
 *   Device.deviceId/getKey()/localTrustState, decrypted events, key counts, import results.
 *   The few methods on them that change state (Device.setLocalTrust/encryptToDeviceEvent)
 *   are RPCs again.
 * - **decryptRoomEvent is batched**: a history page fires ~50 in one turn; they go to the
 *   page as one call and come back one result each.
 *
 * Anything the engine throws arrives with its name and message verbatim. What Strafe does
 * not use (cross-signing, verification flows, dehydrated devices, QR login...) is not here;
 * BackupDecryptionKey exists but refuses, because the backup key never leaves the page - the
 * mobile keyBackup.ts runs those flows as coarse RPCs instead.
 */
import { cryptoHost } from './host';
import { CryptoHostUnsupportedError, fromWireError } from './errors';
import type {
  HostMethod,
  ParamsOf,
  ResultOf,
  WireCollectStrategy,
  WireDecryptedRoomEvent,
  WireDevice,
  WireEncryptionSettings,
  WireImportResult,
  WireProcessedToDeviceEvent,
  WireRequest,
  WireShieldState,
} from './protocol';

// ---- enums (same names and numbers as the package) -----------------------------------------------

export enum RequestType {
  KeysUpload = 0,
  KeysQuery = 1,
  KeysClaim = 2,
  ToDevice = 3,
  SignatureUpload = 4,
  RoomMessage = 5,
  KeysBackup = 6,
}

export enum ProcessedToDeviceEventType {
  Decrypted = 0,
  UnableToDecrypt = 1,
  PlainText = 2,
  Invalid = 3,
}

export enum ToDeviceUnableToDecryptReason {
  DecryptionFailure = 0,
  UnverifiedSenderDevice = 1,
  NoOlmMachine = 2,
  EncryptionIsDisabled = 3,
}

export enum EncryptionAlgorithm {
  OlmV1Curve25519AesSha2 = 0,
  MegolmV1AesSha2 = 1,
  Unknown = 2,
}

export enum HistoryVisibility {
  Invited = 0,
  Joined = 1,
  Shared = 2,
  WorldReadable = 3,
}

export enum TrustRequirement {
  Untrusted = 0,
  CrossSignedOrLegacy = 1,
  CrossSigned = 2,
}

export enum LocalTrust {
  Verified = 0,
  BlackListed = 1,
  Ignored = 2,
  Unset = 3,
}

export enum DeviceKeyAlgorithmName {
  Ed25519 = 0,
  Curve25519 = 1,
  Unknown = 3,
}

export enum DeviceKeyName {
  Curve25519 = 0,
  Ed25519 = 1,
  Unknown = 2,
}

export enum DecryptionErrorCode {
  MissingRoomKey = 0,
  UnknownMessageIndex = 1,
  MismatchedIdentityKeys = 2,
  UnknownSenderDevice = 3,
  UnsignedSenderDevice = 4,
  SenderIdentityVerificationViolation = 5,
  UnableToDecrypt = 6,
  MismatchedSender = 7,
}

export enum ShieldColor {
  Red = 0,
  Grey = 1,
  None = 2,
}

export enum ShieldStateCode {
  AuthenticityNotGuaranteed = 0,
  UnknownDevice = 1,
  UnsignedDevice = 2,
  UnverifiedIdentity = 3,
  VerificationViolation = 4,
  MismatchedSender = 5,
}

export enum LoggerLevel {
  Trace = 0,
  Debug = 1,
  Info = 2,
  Warn = 3,
  Error = 4,
}

// ---- module functions ---------------------------------------------------------------------------

/**
 * Wait for the engine. The page instantiates the wasm itself (the app streams it in at boot),
 * so the URL argument the package accepts has nothing to point at and is ignored.
 */
export async function initAsync(_url?: URL | string): Promise<void> {
  await cryptoHost.whenReady();
}

export function start(): void {
  /* the page runs the engine's start hook when it instantiates the wasm */
}

export interface Versions {
  readonly vodozemac: string;
  readonly matrix_sdk_crypto: string;
  readonly git_sha: string;
  readonly git_description: string;
  free(): void;
}

export function getVersions(): Versions {
  const info = cryptoHost.engine;
  if (!info) {
    throw new Error('@matrix-org/matrix-sdk-crypto-wasm was used before it was initialized. Call `initAsync` first.');
  }
  return { ...info.versions, free: noop };
}

function noop(): void {
  /* snapshots hold no wasm memory */
}

// ---- identifiers --------------------------------------------------------------------------------

/** Matrix ids are `<sigil><localpart>:<server>`; the server part may itself contain ':' (a port). */
function splitId(id: string, sigil: string, kind: string): [string, string] {
  const colon = id.indexOf(':');
  if (typeof id !== 'string' || !id.startsWith(sigil) || colon < 2 || colon === id.length - 1) {
    throw new Error(`invalid ${kind}: ${String(id)}`);
  }
  return [id.slice(1, colon), id.slice(colon + 1)];
}

export class ServerName {
  constructor(private readonly name: string) {}
  get host(): string {
    const m = /^(\[[^\]]+\]|[^:]+)(?::\d+)?$/.exec(this.name);
    return m ? m[1]! : this.name;
  }
  get port(): number | undefined {
    const m = /:(\d+)$/.exec(this.name);
    return m && !this.name.endsWith(']') ? Number(m[1]) : undefined;
  }
  isIpLiteral(): boolean {
    return this.host.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(this.host);
  }
  toString(): string {
    return this.name;
  }
  free(): void {}
}

export class UserId {
  private readonly id: string;
  readonly localpart: string;
  constructor(id: string) {
    const [local] = splitId(id, '@', 'user id');
    this.id = id;
    this.localpart = local;
  }
  get serverName(): ServerName {
    return new ServerName(this.id.slice(this.id.indexOf(':') + 1));
  }
  clone(): UserId {
    return new UserId(this.id);
  }
  isHistorical(): boolean {
    // Historical user ids have a localpart outside the current grammar (spec 2.2 appendix).
    return !/^[a-z0-9._=\-/+]+$/.test(this.localpart);
  }
  toString(): string {
    return this.id;
  }
  free(): void {}
}

export class DeviceId {
  constructor(private readonly id: string) {}
  toString(): string {
    return this.id;
  }
  free(): void {}
}

export class RoomId {
  private readonly id: string;
  constructor(id: string) {
    splitId(id, '!', 'room id');
    this.id = id;
  }
  toString(): string {
    return this.id;
  }
  free(): void {}
}

export class DeviceKeyAlgorithm {
  constructor(private readonly algorithm: string) {}
  get name(): DeviceKeyAlgorithmName {
    if (this.algorithm === 'ed25519') return DeviceKeyAlgorithmName.Ed25519;
    if (this.algorithm === 'curve25519') return DeviceKeyAlgorithmName.Curve25519;
    return DeviceKeyAlgorithmName.Unknown;
  }
  toString(): string {
    return this.algorithm;
  }
  free(): void {}
}

export class DeviceKeyId {
  private readonly id: string;
  constructor(id: string) {
    if (!id.includes(':')) throw new Error(`invalid device key id: ${id}`);
    this.id = id;
  }
  get algorithm(): DeviceKeyAlgorithm {
    return new DeviceKeyAlgorithm(this.id.slice(0, this.id.indexOf(':')));
  }
  get deviceId(): DeviceId {
    return new DeviceId(this.id.slice(this.id.indexOf(':') + 1));
  }
  toString(): string {
    return this.id;
  }
  free(): void {}
}

// ---- keys ---------------------------------------------------------------------------------------

/** Unpadded base64 of a 32-byte key. */
function keyLength(base64: string): number {
  return Math.floor((base64.replace(/=+$/, '').length * 3) / 4);
}

export class Curve25519PublicKey {
  constructor(private readonly key: string) {}
  get length(): number {
    return keyLength(this.key);
  }
  toBase64(): string {
    return this.key;
  }
  free(): void {}
}

export class Ed25519PublicKey {
  /** @internal - the package's constructor is private too. */
  constructor(private readonly key: string) {}
  get length(): number {
    return keyLength(this.key);
  }
  toBase64(): string {
    return this.key;
  }
  free(): void {}
}

export class IdentityKeys {
  /** @internal */
  constructor(
    public ed25519: Ed25519PublicKey,
    public curve25519: Curve25519PublicKey,
  ) {}
  free(): void {}
}

export class DeviceKey {
  /** @internal */
  constructor(
    readonly name: DeviceKeyName,
    private readonly key: string,
  ) {}
  get ed25519(): Ed25519PublicKey | undefined {
    return this.name === DeviceKeyName.Ed25519 ? new Ed25519PublicKey(this.key) : undefined;
  }
  get curve25519(): Curve25519PublicKey | undefined {
    return this.name === DeviceKeyName.Curve25519 ? new Curve25519PublicKey(this.key) : undefined;
  }
  get unknown(): string | undefined {
    return this.name === DeviceKeyName.Unknown ? this.key : undefined;
  }
  toBase64(): string {
    return this.key;
  }
  free(): void {}
}

/** Signatures as returned by OlmMachine.sign() and Device.signatures: readable, not editable. */
export class Signatures {
  private readonly json: string;
  readonly count: number;
  constructor(json = '{}', count?: number) {
    this.json = json;
    this.count = count ?? countSignatures(json);
  }
  asJSON(): string {
    return this.json;
  }
  isEmpty(): boolean {
    return this.count === 0;
  }
  free(): void {}
}

function countSignatures(json: string): number {
  try {
    const parsed = JSON.parse(json) as Record<string, Record<string, unknown>>;
    return Object.values(parsed).reduce((n, byKey) => n + Object.keys(byKey ?? {}).length, 0);
  } catch {
    return 0;
  }
}

// ---- settings -----------------------------------------------------------------------------------

export class DeviceLists {
  readonly changed: UserId[];
  readonly left: UserId[];
  constructor(changed?: UserId[] | null, left?: UserId[] | null) {
    this.changed = (changed ?? []).map((u) => u.clone());
    this.left = (left ?? []).map((u) => u.clone());
  }
  isEmpty(): boolean {
    return this.changed.length === 0 && this.left.length === 0;
  }
  free(): void {}
}

export class CollectStrategy {
  private constructor(
    /** @internal */
    readonly wire: WireCollectStrategy,
  ) {}
  static allDevices(): CollectStrategy {
    return new CollectStrategy({ kind: 'allDevices' });
  }
  static errorOnUnverifiedUserProblem(): CollectStrategy {
    return new CollectStrategy({ kind: 'errorOnUnverifiedUserProblem' });
  }
  static identityBasedStrategy(): CollectStrategy {
    return new CollectStrategy({ kind: 'identityBasedStrategy' });
  }
  static onlyTrustedDevices(): CollectStrategy {
    return new CollectStrategy({ kind: 'onlyTrustedDevices' });
  }
  /** @deprecated as in the package: use one of the named strategies. */
  static deviceBasedStrategy(only_allow_trusted_devices: boolean, error_on_verified_user_problem: boolean): CollectStrategy {
    return new CollectStrategy({
      kind: 'deviceBasedStrategy',
      onlyAllowTrustedDevices: only_allow_trusted_devices,
      errorOnVerifiedUserProblem: error_on_verified_user_problem,
    });
  }
  eq(other: CollectStrategy): boolean {
    return JSON.stringify(this.wire) === JSON.stringify(other.wire);
  }
  free(): void {}
}

/**
 * The engine's defaults for a fresh EncryptionSettings, as read from it at boot; these are
 * the 18.x values, used only if a getter is read before the engine has loaded.
 */
function settingsDefaults() {
  const d = cryptoHost.engine?.encryptionSettingsDefaults;
  return {
    algorithm: (d?.algorithm ?? EncryptionAlgorithm.MegolmV1AesSha2) as EncryptionAlgorithm,
    encryptStateEvents: d?.encryptStateEvents ?? false,
    historyVisibility: (d?.historyVisibility ?? HistoryVisibility.Shared) as HistoryVisibility,
    rotationPeriod: BigInt(d?.rotationPeriod ?? '604800000000'),
    rotationPeriodMessages: BigInt(d?.rotationPeriodMessages ?? '100'),
  };
}

/**
 * Only fields that were assigned cross the bridge; the page applies them to the engine's own
 * `new EncryptionSettings()`, so nothing unassigned can drift from the engine's default.
 */
export class EncryptionSettings {
  private set_: WireEncryptionSettings = {};
  private strategy: CollectStrategy | null = null;

  get algorithm(): EncryptionAlgorithm {
    return (this.set_.algorithm ?? settingsDefaults().algorithm) as EncryptionAlgorithm;
  }
  set algorithm(v: EncryptionAlgorithm) {
    this.set_.algorithm = v;
  }
  get encryptStateEvents(): boolean {
    return this.set_.encryptStateEvents ?? settingsDefaults().encryptStateEvents;
  }
  set encryptStateEvents(v: boolean) {
    this.set_.encryptStateEvents = v;
  }
  get historyVisibility(): HistoryVisibility {
    return (this.set_.historyVisibility ?? settingsDefaults().historyVisibility) as HistoryVisibility;
  }
  set historyVisibility(v: HistoryVisibility) {
    this.set_.historyVisibility = v;
  }
  get rotationPeriod(): bigint {
    return this.set_.rotationPeriod !== undefined ? BigInt(this.set_.rotationPeriod) : settingsDefaults().rotationPeriod;
  }
  set rotationPeriod(v: bigint) {
    this.set_.rotationPeriod = v.toString();
  }
  get rotationPeriodMessages(): bigint {
    return this.set_.rotationPeriodMessages !== undefined ? BigInt(this.set_.rotationPeriodMessages) : settingsDefaults().rotationPeriodMessages;
  }
  set rotationPeriodMessages(v: bigint) {
    this.set_.rotationPeriodMessages = v.toString();
  }
  get sharingStrategy(): CollectStrategy {
    return this.strategy ?? CollectStrategy.allDevices();
  }
  set sharingStrategy(v: CollectStrategy) {
    this.strategy = v;
  }
  /** @internal */
  toWire(): WireEncryptionSettings {
    return this.strategy ? { ...this.set_, sharingStrategy: this.strategy.wire } : { ...this.set_ };
  }
  free(): void {}
}

export class DecryptionSettings {
  constructor(public sender_device_trust_requirement: TrustRequirement) {}
  free(): void {}
}

// ---- requests -----------------------------------------------------------------------------------

export class KeysUploadRequest {
  readonly type = RequestType.KeysUpload;
  constructor(
    readonly id: string,
    readonly body: string,
  ) {}
  free(): void {}
}

export class KeysQueryRequest {
  readonly type = RequestType.KeysQuery;
  constructor(
    readonly id: string,
    readonly body: string,
  ) {}
  free(): void {}
}

export class KeysClaimRequest {
  readonly type = RequestType.KeysClaim;
  constructor(
    readonly id: string,
    readonly body: string,
  ) {}
  free(): void {}
}

export class ToDeviceRequest {
  readonly type = RequestType.ToDevice;
  constructor(
    readonly id: string,
    readonly event_type: string,
    readonly txn_id: string,
    readonly body: string,
  ) {}
  free(): void {}
}

export class SignatureUploadRequest {
  readonly type = RequestType.SignatureUpload;
  readonly body: string;
  constructor(
    readonly id: string | undefined,
    signed_keys: string,
  ) {
    this.body = signed_keys;
  }
  free(): void {}
}

export class RoomMessageRequest {
  readonly type = RequestType.RoomMessage;
  readonly body: string;
  constructor(
    readonly id: string,
    readonly room_id: string,
    readonly txn_id: string,
    readonly event_type: string,
    content: string,
  ) {
    this.body = content;
  }
  free(): void {}
}

export class KeysBackupRequest {
  readonly type = RequestType.KeysBackup;
  constructor(
    readonly id: string,
    readonly body: string,
    readonly version: string,
  ) {}
  free(): void {}
}

export type OutgoingRequest =
  | KeysUploadRequest
  | KeysQueryRequest
  | KeysClaimRequest
  | ToDeviceRequest
  | SignatureUploadRequest
  | RoomMessageRequest
  | KeysBackupRequest;

function requestFromWire(w: WireRequest): OutgoingRequest {
  const id = w.id ?? '';
  switch (w.type) {
    case RequestType.KeysUpload:
      return new KeysUploadRequest(id, w.body);
    case RequestType.KeysQuery:
      return new KeysQueryRequest(id, w.body);
    case RequestType.KeysClaim:
      return new KeysClaimRequest(id, w.body);
    case RequestType.ToDevice:
      return new ToDeviceRequest(id, w.event_type ?? '', w.txn_id ?? '', w.body);
    case RequestType.SignatureUpload:
      return new SignatureUploadRequest(w.id, w.body);
    case RequestType.RoomMessage:
      return new RoomMessageRequest(id, w.room_id ?? '', w.txn_id ?? '', w.event_type ?? '', w.body);
    case RequestType.KeysBackup:
      return new KeysBackupRequest(id, w.body, w.version ?? '');
    default:
      throw new Error(`crypto host returned an unknown request type ${w.type}`);
  }
}

// ---- to-device events ---------------------------------------------------------------------------

export class ToDeviceEncryptionInfo {
  /** @internal */
  constructor(
    public sender: UserId,
    private senderDevice_: DeviceId | undefined,
    public senderCurve25519Key: string,
    private readonly verified: boolean,
  ) {}
  get senderDevice(): DeviceId | undefined {
    return this.senderDevice_;
  }
  set senderDevice(v: DeviceId | null | undefined) {
    this.senderDevice_ = v ?? undefined;
  }
  isSenderVerified(): boolean {
    return this.verified;
  }
  free(): void {}
}

export class DecryptedToDeviceEvent {
  readonly type = ProcessedToDeviceEventType.Decrypted;
  /** @internal */
  constructor(
    readonly rawEvent: string,
    readonly encryptionInfo: ToDeviceEncryptionInfo,
  ) {}
  free(): void {}
}

export class PlainTextToDeviceEvent {
  readonly type = ProcessedToDeviceEventType.PlainText;
  /** @internal */
  constructor(readonly rawEvent: string) {}
  free(): void {}
}

export class InvalidToDeviceEvent {
  readonly type = ProcessedToDeviceEventType.Invalid;
  /** @internal */
  constructor(readonly rawEvent: string) {}
  free(): void {}
}

export class ToDeviceUnableToDecryptInfo {
  /** @internal */
  constructor(public reason: ToDeviceUnableToDecryptReason) {}
  free(): void {}
}

export class UTDToDeviceEvent {
  readonly type = ProcessedToDeviceEventType.UnableToDecrypt;
  /** @internal */
  constructor(
    readonly rawEvent: string,
    readonly utdInfo: ToDeviceUnableToDecryptInfo,
  ) {}
  free(): void {}
}

export type ProcessedToDeviceEvent = DecryptedToDeviceEvent | PlainTextToDeviceEvent | InvalidToDeviceEvent | UTDToDeviceEvent;

function processedFromWire(w: WireProcessedToDeviceEvent): ProcessedToDeviceEvent {
  switch (w.type) {
    case ProcessedToDeviceEventType.Decrypted: {
      const i = w.encryptionInfo!;
      return new DecryptedToDeviceEvent(
        w.rawEvent,
        new ToDeviceEncryptionInfo(new UserId(i.sender), i.senderDevice !== undefined ? new DeviceId(i.senderDevice) : undefined, i.senderCurve25519Key, i.senderVerified),
      );
    }
    case ProcessedToDeviceEventType.UnableToDecrypt:
      return new UTDToDeviceEvent(w.rawEvent, new ToDeviceUnableToDecryptInfo((w.utdReason ?? 0) as ToDeviceUnableToDecryptReason));
    case ProcessedToDeviceEventType.PlainText:
      return new PlainTextToDeviceEvent(w.rawEvent);
    default:
      return new InvalidToDeviceEvent(w.rawEvent);
  }
}

// ---- room events --------------------------------------------------------------------------------

export class ShieldState {
  /** @internal */
  constructor(
    public color: ShieldColor,
    private code_: ShieldStateCode | undefined,
    readonly message: string | undefined,
  ) {}
  get code(): ShieldStateCode | undefined {
    return this.code_;
  }
  set code(v: ShieldStateCode | null | undefined) {
    this.code_ = v ?? undefined;
  }
  free(): void {}
}

function shieldFromWire(w: WireShieldState): ShieldState {
  return new ShieldState(w.color as ShieldColor, w.code as ShieldStateCode | undefined, w.message);
}

export class DecryptedRoomEvent {
  readonly event: string;
  readonly sender: UserId;
  readonly senderDevice: DeviceId | undefined;
  readonly senderCurve25519Key: string;
  readonly senderClaimedEd25519Key: string | undefined;
  readonly forwardingCurve25519KeyChain: string[];
  readonly forwarder: UserId | undefined;
  readonly forwarderDevice: DeviceId | undefined;
  private readonly shields: { strict: WireShieldState; lax: WireShieldState };

  /** @internal */
  constructor(w: WireDecryptedRoomEvent) {
    this.event = w.event;
    this.sender = new UserId(w.sender);
    this.senderDevice = w.senderDevice !== undefined ? new DeviceId(w.senderDevice) : undefined;
    this.senderCurve25519Key = w.senderCurve25519Key;
    this.senderClaimedEd25519Key = w.senderClaimedEd25519Key;
    this.forwardingCurve25519KeyChain = w.forwardingCurve25519KeyChain;
    this.forwarder = w.forwarder !== undefined ? new UserId(w.forwarder) : undefined;
    this.forwarderDevice = w.forwarderDevice !== undefined ? new DeviceId(w.forwarderDevice) : undefined;
    this.shields = { strict: w.shieldStrict, lax: w.shieldLax };
  }

  /** The sender device's verification state at the time of decryption. */
  shieldState(strict: boolean): ShieldState {
    return shieldFromWire(strict ? this.shields.strict : this.shields.lax);
  }
  free(): void {}
}

/**
 * What decryptRoomEvent rejects with when the engine cannot decrypt (most often: the room
 * key has not arrived yet). An Error here, unlike the package's bare class, so it carries a
 * stack and prints usefully; the fields are the engine's.
 */
export class MegolmDecryptionError extends Error {
  readonly code: DecryptionErrorCode;
  readonly description: string;
  readonly maybe_withheld: string | undefined;
  readonly withheldCode: string | undefined;

  /** @internal */
  constructor(description: string, data: Record<string, unknown> = {}) {
    super(description);
    this.name = 'MegolmDecryptionError';
    this.code = (typeof data.code === 'number' ? data.code : DecryptionErrorCode.UnableToDecrypt) as DecryptionErrorCode;
    this.description = description;
    this.maybe_withheld = typeof data.maybe_withheld === 'string' ? data.maybe_withheld : undefined;
    this.withheldCode = typeof data.withheldCode === 'string' ? data.withheldCode : undefined;
  }

  static unable_to_decrypt(desc: string): MegolmDecryptionError {
    return new MegolmDecryptionError(desc, { code: DecryptionErrorCode.UnableToDecrypt });
  }
  free(): void {}
}

function decryptErrorFromWire(w: { name: string; message: string; data?: Record<string, unknown> }): Error {
  if (w.name === 'MegolmDecryptionError') return new MegolmDecryptionError(w.message, w.data);
  return fromWireError(w);
}

// ---- results ------------------------------------------------------------------------------------

export class RoomKeyCounts {
  /** @internal */
  constructor(
    public total: number,
    public backedUp: number,
  ) {}
  free(): void {}
}

export class RoomKeyImportResult {
  readonly importedCount: number;
  readonly totalCount: number;
  private readonly keys_: WireImportResult['keys'];

  /** @internal */
  constructor(w: WireImportResult) {
    this.importedCount = w.importedCount;
    this.totalCount = w.totalCount;
    this.keys_ = w.keys;
  }

  /** Room id -> sender key -> session ids that were imported. */
  keys(): Map<string, Map<string, Set<string>>> {
    const out = new Map<string, Map<string, Set<string>>>();
    for (const [room, bySender] of Object.entries(this.keys_)) {
      out.set(room, new Map(Object.entries(bySender).map(([sender, ids]) => [sender, new Set(ids)])));
    }
    return out;
  }
  free(): void {}
}

// ---- devices ------------------------------------------------------------------------------------

const KEY_PREFIX: Record<number, string> = {
  [DeviceKeyAlgorithmName.Ed25519]: 'ed25519',
  [DeviceKeyAlgorithmName.Curve25519]: 'curve25519',
};

/**
 * A device as the store knew it when the snapshot was taken. Reads are synchronous, as on
 * the package's Device; setLocalTrust and encryptToDeviceEvent are RPCs that re-read the
 * device in the page.
 */
export class Device {
  readonly userId: UserId;
  readonly deviceId: DeviceId;
  readonly displayName: string | undefined;
  readonly algorithms: EncryptionAlgorithm[];
  readonly isDehydrated: boolean;
  private trust: LocalTrust;

  /** @internal */
  constructor(
    private readonly machine: OlmMachine,
    private readonly w: WireDevice,
  ) {
    this.userId = new UserId(w.userId);
    this.deviceId = new DeviceId(w.deviceId);
    this.displayName = w.displayName;
    this.algorithms = w.algorithms as EncryptionAlgorithm[];
    this.isDehydrated = w.isDehydrated;
    this.trust = w.localTrustState as LocalTrust;
  }

  get localTrustState(): LocalTrust {
    return this.trust;
  }

  get keys(): Map<DeviceKeyId, DeviceKey> {
    return new Map(this.w.keys.map((k) => [new DeviceKeyId(k.id), new DeviceKey(k.name as DeviceKeyName, k.base64)]));
  }

  get signatures(): Signatures {
    return new Signatures(this.w.signatures);
  }

  get curve25519Key(): Curve25519PublicKey | undefined {
    return this.getKey(DeviceKeyAlgorithmName.Curve25519)?.curve25519;
  }

  get ed25519Key(): Ed25519PublicKey | undefined {
    return this.getKey(DeviceKeyAlgorithmName.Ed25519)?.ed25519;
  }

  getKey(algorithm: DeviceKeyAlgorithmName): DeviceKey | undefined {
    const prefix = KEY_PREFIX[algorithm];
    if (!prefix) return undefined;
    const k = this.w.keys.find((key) => key.id === `${prefix}:${this.w.deviceId}`);
    return k ? new DeviceKey(k.name as DeviceKeyName, k.base64) : undefined;
  }

  isBlacklisted(): boolean {
    return this.trust === LocalTrust.BlackListed;
  }
  isDeleted(): boolean {
    return this.w.isDeleted;
  }
  isLocallyTrusted(): boolean {
    return this.trust === LocalTrust.Verified;
  }
  isVerified(): boolean {
    // Local trust is the part this snapshot can update; cross-signing trust is as fetched.
    return this.isLocallyTrusted() || this.w.isCrossSigningTrusted;
  }
  isCrossSigningTrusted(): boolean {
    return this.w.isCrossSigningTrusted;
  }
  isCrossSignedByOwner(): boolean {
    return this.w.isCrossSignedByOwner;
  }
  firstTimeSeen(): bigint {
    return BigInt(this.w.firstTimeSeen);
  }

  async setLocalTrust(local_state: LocalTrust): Promise<null> {
    await this.machine._rpc('device.setLocalTrust', { userId: this.w.userId, deviceId: this.w.deviceId, trust: local_state });
    this.trust = local_state;
    return null;
  }

  encryptToDeviceEvent(event_type: string, content: unknown, share_strategy?: CollectStrategy | null): Promise<string> {
    return this.machine._rpc('device.encryptToDeviceEvent', {
      userId: this.w.userId,
      deviceId: this.w.deviceId,
      eventType: event_type,
      content,
      strategy: share_strategy ? share_strategy.wire : null,
    });
  }

  free(): void {}
}

export class UserDevices {
  /** @internal */
  constructor(
    private readonly list: Device[],
    private readonly anyVerified: boolean,
  ) {}
  devices(): Device[] {
    return [...this.list];
  }
  get(device_id: DeviceId): Device | undefined {
    const id = device_id.toString();
    return this.list.find((d) => d.deviceId.toString() === id);
  }
  keys(): DeviceId[] {
    return this.list.map((d) => new DeviceId(d.deviceId.toString()));
  }
  isAnyVerified(): boolean {
    return this.anyVerified;
  }
  free(): void {}
}

// ---- the machine --------------------------------------------------------------------------------

/** Most decrypts one RPC carries; a history page is ~50. */
const DECRYPT_BATCH_MAX = 64;

interface QueuedDecrypt {
  item: { event: string; roomId: string; trust: number };
  resolve(e: DecryptedRoomEvent): void;
  reject(e: Error): void;
}

type MachineParams<K extends HostMethod> = Omit<ParamsOf<K>, 'handle'>;

export class OlmMachine {
  private closed = false;
  private decryptQueue: QueuedDecrypt[] = [];
  private decryptScheduled = false;
  private readonly identity: IdentityKeys;

  private constructor(
    private readonly handle: number,
    /** The host page life this machine lives in; it is gone with that page. */
    private readonly generation: number,
    private readonly info: ResultOf<'machine.initialize'>,
  ) {
    this.identity = new IdentityKeys(new Ed25519PublicKey(info.identityKeys.ed25519), new Curve25519PublicKey(info.identityKeys.curve25519));
  }

  /**
   * Open (creating if needed) the machine for this user and device on `store_name`. The store
   * lives in the page's IndexedDB; opening a store another machine holds closes that one.
   * The logger and X.509 arguments of the package are not supported (and not used).
   */
  static async initialize(user_id: UserId, device_id: DeviceId, store_name?: string, store_passphrase?: string): Promise<OlmMachine> {
    const info = await cryptoHost.call('machine.initialize', {
      userId: user_id.toString(),
      deviceId: device_id.toString(),
      storeName: store_name,
      passphrase: store_passphrase,
    });
    return new OlmMachine(info.handle, cryptoHost.generation, info);
  }

  /** @internal - the RPC every method goes through, bound to this machine's handle and page life. */
  _rpc<K extends HostMethod>(method: K, params: MachineParams<K>, opts: { onProgress?: (...args: number[]) => void } = {}): Promise<ResultOf<K>> {
    if (this.closed) return Promise.reject(new Error('OlmMachine has been closed'));
    return cryptoHost.call(method, { ...params, handle: this.handle } as unknown as ParamsOf<K>, { generation: this.generation, onProgress: opts.onProgress });
  }

  /** @internal */
  get _host(): { handle: number; generation: number } {
    return { handle: this.handle, generation: this.generation };
  }

  get userId(): UserId {
    return new UserId(this.info.userId);
  }
  get deviceId(): DeviceId {
    return new DeviceId(this.info.deviceId);
  }
  get identityKeys(): IdentityKeys {
    return this.identity;
  }
  get deviceCreationTimeMs(): number {
    return this.info.deviceCreationTimeMs;
  }
  get displayName(): Promise<string | undefined> {
    return this._rpc('machine.displayName', {}).then((n) => n ?? undefined);
  }

  async outgoingRequests(): Promise<OutgoingRequest[]> {
    return (await this._rpc('machine.outgoingRequests', {})).map(requestFromWire);
  }

  async markRequestAsSent(request_id: string, request_type: RequestType, response: string): Promise<true> {
    await this._rpc('machine.markRequestAsSent', { requestId: request_id, requestType: request_type, response });
    return true;
  }

  /**
   * `one_time_keys_counts` must be the real Map: an empty one tells the engine the server has
   * no one-time keys, and it uploads more on every sync, forever. A plain object is accepted
   * as its entries rather than silently becoming {}.
   */
  async receiveSyncChanges(
    to_device_events: string,
    changed_devices: DeviceLists,
    one_time_keys_counts: Map<string, number>,
    unused_fallback_keys?: Set<string>,
    decryption_settings?: DecryptionSettings,
  ): Promise<ProcessedToDeviceEvent[]> {
    const counts: [string, number][] =
      one_time_keys_counts instanceof Map
        ? [...one_time_keys_counts.entries()]
        : Object.entries((one_time_keys_counts ?? {}) as Record<string, number>);
    const processed = await this._rpc('machine.receiveSyncChanges', {
      events: to_device_events,
      changed: changed_devices.changed.map(String),
      left: changed_devices.left.map(String),
      oneTimeKeyCounts: counts,
      unusedFallbackKeys: unused_fallback_keys === undefined || unused_fallback_keys === null ? null : [...unused_fallback_keys],
      decryptionTrust: decryption_settings ? decryption_settings.sender_device_trust_requirement : null,
    });
    return processed.map(processedFromWire);
  }

  async updateTrackedUsers(users: UserId[]): Promise<void> {
    await this._rpc('machine.updateTrackedUsers', { users: users.map(String) });
  }

  async markAllTrackedUsersAsDirty(): Promise<void> {
    await this._rpc('machine.markAllTrackedUsersAsDirty', {});
  }

  async trackedUsers(): Promise<Set<UserId>> {
    return new Set((await this._rpc('machine.trackedUsers', {})).map((u) => new UserId(u)));
  }

  async getMissingSessions(users: UserId[]): Promise<KeysClaimRequest | null> {
    const req = await this._rpc('machine.getMissingSessions', { users: users.map(String) });
    return req ? (requestFromWire(req) as KeysClaimRequest) : null;
  }

  async shareRoomKey(room_id: RoomId, users: UserId[], encryption_settings: EncryptionSettings): Promise<ToDeviceRequest[]> {
    const reqs = await this._rpc('machine.shareRoomKey', {
      roomId: room_id.toString(),
      users: users.map(String),
      settings: encryption_settings.toWire(),
    });
    return reqs.map((r) => requestFromWire(r) as ToDeviceRequest);
  }

  encryptRoomEvent(room_id: RoomId, event_type: string, content: string): Promise<string> {
    return this._rpc('machine.encryptRoomEvent', { roomId: room_id.toString(), eventType: event_type, content });
  }

  invalidateGroupSession(room_id: RoomId): Promise<boolean> {
    return this._rpc('machine.invalidateGroupSession', { roomId: room_id.toString() });
  }

  /**
   * Decrypt one event. Calls made in the same turn are sent to the page together (see
   * DECRYPT_BATCH_MAX); each still resolves or rejects on its own.
   */
  decryptRoomEvent(event: string, room_id: RoomId, decryption_settings: DecryptionSettings): Promise<DecryptedRoomEvent> {
    return new Promise((resolve, reject) => {
      this.decryptQueue.push({
        item: { event, roomId: room_id.toString(), trust: decryption_settings.sender_device_trust_requirement },
        resolve,
        reject,
      });
      if (!this.decryptScheduled) {
        this.decryptScheduled = true;
        setTimeout(() => this.flushDecrypts(), 0);
      }
    });
  }

  private flushDecrypts(): void {
    this.decryptScheduled = false;
    const all = this.decryptQueue;
    this.decryptQueue = [];
    for (let i = 0; i < all.length; i += DECRYPT_BATCH_MAX) {
      const batch = all.slice(i, i + DECRYPT_BATCH_MAX);
      this._rpc('machine.decryptRoomEvents', { items: batch.map((q) => q.item) }).then(
        (results) => {
          batch.forEach((q, n) => {
            const r = results[n];
            if (r?.ok) q.resolve(new DecryptedRoomEvent(r.value));
            else q.reject(r ? decryptErrorFromWire(r.error) : new Error('crypto host returned no result for this event'));
          });
        },
        (err: Error) => batch.forEach((q) => q.reject(err)),
      );
    }
  }

  async getUserDevices(user_id: UserId, timeout_secs?: number | null): Promise<UserDevices> {
    const ud = await this._rpc('machine.getUserDevices', { userId: user_id.toString(), timeoutSecs: timeout_secs ?? null });
    return new UserDevices(
      ud.devices.map((d) => new Device(this, d)),
      ud.isAnyVerified,
    );
  }

  async getDevice(user_id: UserId, device_id: DeviceId, timeout_secs?: number | null): Promise<Device | undefined> {
    const d = await this._rpc('machine.getDevice', { userId: user_id.toString(), deviceId: device_id.toString(), timeoutSecs: timeout_secs ?? null });
    return d ? new Device(this, d) : undefined;
  }

  async sign(message: string): Promise<Signatures> {
    const s = await this._rpc('machine.sign', { message });
    return new Signatures(s.json, s.count);
  }

  isBackupEnabled(): Promise<boolean> {
    return this._rpc('machine.isBackupEnabled', {});
  }

  async disableBackup(): Promise<void> {
    await this._rpc('machine.disableBackup', {});
  }

  async enableBackupV1(public_key_base_64: string, version: string): Promise<void> {
    await this._rpc('machine.enableBackupV1', { publicKey: public_key_base_64, version });
  }

  async backupRoomKeys(): Promise<KeysBackupRequest | undefined> {
    const req = await this._rpc('machine.backupRoomKeys', {});
    return req ? (requestFromWire(req) as KeysBackupRequest) : undefined;
  }

  async roomKeyCounts(): Promise<RoomKeyCounts> {
    const c = await this._rpc('machine.roomKeyCounts', {});
    return new RoomKeyCounts(c.total, c.backedUp);
  }

  async importExportedRoomKeys(
    exported_room_keys: string,
    progress_listener: (progress: bigint, total: bigint) => void,
  ): Promise<RoomKeyImportResult> {
    const result = await this._rpc(
      'machine.importExportedRoomKeys',
      { exported: exported_room_keys },
      { onProgress: (done = 0, total = 0) => progress_listener?.(BigInt(done), BigInt(total)) },
    );
    return new RoomKeyImportResult(result);
  }

  /** @deprecated as in the package: use importExportedRoomKeys. Same JSON result shape. */
  async importRoomKeys(exported_room_keys: string, progress_listener: (imported: bigint, total: bigint) => void): Promise<string> {
    const r = await this.importExportedRoomKeys(exported_room_keys, progress_listener);
    const keys: Record<string, Record<string, string[]>> = {};
    for (const [room, bySender] of r.keys()) {
      keys[room] = Object.fromEntries([...bySender].map(([s, ids]) => [s, [...ids]]));
    }
    return JSON.stringify({ imported_count: r.importedCount, total_count: r.totalCount, keys });
  }

  /**
   * Not available: decrypted backup sessions never cross into the app. A restore goes through
   * the mobile keyBackup.ts, which streams the encrypted pages into the page and imports
   * there (backup.restore* RPCs).
   */
  importBackedUpRoomKeys(
    _backed_up_room_keys: Map<RoomId, Map<string, unknown>>,
    _progress_listener: (progress: bigint, total: bigint, failures: bigint) => void,
    _backup_version: string,
  ): Promise<RoomKeyImportResult> {
    return Promise.reject(new CryptoHostUnsupportedError('OlmMachine.importBackedUpRoomKeys (decrypted sessions stay in the page; use restoreKeyBackup)'));
  }

  /** Close the machine in the page and release its store. The object is unusable afterwards. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.generation !== cryptoHost.generation) return;
    cryptoHost.call('machine.close', { handle: this.handle }, { generation: this.generation }).catch(() => undefined);
  }

  free(): void {
    this.close();
  }
}

/** The page-side handle and page life of a machine - for the mobile keyBackup's coarse RPCs. */
export function hostHandleOf(machine: OlmMachine): { handle: number; generation: number } {
  return machine._host;
}

// ---- the backup key -----------------------------------------------------------------------------

/**
 * Present for the type, unusable by design: the backup's private key exists only inside the
 * crypto host. The mobile keyBackup.ts (overrides/e2ee) does prepare and restore there.
 */
export class MegolmV1BackupKey {
  private constructor() {}
  get algorithm(): string {
    throw new CryptoHostUnsupportedError('MegolmV1BackupKey');
  }
  get publicKeyBase64(): string {
    throw new CryptoHostUnsupportedError('MegolmV1BackupKey');
  }
  free(): void {}
}

export class BackupDecryptionKey {
  private constructor() {}
  static createRandomKey(): BackupDecryptionKey {
    throw new CryptoHostUnsupportedError('BackupDecryptionKey (the key stays in the crypto host; use prepareKeyBackup)');
  }
  static fromBase64(_key: string): BackupDecryptionKey {
    throw new CryptoHostUnsupportedError('BackupDecryptionKey (the key stays in the crypto host; use restoreKeyBackup)');
  }
  get megolmV1PublicKey(): MegolmV1BackupKey {
    throw new CryptoHostUnsupportedError('BackupDecryptionKey');
  }
  decryptV1(_ephemeral_key: string, _mac: string, _ciphertext: string): string {
    throw new CryptoHostUnsupportedError('BackupDecryptionKey');
  }
  toBase64(): string {
    throw new CryptoHostUnsupportedError('BackupDecryptionKey');
  }
  free(): void {}
}
