/**
 * @jest-environment node
 */
/**
 * The web's own E2EE modules - transport.ts, rooms.ts, service.ts, safety.ts, callKeys.ts -
 * unmodified, with `@matrix-org/matrix-sdk-crypto-wasm` resolved to the facade (as Metro's
 * PACKAGE_OVERRIDES does in the app) and the real engine behind it. Only the HTTP API and
 * the machine registry are faked: a miniature key server routes uploads, claims and
 * to-device messages between two users.
 */
import 'fake-indexeddb/auto';
import { cryptoHost } from '../host';
import { DeviceId, OlmMachine, UserId } from '../matrixSdkCrypto';
import { bootEngine, FakeKeyServer } from './harness';

jest.mock('../../storage', () => {
  const memory = () => {
    const m = new Map<string, unknown>();
    return { set: (k: string, v: unknown) => m.set(k, v), getBoolean: (k: string) => m.get(k), remove: (k: string) => m.delete(k) };
  };
  return { appStorage: memory(), webStorage: memory() };
});

jest.mock('@matrix-org/matrix-sdk-crypto-wasm', () => jest.requireActual('../matrixSdkCrypto'), { virtual: true });

jest.mock('@web/stores/instance', () => ({
  instance: { federationEnabled: false, domain: '' },
  loadInstanceInfo: async () => undefined,
}));

const mockState: { machine: OlmMachine | null; device: string | null } = { machine: null, device: null };
jest.mock('@web/lib/e2ee/machine', () => ({
  getMachine: async () => mockState.machine,
  getCurrentDeviceId: () => mockState.device,
}));

const mockServer = new FakeKeyServer();
const mockUploads: { deviceId: string; body: Record<string, unknown> }[] = [];
const userOfDevice = (deviceId: string) => (deviceId.startsWith('1') ? '@a1:strafe.internal' : '@b2:strafe.internal');
let mockMessageId = 0;
jest.mock('@web/api/devices', () => ({
  uploadKeys: async (deviceId: string, body: Record<string, unknown>) => {
    mockUploads.push({ deviceId, body });
    return mockServer.upload(userOfDevice(deviceId), deviceId, body);
  },
  queryKeys: async (deviceKeys: Record<string, string[]>) => mockServer.query({ device_keys: deviceKeys }),
  claimKeys: async (oneTimeKeys: Record<string, Record<string, string>>) => mockServer.claim({ one_time_keys: oneTimeKeys }),
  sendToDevice: async (eventType: string, _txn: string, senderDeviceId: string, messages: Record<string, Record<string, unknown>>) =>
    mockServer.deliver(userOfDevice(senderDeviceId), eventType, messages),
  pollToDevice: async (deviceId: string) =>
    mockServer.take(userOfDevice(deviceId), deviceId).map((e) => ({
      id: String(++mockMessageId),
      type: e.type,
      sender_user_id: e.sender.slice(1, e.sender.indexOf(':')),
      sender_device_id: '',
      content: e.content,
    })),
  ackToDevice: async () => undefined,
  // has_keys false makes ensureServerHasDeviceKeys rebuild and re-sign the device keys.
  listOwnDevices: async () => [{ device_id: mockState.device, has_keys: false }],
}));

/* eslint-disable import/first */
import { processOutgoingRequests, drainPendingToDevice } from '@web/lib/e2ee/transport';
import { ensureRoomKeyShared, encryptForRoom } from '@web/lib/e2ee/rooms';
import { decryptMessage, ensureServerHasDeviceKeys } from '@web/lib/e2ee/service';
import { clearDeviceVerification, getOwnFingerprint, getPeerDevices, markDeviceVerified } from '@web/lib/e2ee/safety';
import { onIncomingMediaKey, sendMediaKey, type IncomingMediaKey } from '@web/lib/e2ee/callKeys';
import { toMatrixUserId } from '@web/lib/e2ee/constants';
/* eslint-enable import/first */

jest.setTimeout(120_000);

let alice: OlmMachine;
let bob: OlmMachine;

function as(machine: OlmMachine, device: string): OlmMachine {
  mockState.machine = machine;
  mockState.device = device;
  return machine;
}

beforeAll(async () => {
  await bootEngine();
  alice = await OlmMachine.initialize(new UserId(toMatrixUserId('a1')), new DeviceId('1001'), 'strafe-e2ee-a1', 'pa');
  bob = await OlmMachine.initialize(new UserId(toMatrixUserId('b2')), new DeviceId('2001'), 'strafe-e2ee-b2', 'pb');
});

afterAll(() => cryptoHost.resetForTests());

test('transport uploads keys; service rebuilds a correctly signed device-keys claim', async () => {
  await processOutgoingRequests(as(alice, '1001'));
  await processOutgoingRequests(as(bob, '2001'));
  expect(mockServer.otkCount('@a1:strafe.internal', '1001')).toBeGreaterThan(0);

  // Overwrites the engine's own claim with service.ts's rebuilt one (synchronous identityKeys,
  // sign().asJSON()). Bob's engine verifies that signature when it queries Alice below.
  mockUploads.length = 0;
  await ensureServerHasDeviceKeys(as(alice, '1001'), 'a1', '1001');
  const republished = mockUploads.find((u) => u.body.device_keys)?.body.device_keys as Record<string, any>;
  expect(republished.keys['ed25519:1001']).toBe(alice.identityKeys.ed25519.toBase64());
  expect(republished.signatures['@a1:strafe.internal']['ed25519:1001']).toEqual(expect.any(String));
});

test('rooms + service: Alice shares and encrypts, Bob drains to-device and decrypts a page', async () => {
  as(alice, '1001');
  await ensureRoomKeyShared(alice, 'r9', ['a1', 'b2']);
  const ciphertexts = await Promise.all([0, 1, 2].map((i) => encryptForRoom(alice, 'r9', `hi bob ${i}`, { attachments: [{ id: `f${i}` }] })));
  ciphertexts.forEach((c) => expect(c.startsWith('MEGOLM1:')).toBe(true));

  as(bob, '2001');
  await drainPendingToDevice(bob, '2001');
  const createdAt = new Date().toISOString();
  const results = await Promise.all(ciphertexts.map((c, i) => decryptMessage('b2', 'r9', c, { senderId: 'a1', eventId: `m${i}`, createdAt })));
  results.forEach((r, i) => {
    expect(r).toMatchObject({ plaintext: `hi bob ${i}`, legacy: false, pending: false });
    expect(r.content?.attachments).toEqual([{ id: `f${i}` }]);
  });

  // No key for this one (a forged session): the web shows it as pending, not as an error.
  const forged = JSON.parse(ciphertexts[0]!.slice('MEGOLM1:'.length));
  forged.session_id = 'B'.repeat(43);
  const pending = await decryptMessage('b2', 'r9', `MEGOLM1:${JSON.stringify(forged)}`, { senderId: 'a1', eventId: 'mx', createdAt });
  expect(pending).toMatchObject({ pending: true, plaintext: '' });
});

test('callKeys: a media key travels Olm-encrypted and arrives with its authenticated sender', async () => {
  const received: IncomingMediaKey[] = [];
  const stop = onIncomingMediaKey((k) => received.push(k));
  const key = new Uint8Array(32).map((_, i) => i);
  as(alice, '1001');
  await sendMediaKey('a1', { roomId: 'r9', identity: 'a1.session1', keyIndex: 2, key }, ['b2']);
  as(bob, '2001');
  await drainPendingToDevice(bob, '2001');
  stop();
  expect(received).toHaveLength(1);
  expect(received[0]).toMatchObject({ roomId: 'r9', identity: 'a1.session1', keyIndex: 2, senderUserId: 'a1', senderVerified: false });
  expect([...received[0]!.key]).toEqual([...key]);
});

test('safety: fingerprints and local verification through device snapshots', async () => {
  const own = await getOwnFingerprint(bob);
  const seen = await getPeerDevices(alice, 'b2');
  expect(seen).toEqual([{ deviceId: '2001', fingerprint: own, verified: false }]);
  await markDeviceVerified(alice, 'b2', '2001');
  expect((await getPeerDevices(alice, 'b2'))[0]!.verified).toBe(true);
  await clearDeviceVerification(alice, 'b2', '2001');
  expect((await getPeerDevices(alice, 'b2'))[0]!.verified).toBe(false);
});
