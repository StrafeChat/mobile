import { API, flush, reply, resetEnv, routeFetch, storeSession, type FetchMock } from '../../boot.testenv';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

type InstanceOverride = typeof import('./instance');

const INDEX = {
  strafe: { version: '1.2.3' },
  federation: { enabled: true, domain: 'chat.example.org' },
  features: { voice: { enabled: true }, email: { enabled: true, verification_required: false } },
};

function load(fetch: FetchMock): InstanceOverride {
  (globalThis as unknown as { fetch: unknown }).fetch = fetch;
  localStorage.setItem('strafe.desktop.instance', JSON.stringify({ domain: 'chat.example.org', apiUrl: API, stargateUrl: 'wss://x' }));
  return require('./instance') as InstanceOverride;
}

/** GET / fails `failures` times, then answers. */
function flakyIndex(failures: number): FetchMock {
  let left = failures;
  return routeFetch({
    '/': () => {
      if (left-- > 0) throw new TypeError('Network request failed');
      return reply(200, INDEX);
    },
  });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  resetEnv();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('loadInstanceInfo (mobile)', () => {
  test('fills the web store from GET /, once', async () => {
    const fetch = flakyIndex(0);
    const m = load(fetch);
    await m.loadInstanceInfo();
    await m.loadInstanceInfo();
    expect(m.instance).toMatchObject({ loaded: true, version: '1.2.3', federationEnabled: true, domain: 'chat.example.org', voiceEnabled: true });
    expect(m.instanceInfoFailed()).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test('signed out, a failure resolves with the defaults (the forms render) and is not sticky', async () => {
    const m = load(flakyIndex(1));
    await m.loadInstanceInfo();
    expect(m.instance.loaded).toBe(true);
    expect(m.instance.domain).toBe('');
    expect(m.instance.version).toBe('');
    expect(m.instanceInfoFailed()).toBe(true);
    // The web store would never ask again; here the next call does.
    await m.loadInstanceInfo();
    expect(m.instance.domain).toBe('chat.example.org');
    expect(m.instanceInfoFailed()).toBe(false);
  });

  test('signed in, it waits for the instance rather than resolve without its domain', async () => {
    storeSession();
    const m = load(flakyIndex(2));
    let resolved = false;
    void m.loadInstanceInfo().then(() => {
      resolved = true;
    });
    await flush(10);
    // The E2EE engine awaits this before naming the account's identity: it must not go on
    // with the pre-federation default.
    expect(resolved).toBe(false);
    expect(m.instance.domain).toBe('');
    expect(m.instanceInfoFailed()).toBe(true);
    await jest.advanceTimersByTimeAsync(2_000);
    expect(resolved).toBe(false);
    await jest.advanceTimersByTimeAsync(4_000);
    await flush(10);
    expect(resolved).toBe(true);
    expect(m.instance.domain).toBe('chat.example.org');
  });

  test('a waiting retry goes at once when the network returns', async () => {
    storeSession();
    const m = load(flakyIndex(1));
    let resolved = false;
    void m.loadInstanceInfo().then(() => {
      resolved = true;
    });
    await flush(10);
    expect(resolved).toBe(false);
    (globalThis as unknown as { dispatchEvent(ev: { type: string }): boolean }).dispatchEvent({ type: 'online' });
    // No timer moves: only the event can have woken it.
    await flush(50);
    expect(resolved).toBe(true);
  });

  test('retryInstanceInfoNow asks again after a signed-out failure', async () => {
    const fetch = flakyIndex(1);
    const m = load(fetch);
    await m.loadInstanceInfo();
    expect(m.instanceInfoFailed()).toBe(true);
    m.retryInstanceInfoNow();
    await flush(10);
    expect(m.instanceInfoFailed()).toBe(false);
    expect(m.instance.domain).toBe('chat.example.org');
  });

  test('resetInstanceInfo makes the next load ask the newly chosen instance', async () => {
    const fetch = flakyIndex(0);
    const m = load(fetch);
    await m.loadInstanceInfo();
    m.resetInstanceInfo();
    expect(m.instance.loaded).toBe(false);
    await m.loadInstanceInfo();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
