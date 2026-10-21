/**
 * @jest-environment node
 */
/**
 * The facade is faithful: the real matrix-sdk-crypto-wasm, run by the real crypto host
 * server, driven through the app-side client and the facade exactly as the web's E2EE code
 * drives the package - two devices establishing an Olm session, sharing a Megolm room key
 * and exchanging a message, a call-key style to-device event, safety-number device reads,
 * and the key backup round trip with the backup key kept inside the host.
 */
import 'fake-indexeddb/auto';
import { cryptoHost } from '../host';
import {
  CollectStrategy,
  DecryptionErrorCode,
  DecryptionSettings,
  DeviceId,
  DeviceKeyAlgorithmName,
  DeviceLists,
  EncryptionAlgorithm,
  EncryptionSettings,
  getVersions,
  LocalTrust,
  MegolmDecryptionError,
  OlmMachine,
  ProcessedToDeviceEventType,
  RequestType,
  RoomId,
  TrustRequirement,
  UserId,
  type DecryptedToDeviceEvent,
  type KeysUploadRequest,
} from '../matrixSdkCrypto';
import { bootEngine, FakeKeyServer, type Channel } from './harness';

// MMKV is native (Nitro); the host client only keeps its wipe flag there.
jest.mock('../../storage', () => {
  const memory = () => {
    const m = new Map<string, unknown>();
    return { set: (k: string, v: unknown) => m.set(k, v), getBoolean: (k: string) => m.get(k), remove: (k: string) => m.delete(k) };
  };
  return { appStorage: memory(), webStorage: memory() };
});

// ---- the mobile keyBackup, against a fake backup API -----------------------------------------------

/**
 * A miniature of equinox's backup endpoints: one current version, the one it replaced kept
 * as `previous` (the server retains it for a week), a password on create and delete, and a
 * 404 for an upload to anything but the current version.
 */
interface MockVersion {
  version: string;
  public_key: string;
  wrapped: string;
  salt: string;
}
const mockBackup: {
  machine: OlmMachine | null;
  version: MockVersion | null;
  previous: MockVersion | null;
  /** By version, then room. */
  sessions: Record<string, Record<string, { sessions: Record<string, unknown> }>>;
  passwords: string[];
  nextVersion: number;
} = { machine: null, version: null, previous: null, sessions: {}, passwords: [], nextVersion: 1 };

/** Sessions the server holds for a version (the current one by default). */
function mockBackedUpCount(version = mockBackup.version?.version): number {
  return Object.values(mockBackup.sessions[version ?? ''] ?? {}).reduce((n, r) => n + Object.keys(r.sessions).length, 0);
}

/** Make `row` the current version, retaining the one it replaces - as the server's create does. */
function mockReplaceVersion(row: Omit<MockVersion, 'version'>): string {
  const version = String(mockBackup.nextVersion++);
  mockBackup.previous = mockBackup.version;
  mockBackup.version = { version, ...row };
  mockBackup.sessions[version] = {};
  return version;
}

jest.mock('../../overrides/e2ee/machine', () => ({
  getMachine: async () => mockBackup.machine,
}));

jest.mock('@web/api/devices', () => {
  const { ApiError } = jest.requireActual('@web/api/ApiError') as typeof import('@web/api/ApiError');
  const gone = () => new ApiError('backup version not found', 404);
  const ALG = 'm.megolm_backup.v1.curve25519-aes-sha2';
  const recovery = (row: MockVersion) => ({
    exists: true,
    version: row.version,
    algorithm: ALG,
    auth_data: { public_key: row.public_key },
    wrapped_private_key: row.wrapped,
    salt: row.salt,
  });
  return {
    BACKUP_ALGORITHM: ALG,
    createBackupVersion: async (input: { auth_data: { public_key: string }; wrapped_private_key: string; salt: string; password: string }) => {
      mockBackup.passwords.push(input.password);
      return { version: mockReplaceVersion({ public_key: input.auth_data.public_key, wrapped: input.wrapped_private_key, salt: input.salt }) };
    },
    getBackupVersion: async () =>
      mockBackup.version
        ? {
            exists: true,
            version: mockBackup.version.version,
            algorithm: ALG,
            auth_data: { public_key: mockBackup.version.public_key },
            count: mockBackedUpCount(),
            ...(mockBackup.previous ? { previous: { version: mockBackup.previous.version, created_at: '2026-10-01T00:00:00Z' } } : {}),
          }
        : { exists: false },
    getBackupRecovery: async (version?: string) => {
      if (version) {
        // The server serves the current version and the retained previous one, no other.
        const row = [mockBackup.version, mockBackup.previous].find((r) => r?.version === version);
        if (!row) throw gone();
        return recovery(row);
      }
      return mockBackup.version ? recovery(mockBackup.version) : { exists: false };
    },
    putBackupKeys: async (version: string, body: string) => {
      if (version !== mockBackup.version?.version) throw gone();
      const parsed = JSON.parse(body) as { rooms: Record<string, { sessions: Record<string, unknown> }> };
      const target = (mockBackup.sessions[version] ??= {});
      for (const [room, r] of Object.entries(parsed.rooms)) {
        Object.assign(((target[room] ??= { sessions: {} }).sessions), r.sessions);
      }
      return { count: mockBackedUpCount(version), etag: String(mockBackedUpCount(version)) };
    },
    // One session per page, to make the restore cross page boundaries.
    getBackupKeys: async (version: string, after?: string) => {
      if (version !== mockBackup.version?.version && version !== mockBackup.previous?.version) throw gone();
      const all = Object.entries(mockBackup.sessions[version] ?? {}).flatMap(([room, r]) => Object.entries(r.sessions).map(([id, s]) => ({ room, id, s })));
      const i = after ? Number(after) : 0;
      const item = all[i];
      const rooms = item ? { [item.room]: { sessions: { [item.id]: item.s } } } : {};
      return { rooms, next: i + 1 < all.length ? String(i + 1) : undefined };
    },
    deleteBackupVersion: async (_version: string, password: string) => {
      mockBackup.passwords.push(password);
      mockBackup.version = null;
    },
  };
});

/**
 * The app's localStorage (MMKV in the app; Node has none), where keyBackup keeps the version
 * this device uploads to and the backup pin. One per simulated device: `switchDeviceStorage`
 * swaps it, as a second phone would have its own.
 */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}
const deviceStorage = new Map<string, MemoryStorage>();
function switchDeviceStorage(device: string): void {
  let store = deviceStorage.get(device);
  if (!store) deviceStorage.set(device, (store = new MemoryStorage()));
  Object.defineProperty(globalThis, 'localStorage', { value: store, configurable: true, writable: true });
}
switchDeviceStorage('alice1');

// eslint-disable-next-line import/first
import {
  commitKeyBackup,
  getBackupStatus,
  keyBackupActivity,
  noteBackupVersionChanged,
  prepareKeyBackup,
  RecoveryCodeMismatchError,
  restoreKeyBackup,
  stopBackupSync,
  syncKeyBackup,
} from '../../overrides/e2ee/keyBackup';

jest.setTimeout(120_000);

const ALICE = '@100:a.test';
const BOB = '@200:b.test';
const ROOM = '!300:a.test';

let channel: Channel;
const server = new FakeKeyServer();

/** Relay a machine's outgoing requests through the fake server, as transport.ts does. */
async function pump(machine: OlmMachine, userId: string, deviceId: string): Promise<void> {
  for (const req of await machine.outgoingRequests()) {
    const body = JSON.parse(req.body);
    let response: unknown = {};
    switch (req.type) {
      case RequestType.KeysUpload:
        response = server.upload(userId, deviceId, body);
        break;
      case RequestType.KeysQuery:
        response = server.query(body);
        break;
      case RequestType.KeysClaim:
        response = server.claim(body);
        break;
      case RequestType.ToDevice: {
        const r = req as unknown as { event_type: string };
        server.deliver(userId, r.event_type, body.messages);
        break;
      }
    }
    await machine.markRequestAsSent(req.id!, req.type, JSON.stringify(response));
  }
}

async function receive(machine: OlmMachine, userId: string, deviceId: string) {
  return machine.receiveSyncChanges(
    JSON.stringify(server.take(userId, deviceId)),
    new DeviceLists(),
    new Map([['signed_curve25519', server.otkCount(userId, deviceId)]]),
    new Set(),
  );
}

function roomEvent(ciphertext: string, sender: string, id: string): string {
  return JSON.stringify({
    event_id: `$${id}:strafe.internal`,
    sender,
    origin_server_ts: Date.now(),
    room_id: ROOM,
    type: 'm.room.encrypted',
    content: JSON.parse(ciphertext),
  });
}

function settings(): EncryptionSettings {
  const s = new EncryptionSettings();
  s.algorithm = EncryptionAlgorithm.MegolmV1AesSha2;
  s.sharingStrategy = CollectStrategy.allDevices();
  return s;
}

const untrusted = () => new DecryptionSettings(TrustRequirement.Untrusted);

let alice: OlmMachine;
let bob: OlmMachine;
let firstCiphertext = '';
/** The recovery code of the backup Alice's first device creates (the backup tests share it). */
let aliceBackupCode = '';

beforeAll(async () => {
  channel = await bootEngine();
});

afterAll(() => {
  stopBackupSync();
  cryptoHost.resetForTests();
});

test('boots the engine from bytes and reports its versions', () => {
  expect(cryptoHost.state).toBe('ready');
  expect(getVersions().vodozemac).toMatch(/^\d+\.\d+/);
  // Defaults read from the engine at boot back the facade's EncryptionSettings getters.
  const s = new EncryptionSettings();
  expect(s.algorithm).toBe(EncryptionAlgorithm.MegolmV1AesSha2);
  expect(s.rotationPeriodMessages).toBe(100n);
});

test('initialize: cached identity keys, key upload request, signatures', async () => {
  alice = await OlmMachine.initialize(new UserId(ALICE), new DeviceId('1001'), 'strafe-e2ee-alice', 'alice-pass');
  bob = await OlmMachine.initialize(new UserId(BOB), new DeviceId('2001'), 'strafe-e2ee-bob', 'bob-pass');
  expect(alice.userId.toString()).toBe(ALICE);
  expect(alice.deviceId.toString()).toBe('1001');
  const ed = alice.identityKeys.ed25519.toBase64();
  expect(ed).toMatch(/^[A-Za-z0-9+/]{43}$/);
  expect(alice.identityKeys.curve25519.toBase64()).toMatch(/^[A-Za-z0-9+/]{43}$/);

  const reqs = await alice.outgoingRequests();
  const upload = reqs.find((r) => r.type === RequestType.KeysUpload) as KeysUploadRequest;
  expect(upload).toBeDefined();
  expect(typeof upload.id).toBe('string');
  const body = JSON.parse(upload.body);
  expect(body.device_keys.keys['ed25519:1001']).toBe(ed);
  expect(Object.keys(body.one_time_keys).length).toBeGreaterThan(0);

  const sig = await alice.sign('{"a":1}');
  expect(JSON.parse(sig.asJSON())[ALICE]['ed25519:1001']).toEqual(expect.any(String));
  expect(sig.count).toBe(1);

  await pump(alice, ALICE, '1001');
  await pump(bob, BOB, '2001');
  expect(server.otkCount(ALICE, '1001')).toBeGreaterThan(0);
});

test('one-time-key counts cross as a Map: a real count settles the engine, an empty one makes it upload again', async () => {
  const carol = await OlmMachine.initialize(new UserId('@400:c.test'), new DeviceId('4001'), undefined, undefined);
  await pump(carol, '@400:c.test', '4001');
  const newOneTimeKeys = async () => {
    const upload = (await carol.outgoingRequests()).find((r) => r.type === RequestType.KeysUpload);
    return upload ? Object.keys(JSON.parse(upload.body).one_time_keys ?? {}).length : 0;
  };
  const counted = await carol.receiveSyncChanges('[]', new DeviceLists(), new Map([['signed_curve25519', 50]]), new Set(['signed_curve25519']));
  expect(counted).toEqual([]);
  expect(await newOneTimeKeys()).toBe(0);
  // The failure mode an encoding bug would cause: the engine sees zero keys on the server.
  await carol.receiveSyncChanges('[]', new DeviceLists(), new Map(), new Set(['signed_curve25519']));
  expect(await newOneTimeKeys()).toBeGreaterThan(0);
  carol.close();
});

test('two devices: Olm session, Megolm room key, batched decrypts', async () => {
  // As rooms.ensureRoomKeyShared does it.
  await alice.updateTrackedUsers([new UserId(ALICE), new UserId(BOB)]);
  await pump(alice, ALICE, '1001');
  const claim = await alice.getMissingSessions([new UserId(BOB)]);
  expect(claim).not.toBeNull();
  await alice.markRequestAsSent(claim!.id, RequestType.KeysClaim, JSON.stringify(server.claim(JSON.parse(claim!.body))));
  const shares = await alice.shareRoomKey(new RoomId(ROOM), [new UserId(ALICE), new UserId(BOB)], settings());
  expect(shares.length).toBeGreaterThan(0);
  for (const req of shares) {
    expect(req.type).toBe(RequestType.ToDevice);
    server.deliver(ALICE, req.event_type, JSON.parse(req.body).messages);
    await alice.markRequestAsSent(req.id, RequestType.ToDevice, '{}');
  }

  // Bob learns Alice's device and receives the room key.
  await bob.updateTrackedUsers([new UserId(ALICE)]);
  await pump(bob, BOB, '2001');
  const processed = await receive(bob, BOB, '2001');
  const decrypted = processed.filter((e) => e.type === ProcessedToDeviceEventType.Decrypted) as DecryptedToDeviceEvent[];
  expect(decrypted).toHaveLength(1);
  expect(JSON.parse(decrypted[0]!.rawEvent).type).toBe('m.room_key');
  expect(decrypted[0]!.encryptionInfo.sender.toString()).toBe(ALICE);
  expect(decrypted[0]!.encryptionInfo.senderCurve25519Key).toBe(alice.identityKeys.curve25519.toBase64());
  expect(decrypted[0]!.encryptionInfo.isSenderVerified()).toBe(false);

  // Alice sends five messages; Bob's history page decrypts them all in one turn.
  const ciphertexts: string[] = [];
  for (let i = 0; i < 5; i++) {
    ciphertexts.push(await alice.encryptRoomEvent(new RoomId(ROOM), 'chat.strafe.message', JSON.stringify({ body: `hello ${i}` })));
  }
  firstCiphertext = ciphertexts[0]!;
  const before = channel.sent.filter((m) => m.includes('"machine.decryptRoomEvents"')).length;
  const results = await Promise.all(ciphertexts.map((c, i) => bob.decryptRoomEvent(roomEvent(c, ALICE, `e${i}`), new RoomId(ROOM), untrusted())));
  const after = channel.sent.filter((m) => m.includes('"machine.decryptRoomEvents"')).length;
  expect(after - before).toBe(1);
  results.forEach((r, i) => {
    expect(JSON.parse(r.event).content.body).toBe(`hello ${i}`);
    expect(r.sender.toString()).toBe(ALICE);
    expect(r.senderDevice?.toString()).toBe('1001');
    expect(typeof r.shieldState(false).color).toBe('number');
  });
});

test('a message from an unknown session rejects with the engine error, alone in its batch', async () => {
  const forged = JSON.parse(firstCiphertext);
  forged.session_id = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  const [bad, good] = await Promise.allSettled([
    bob.decryptRoomEvent(roomEvent(JSON.stringify(forged), ALICE, 'forged'), new RoomId(ROOM), untrusted()),
    bob.decryptRoomEvent(roomEvent(firstCiphertext, ALICE, 'e0'), new RoomId(ROOM), untrusted()),
  ]);
  expect(bad.status).toBe('rejected');
  const err = (bad as PromiseRejectedResult).reason as MegolmDecryptionError;
  expect(err).toBeInstanceOf(MegolmDecryptionError);
  expect(err.code).toBe(DecryptionErrorCode.MissingRoomKey);
  expect(good.status).toBe('fulfilled');
});

test('devices: synchronous snapshot reads, local trust, Olm to-device encryption (call keys)', async () => {
  const devices = await alice.getUserDevices(new UserId(BOB));
  expect(devices.devices()).toHaveLength(1);
  const device = devices.get(new DeviceId('2001'))!;
  expect(device.deviceId.toString()).toBe('2001');
  expect(device.getKey(DeviceKeyAlgorithmName.Ed25519)?.ed25519?.toBase64()).toBe(bob.identityKeys.ed25519.toBase64());
  expect(device.localTrustState).toBe(LocalTrust.Unset);

  await device.setLocalTrust(LocalTrust.Verified);
  expect(device.localTrustState).toBe(LocalTrust.Verified);
  const refetched = (await alice.getUserDevices(new UserId(BOB))).get(new DeviceId('2001'))!;
  expect(refetched.localTrustState).toBe(LocalTrust.Verified);

  // callKeys.sendMediaKey: Olm-encrypt to one device, send as m.room.encrypted.
  const encrypted = await device.encryptToDeviceEvent('chat.strafe.call_key', { room: ROOM, key_index: 3, key: 'a2V5' });
  server.deliver(ALICE, 'm.room.encrypted', { [BOB]: { '2001': JSON.parse(encrypted) } });
  const processed = await receive(bob, BOB, '2001');
  const ev = processed.find((e) => e.type === ProcessedToDeviceEventType.Decrypted) as DecryptedToDeviceEvent;
  const raw = JSON.parse(ev.rawEvent);
  expect(raw.type).toBe('chat.strafe.call_key');
  expect(raw.content).toEqual({ room: ROOM, key_index: 3, key: 'a2V5' });
  expect(ev.encryptionInfo.sender.toString()).toBe(ALICE);
});

test('key backup: prepare in the host, upload, wrong code refused, restore on a new device', async () => {
  const prepared = await prepareKeyBackup();
  expect(prepared.code.replace(/-/g, '')).toMatch(/^[0-9A-Z]{28}$/);
  expect(prepared.publicKey).toMatch(/^[A-Za-z0-9+/]{43}$/);

  mockBackup.machine = alice;
  aliceBackupCode = prepared.code;
  await commitKeyBackup('100', prepared, 'alice-password');
  // Creating a version carries the account password (the server refuses it otherwise).
  expect(mockBackup.passwords).toEqual(['alice-password']);
  const backedUp = mockBackedUpCount();
  expect(backedUp).toBeGreaterThanOrEqual(1);
  expect((await alice.roomKeyCounts()).backedUp).toBe((await alice.roomKeyCounts()).total);
  // This device made the version, so it trusts it without a code.
  expect(await getBackupStatus('100')).toMatchObject({ exists: true, untrusted: false });

  // Alice's second device has no room keys until it restores, and none of the first's storage.
  const alice2 = await OlmMachine.initialize(new UserId(ALICE), new DeviceId('1002'), 'strafe-e2ee-alice2', 'alice2-pass');
  await expect(alice2.decryptRoomEvent(roomEvent(firstCiphertext, ALICE, 'e0'), new RoomId(ROOM), untrusted())).rejects.toBeInstanceOf(MegolmDecryptionError);

  stopBackupSync();
  switchDeviceStorage('alice2');
  mockBackup.machine = alice2;
  // A version made elsewhere is not this device's until the code has opened it.
  expect(await getBackupStatus('100')).toMatchObject({ exists: true, untrusted: true });
  const other = await prepareKeyBackup();
  // Each restore reports its start and its end, so the recovery sheet knows when to close.
  const settled = keyBackupActivity.settled;
  const refused = restoreKeyBackup('100', other.code);
  expect(keyBackupActivity.running).toBe('restore');
  await expect(refused).rejects.toBeInstanceOf(RecoveryCodeMismatchError);
  expect(keyBackupActivity).toMatchObject({ running: null, settled: settled + 1, lastOutcome: 'failed' });
  const imported = await restoreKeyBackup('100', prepared.code);
  expect(imported).toBe(backedUp);
  expect(keyBackupActivity).toMatchObject({ running: null, settled: settled + 2, lastOutcome: 'succeeded', lastImported: backedUp });
  expect(await getBackupStatus('100')).toMatchObject({ untrusted: false });

  const restored = await alice2.decryptRoomEvent(roomEvent(firstCiphertext, ALICE, 'e0'), new RoomId(ROOM), untrusted());
  expect(JSON.parse(restored.event).content.body).toBe('hello 0');
  // Imported keys count as already in this backup version: nothing to re-upload.
  expect(await alice2.backupRoomKeys()).toBeUndefined();
  alice2.close();
  stopBackupSync();
  switchDeviceStorage('alice1');
});

test('key backup: a version this device neither created nor unlocked gets no uploads', async () => {
  // Alice's first device is uploading to the version it created (the test above).
  mockBackup.machine = alice;
  const ours = mockBackup.version!.version;
  // Someone holding her session - or the server - replaces the backup with a key of theirs.
  const theirs = await prepareKeyBackup();
  const replaced = mockReplaceVersion({ public_key: theirs.publicKey, wrapped: theirs.wrapped, salt: theirs.salt });
  noteBackupVersionChanged(); // KEY_BACKUP_UPDATE

  // New room keys on this device...
  await alice.shareRoomKey(new RoomId('!301:a.test'), [new UserId(ALICE), new UserId(BOB)], settings());
  expect((await alice.roomKeyCounts()).total).toBeGreaterThan((await alice.roomKeyCounts()).backedUp);
  // ...go nowhere: the current version has no proof behind it.
  expect(await syncKeyBackup('100')).toBe(0);
  expect(mockBackedUpCount(replaced)).toBe(0);
  expect(await getBackupStatus('100')).toMatchObject({ version: replaced, untrusted: true });
  expect(mockBackup.previous?.version).toBe(ours);
  stopBackupSync();
});

test('key backup: a code that opens only the retained previous version restores from it, uploads nothing', async () => {
  // State from the test above: current = someone else's version, previous = Alice's own.
  const ownVersion = mockBackup.previous!.version;
  const stranger = await prepareKeyBackup();
  const alice3 = await OlmMachine.initialize(new UserId(ALICE), new DeviceId('1003'), 'strafe-e2ee-alice3', 'alice3-pass');
  switchDeviceStorage('alice3');
  mockBackup.machine = alice3;

  // A code that opens neither version is wrong.
  await expect(restoreKeyBackup('100', stranger.code)).rejects.toBeInstanceOf(RecoveryCodeMismatchError);

  // Her real code opens the previous version: its keys come back...
  const imported = await restoreKeyBackup('100', aliceBackupCode);
  expect(imported).toBe(mockBackedUpCount(ownVersion));
  const restored = await alice3.decryptRoomEvent(roomEvent(firstCiphertext, ALICE, 'e0'), new RoomId(ROOM), untrusted());
  expect(JSON.parse(restored.event).content.body).toBe('hello 0');
  // ...but the unconfirmed current version still gets nothing from this device.
  const current = mockBackup.version!.version;
  await alice3.shareRoomKey(new RoomId('!302:a.test'), [new UserId(ALICE)], settings());
  expect(await syncKeyBackup('100')).toBe(0);
  expect(mockBackedUpCount(current)).toBe(0);
  expect(await getBackupStatus('100')).toMatchObject({ version: current, untrusted: true });
  alice3.close();
  stopBackupSync();
  switchDeviceStorage('alice1');
});

test('key backup: a key that opens but is not the published one is a mismatch, not a reason to try the previous version', async () => {
  // The server pairs Alice's own wrapped key with a public key of someone else's.
  const theirs = await prepareKeyBackup();
  const own = mockBackup.previous!;
  mockReplaceVersion({ public_key: theirs.publicKey, wrapped: own.wrapped, salt: own.salt });
  // The previous version is now the forged one's predecessor (someone else's), which her
  // code does not open either - but it must not even be tried: refuse at the first version.
  const alice4 = await OlmMachine.initialize(new UserId(ALICE), new DeviceId('1004'), 'strafe-e2ee-alice4', 'alice4-pass');
  switchDeviceStorage('alice4');
  mockBackup.machine = alice4;
  const reads: string[] = [];
  const devices = jest.requireMock('@web/api/devices') as { getBackupVersion: () => Promise<unknown> };
  const realGetVersion = devices.getBackupVersion;
  devices.getBackupVersion = async () => {
    reads.push('version');
    return realGetVersion();
  };
  try {
    await expect(restoreKeyBackup('100', aliceBackupCode)).rejects.toBeInstanceOf(RecoveryCodeMismatchError);
  } finally {
    devices.getBackupVersion = realGetVersion;
  }
  // The previous version was never looked up, and nothing was pinned.
  expect(reads).toEqual([]);
  expect(await getBackupStatus('100')).toMatchObject({ untrusted: true });
  alice4.close();
  stopBackupSync();
  switchDeviceStorage('alice1');
});

test('key backup: restoring a version made on another device clears this device\'s old marks, so its own keys reach it', async () => {
  // Erin's first device backs up a room key of its own to the version it creates.
  const ERIN = '@600:e.test';
  const erin1 = await OlmMachine.initialize(new UserId(ERIN), new DeviceId('6001'), 'strafe-e2ee-erin1', 'erin1-pass');
  switchDeviceStorage('erin1');
  mockBackup.machine = erin1;
  await erin1.shareRoomKey(new RoomId('!601:e.test'), [new UserId(ERIN)], settings());
  await commitKeyBackup('600', await prepareKeyBackup(), 'erin-password');
  const v1 = mockBackup.version!.version;
  expect(mockBackedUpCount(v1)).toBe(1);
  expect(await erin1.roomKeyCounts()).toMatchObject({ total: 1, backedUp: 1 });
  stopBackupSync();

  // Her second device, with a room key of its own, replaces the backup with a new version.
  const erin2 = await OlmMachine.initialize(new UserId(ERIN), new DeviceId('6002'), 'strafe-e2ee-erin2', 'erin2-pass');
  switchDeviceStorage('erin2');
  mockBackup.machine = erin2;
  await erin2.shareRoomKey(new RoomId('!602:e.test'), [new UserId(ERIN)], settings());
  const second = await prepareKeyBackup();
  await commitKeyBackup('600', second, 'erin-password');
  const v2 = mockBackup.version!.version;
  expect(mockBackedUpCount(v2)).toBe(1);
  erin2.close();
  stopBackupSync();

  // Back on the first device: KEY_BACKUP_UPDATE, then the new code confirms the new version.
  switchDeviceStorage('erin1');
  mockBackup.machine = erin1;
  noteBackupVersionChanged();
  expect(await restoreKeyBackup('600', second.code)).toBe(1);
  // Its own key was marked as backed up to v1, which v2 never received: it is sent now.
  expect(await syncKeyBackup('600')).toBe(1);
  expect(mockBackedUpCount(v2)).toBe(2);
  expect(await erin1.roomKeyCounts()).toMatchObject({ total: 2, backedUp: 2 });
  erin1.close();
  stopBackupSync();
  switchDeviceStorage('alice1');
});

test('engine errors cross with name and message verbatim (the mismatch machine.ts parses)', async () => {
  const d1 = await OlmMachine.initialize(new UserId('@500:d.test'), new DeviceId('5001'), 'strafe-e2ee-dave', 'dave-pass');
  const err = await OlmMachine.initialize(new UserId('@500:d.test'), new DeviceId('5002'), 'strafe-e2ee-dave', 'dave-pass').catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).name).toBe('Error');
  expect((err as Error).message).toContain("doesn't match");
  expect(/expected\s+\S*?:(\d+)(?!\d)/.exec((err as Error).message)?.[1]).toBe('5001');
  // Opening the store closed the machine that held it: never two machines on one store.
  await expect(d1.outgoingRequests()).rejects.toMatchObject({ name: 'CryptoHostMachineClosed' });

  const wrongPass = await OlmMachine.initialize(new UserId('@500:d.test'), new DeviceId('5001'), 'strafe-e2ee-dave', 'not-it').catch((e: Error) => e);
  expect((wrongPass as Error).message).toMatch(/decrypt/i);
});
