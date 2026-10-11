/**
 * The app-side host client against a scripted page: boot order (wipe before the engine),
 * the ready gate, timeouts, verbatim errors, page reloads and the crash-loop guard.
 */
import { CryptoHostClient, cryptoHost, type HostBoot } from '../host';
import { DecryptionSettings, DeviceId, MegolmDecryptionError, OlmMachine, RoomId, TrustRequirement, UserId } from '../matrixSdkCrypto';
import { CryptoHostCrashedError, CryptoHostRestartedError, CryptoHostTimeoutError, CryptoHostUnavailableError } from '../errors';
import { PROTOCOL_VERSION, type CallMessage } from '../protocol';

jest.mock('../../storage', () => ({ appStorage: { set: jest.fn(), getBoolean: jest.fn(), remove: jest.fn() } }));

/** A page that records calls and answers them the way the test says. */
function scriptedPage(client: CryptoHostClient) {
  const calls: CallMessage[] = [];
  let answer: (msg: CallMessage) => { ok: boolean; value?: unknown; error?: { name: string; message: string; data?: Record<string, unknown> } } | null = (msg) => {
    if (msg.method === 'host.wasmFinish') {
      return { ok: true, value: { versions: { vodozemac: '0', matrix_sdk_crypto: '0', git_sha: '', git_description: '' }, encryptionSettingsDefaults: {} } };
    }
    return { ok: true, value: null };
  };
  const page = {
    calls,
    setAnswer(fn: typeof answer) {
      answer = fn;
    },
    post(raw: string) {
      const msg = JSON.parse(raw) as CallMessage;
      calls.push(msg);
      const res = answer(msg);
      if (res) setTimeout(() => client.receive(JSON.stringify({ t: 'result', id: msg.id, ...res })), 0);
    },
    hello(protocol = PROTOCOL_VERSION) {
      client.receive(JSON.stringify({ t: 'hello', protocol }));
    },
  };
  return page;
}

function boot(overrides: Partial<HostBoot> = {}): HostBoot {
  return {
    loadWasmBase64: async () => 'AAECAwQF', // 6 bytes
    takeWipe: () => false,
    restoreWipe: jest.fn(),
    ...overrides,
  };
}

test('boots: queued engine calls wait for the wasm, housekeeping goes first, a wipe precedes everything', async () => {
  const client = new CryptoHostClient();
  const page = scriptedPage(client);
  client.attach({ post: (m) => page.post(m) }, boot({ takeWipe: () => true }));
  const early = client.call('machine.isBackupEnabled', { handle: 1 });
  page.hello();
  await client.whenReady();
  await early;
  expect(page.calls.map((c) => c.method)).toEqual(['host.wipeStorage', 'host.wasmChunk', 'host.wasmFinish', 'machine.isBackupEnabled']);
  expect(page.calls[1]!.params).toEqual({ offset: 0, total: 6, data: 'AAECAwQF' });
  expect(client.state).toBe('ready');
});

test('a failed wipe is put back for the next start', async () => {
  const client = new CryptoHostClient();
  const page = scriptedPage(client);
  const b = boot({ takeWipe: () => true });
  page.setAnswer((msg) => (msg.method === 'host.wipeStorage' ? { ok: false, error: { name: 'Error', message: 'cannot enumerate' } } : { ok: true, value: null }));
  client.attach({ post: (m) => page.post(m) }, b);
  page.hello();
  await expect(client.whenReady()).rejects.toBeInstanceOf(CryptoHostUnavailableError);
  expect(b.restoreWipe).toHaveBeenCalled();
});

test('errors arrive with name and message verbatim', async () => {
  const client = new CryptoHostClient();
  const page = scriptedPage(client);
  client.attach({ post: (m) => page.post(m) }, boot());
  page.hello();
  await client.whenReady();
  const message = "the account in the store doesn't match the account in the constructor: expected @1:x:111, got @1:x:222";
  page.setAnswer(() => ({ ok: false, error: { name: 'Error', message } }));
  await expect(client.call('machine.initialize', { userId: '@1:x', deviceId: '222' })).rejects.toMatchObject({ name: 'Error', message });
});

test('a silent page times the call out', async () => {
  const client = new CryptoHostClient();
  const page = scriptedPage(client);
  client.attach({ post: (m) => page.post(m) }, boot());
  page.hello();
  await client.whenReady();
  page.setAnswer(() => null);
  await expect(client.call('machine.isBackupEnabled', { handle: 1 }, { timeoutMs: 20 })).rejects.toBeInstanceOf(CryptoHostTimeoutError);
});

test('a page reload ends the page life: in-flight calls fail, bound calls are refused, listeners hear it', async () => {
  const client = new CryptoHostClient();
  const page = scriptedPage(client);
  client.attach({ post: (m) => page.post(m) }, boot());
  page.hello();
  await client.whenReady();
  const generation = client.generation;
  const restarted = jest.fn();
  client.onRestart(restarted);
  page.setAnswer(() => null);
  const inFlight = client.call('machine.isBackupEnabled', { handle: 1 }, { generation });
  page.setAnswer((msg) =>
    msg.method === 'host.wasmFinish' ? { ok: true, value: { versions: {}, encryptionSettingsDefaults: {} } } : { ok: true, value: null },
  );
  page.hello(); // reloaded under us
  await expect(inFlight).rejects.toBeInstanceOf(CryptoHostCrashedError);
  expect(restarted).toHaveBeenCalledTimes(1);
  await expect(client.call('machine.isBackupEnabled', { handle: 1 }, { generation })).rejects.toBeInstanceOf(CryptoHostRestartedError);
  await client.whenReady();
  expect(client.generation).toBeGreaterThan(generation);
});

test('a page that speaks another protocol is refused', async () => {
  const client = new CryptoHostClient();
  const page = scriptedPage(client);
  client.attach({ post: (m) => page.post(m) }, boot());
  page.hello(PROTOCOL_VERSION + 1);
  await expect(client.whenReady()).rejects.toBeInstanceOf(CryptoHostUnavailableError);
  await expect(client.call('host.ping', {})).rejects.toBeInstanceOf(CryptoHostUnavailableError);
});

test('it stops restarting a host that keeps crashing', () => {
  const client = new CryptoHostClient();
  const page = scriptedPage(client);
  client.attach({ post: (m) => page.post(m) }, boot());
  const results = Array.from({ length: 5 }, () => client.crashed('renderer killed'));
  expect(results).toEqual([true, true, true, true, false]);
  expect(client.state).toBe('failed');
});

test('a decrypt failure comes back as MegolmDecryptionError even under a minified class name', async () => {
  // The engine throws it as a non-Error whose constructor name is all the page can report;
  // a page bundle built without keepNames reported it as 'We', and it arrived as a bare Error.
  const page = scriptedPage(cryptoHost);
  page.setAnswer((msg) => {
    if (msg.method === 'host.wasmFinish') return { ok: true, value: { versions: {}, encryptionSettingsDefaults: {} } };
    if (msg.method === 'machine.initialize') {
      return { ok: true, value: { handle: 1, userId: '@1:x', deviceId: '11', identityKeys: { ed25519: 'e', curve25519: 'c' }, deviceCreationTimeMs: 0 } };
    }
    if (msg.method === 'machine.decryptRoomEvents') {
      return { ok: true, value: [{ ok: false, error: { name: 'We', message: 'Can\'t find the room key', data: { code: 0, withheldCode: 'm.unverified' } } }] };
    }
    return { ok: true, value: null };
  });
  const detach = cryptoHost.attach({ post: (m) => page.post(m) }, boot());
  try {
    page.hello();
    await cryptoHost.whenReady();
    const machine = await OlmMachine.initialize(new UserId('@1:x'), new DeviceId('11'));
    const err = await machine.decryptRoomEvent('{}', new RoomId('!r:x'), new DecryptionSettings(TrustRequirement.Untrusted)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MegolmDecryptionError);
    expect(err).toMatchObject({ code: 0, withheldCode: 'm.unverified', message: "Can't find the room key" });
  } finally {
    detach();
    cryptoHost.resetForTests();
  }
});
