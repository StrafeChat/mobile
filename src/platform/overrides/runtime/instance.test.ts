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
    // Resolved, so the sign-in forms render - with the defaults, but never as `loaded`: that
    // means the instance answered, and the E2EE identity is named from the answer. (This used
    // to expect `loaded` here, as the web store then set it on a failure - the very thing the
    // web fixed: a device provisioned under the no-federation name.)
    expect(m.instance.loaded).toBe(false);
    expect(m.instance.domain).toBe('');
    expect(m.instance.version).toBe('');
    expect(m.instanceInfoFailed()).toBe(true);
    await m.loadInstanceInfo();
    expect(m.instance).toMatchObject({ loaded: true, domain: 'chat.example.org' });
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
    // Nor may anything that checks rather than waits take the defaults for the answer.
    expect(m.instance.loaded).toBe(false);
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
    expect(m.instance).toMatchObject({ loaded: true, domain: 'chat.example.org' });
    // Once it has answered there is nothing to retry.
    m.retryInstanceInfoNow();
    await flush(10);
    expect(fetch).toHaveBeenCalledTimes(2);
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

  test("a slow answer from the previous instance does not stand in for the new one's", async () => {
    const OLD = { strafe: { version: '0.9' }, federation: { enabled: true, domain: 'old.example' }, features: { invite_only: { enabled: true } } };
    let answerOld: (r: ReturnType<typeof reply>) => void = () => undefined;
    let calls = 0;
    const fetch = routeFetch({
      '/': () => {
        calls += 1;
        if (calls === 1) return new Promise((resolve) => (answerOld = resolve));
        return reply(200, INDEX);
      },
    });
    const m = load(fetch);
    const first = m.loadInstanceInfo();
    await flush(10);
    expect(m.instanceVersion()).toBe('');
    // The person picked another instance while the first one's GET / was still out.
    m.resetInstanceInfo();
    await m.loadInstanceInfo();
    expect(m.instance.domain).toBe('chat.example.org');
    answerOld(reply(200, OLD));
    await first;
    await flush(20);
    // The old answer landed in the store; the new instance is read again over it.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(m.instance).toMatchObject({ domain: 'chat.example.org', inviteOnly: false, loaded: true });
    expect(m.instanceVersion()).toBe('1.2.3');
    expect(m.instanceInfoFailed()).toBe(false);
  });

  test("the previous instance's late answer is not taken for the new one's after it failed", async () => {
    const OLD = { strafe: { version: '0.9' }, federation: { enabled: true, domain: 'old.example' }, features: { invite_only: { enabled: true } } };
    let answerOld: (r: ReturnType<typeof reply>) => void = () => undefined;
    let calls = 0;
    const fetch = routeFetch({
      '/': () => {
        calls += 1;
        if (calls === 1) return new Promise((resolve) => (answerOld = resolve));
        throw new TypeError('Network request failed');
      },
    });
    const m = load(fetch);
    const first = m.loadInstanceInfo();
    await flush(10);
    m.resetInstanceInfo();
    await m.loadInstanceInfo();
    expect(m.instanceInfoFailed()).toBe(true);
    answerOld(reply(200, OLD));
    await first;
    await flush(20);
    // The old answer set `loaded` in the web store; it is not this instance's, so it goes.
    expect(m.instance).toMatchObject({ loaded: false, domain: '', federationEnabled: false, inviteOnly: false, version: '' });
    expect(m.instanceInfoFailed()).toBe(true);
    // And the next call still asks.
    await m.loadInstanceInfo();
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
