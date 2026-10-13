/**
 * The session module against a faked device and instance (boot.testenv): an instance is
 * never chosen under a stored session, and "log out everywhere" only signs this device out
 * once the instance has confirmed it.
 */
import { API, FakeSocket, INSTANCE, flush, reply, resetEnv, routeFetch, storeSession, until, type FetchMock } from './boot.testenv';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

type Boot = typeof import('./boot');
type Session = typeof import('./session');

const ME = { id: '1', username: 'me', display_name: 'Me' };
const ACCOUNT = {
  id: 'chat.example.org:1',
  instance: INSTANCE,
  token: 'tok-1',
  userId: '1',
  username: 'me',
  displayName: 'Me',
  addedAt: 1,
  lastUsedAt: 1,
};
const READY = {
  user: { ...ME, discriminator: 0 },
  session_id: 's-1',
  rooms: [],
  relationships: [],
  spaces: [],
  space_rooms: {},
  voice_states: [],
  calls: [],
};
const EVIL_WELL_KNOWN = 'https://evil.example/.well-known/strafe';
const EVIL_DOC = { domain: 'evil.example', api_url: 'https://evil.example/api' };

function savedAccounts(accounts: unknown[]): void {
  (require('@tauri-apps/api/core') as { __setAccountsFile(f: unknown): void }).__setAccountsFile({
    version: 1,
    active: accounts.length ? ACCOUNT.id : null,
    accounts,
  });
}

function accountsFile(): { accounts: { id: string }[] } {
  return (require('@tauri-apps/api/core') as { __accountsFile(): { accounts: { id: string }[] } }).__accountsFile();
}

function calledUrls(fetch: FetchMock): string[] {
  return fetch.mock.calls.map(([input]) => String(input));
}

function storedInstance(): { domain?: string } | null {
  const raw = localStorage.getItem('strafe.desktop.instance');
  return raw ? (JSON.parse(raw) as { domain?: string }) : null;
}

interface App {
  session: Session;
  reloadApp: jest.Mock;
  leavingHook: jest.Mock<(id: string, opts: { server: boolean }) => Promise<void>>;
}

/**
 * A signed-in app that has had READY, with an account-leaving hook to watch. Signed in as
 * ACCOUNT, read from the faked accounts file - the entry signing out has to remove there.
 */
async function readyApp(fetch: FetchMock): Promise<App> {
  storeSession();
  savedAccounts([ACCOUNT]);
  (globalThis as unknown as { fetch: unknown }).fetch = fetch;
  const boot = require('./boot') as Boot;
  const session = require('./session') as Session;
  const { auth } = require('@web/stores/auth') as typeof import('@web/stores/auth');
  const { invoke } = require('@tauri-apps/api/core') as { invoke: jest.Mock };
  const { reloadApp } = require('@/platform/reload') as { reloadApp: jest.Mock };
  await boot.startApp();
  // The list came from the faked file, not from the app's own storage (see the mock's note in
  // boot.testenv): READY alone would make an account active, one the file never had.
  expect(invoke).toHaveBeenCalledWith('desktop_accounts_load');
  await until(() => session.activeAccountId() === ACCOUNT.id, 'the saved account being the active one');
  await until(() => FakeSocket.instances.length > 0, 'the gateway connecting');
  const socket = FakeSocket.latest();
  socket.open();
  socket.receive({ op: 4, d: READY });
  await until(() => auth.hydrated, 'READY');
  const leavingHook = jest.fn(async (_id: string, _opts: { server: boolean }) => undefined);
  session.setAccountLeavingHook(leavingHook);
  return { session, reloadApp, leavingHook };
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

describe('choosing an instance', () => {
  test('refused while a session is stored, even one start-up has not restored yet', async () => {
    // A cold start: the token is in storage, auth.token is not set until hydrateAuth().
    storeSession();
    const fetch = routeFetch({ [EVIL_WELL_KNOWN]: () => reply(200, EVIL_DOC) });
    (globalThis as unknown as { fetch: unknown }).fetch = fetch;
    const session = require('./session') as Session;
    expect(session.hasStoredSession()).toBe(true);
    await expect(session.chooseInstance('evil.example')).rejects.toThrow(/session is active/);
    expect(fetch).not.toHaveBeenCalled();
    expect(storedInstance()?.domain).toBe('chat.example.org');
  });

  test('a session stored while the lookup ran is not moved either', async () => {
    localStorage.setItem('strafe.desktop.instance', JSON.stringify(INSTANCE));
    const fetch = routeFetch({
      [EVIL_WELL_KNOWN]: () => {
        localStorage.setItem('session_token', 'tok-late');
        return reply(200, EVIL_DOC);
      },
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fetch;
    const session = require('./session') as Session;
    await expect(session.chooseInstance('evil.example')).rejects.toThrow(/session is active/);
    expect(storedInstance()?.domain).toBe('chat.example.org');
  });

  test('signed out, it switches', async () => {
    const fetch = routeFetch({ [EVIL_WELL_KNOWN]: () => reply(200, EVIL_DOC) });
    (globalThis as unknown as { fetch: unknown }).fetch = fetch;
    const session = require('./session') as Session;
    expect(session.hasStoredSession()).toBe(false);
    await expect(session.chooseInstance('evil.example')).resolves.toMatchObject({ domain: 'evil.example' });
    expect(storedInstance()?.domain).toBe('evil.example');
  });
});

describe('log out everywhere', () => {
  test('once the instance confirms, this device signs out too', async () => {
    const fetch = routeFetch({ '/auth/logout_all': () => reply(200, { ok: true }) });
    const app = await readyApp(fetch);
    await app.session.signOut({ everywhere: true });
    await flush(10);
    const call = fetch.mock.calls.find(([input]) => String(input) === `${API}/auth/logout_all`);
    expect(call?.[1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer tok-1' } });
    expect(localStorage.getItem('session_token')).toBeNull();
    expect(accountsFile().accounts).toEqual([]);
    expect(app.reloadApp).toHaveBeenCalled();
    // The instance drops the push subscription of every session it ended.
    expect(app.leavingHook).toHaveBeenCalledWith(ACCOUNT.id, { server: false });
    expect(app.session.takeSignOutNotice()).toBeNull();
  });

  test.each([
    ['offline', routeFetch({})],
    ['a server error', routeFetch({ '/auth/logout_all': () => reply(500, { error: 'internal' }) })],
  ])('%s: rejects and leaves this session as it was, to try again', async (_name, fetch) => {
    const app = await readyApp(fetch);
    await expect(app.session.signOut({ everywhere: true })).rejects.toBeTruthy();
    await flush(10);
    expect(localStorage.getItem('session_token')).toBe('tok-1');
    expect(accountsFile().accounts.map((a) => a.id)).toEqual([ACCOUNT.id]);
    expect(app.reloadApp).not.toHaveBeenCalled();
    expect(app.leavingHook).not.toHaveBeenCalled();
    expect(app.session.isLeavingSession()).toBe(false);
    expect(calledUrls(fetch)).not.toContain(`${API}/auth/logout`);
  });

  test('an instance that never answers fails it after a while instead of hanging', async () => {
    const fetch = routeFetch({
      '/auth/logout_all': (init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    });
    const app = await readyApp(fetch);
    const out = app.session.signOut({ everywhere: true });
    const settled = expect(out).rejects.toThrow('aborted');
    jest.advanceTimersByTime(15_000);
    await settled;
    expect(localStorage.getItem('session_token')).toBe('tok-1');
    expect(app.reloadApp).not.toHaveBeenCalled();
  });

  test('a session the server had already ended signs out as ended, with its reason', async () => {
    const fetch = routeFetch({
      '/auth/logout_all': () => reply(401, { error: 'session revoked' }),
      '/users/@me': () => reply(401, { error: 'session revoked' }),
    });
    const app = await readyApp(fetch);
    await app.session.signOut({ everywhere: true });
    await flush(10);
    expect(localStorage.getItem('session_token')).toBeNull();
    expect(app.reloadApp).toHaveBeenCalled();
    expect(app.session.takeSignOutNotice()).toMatchObject({ reason: 'revoked' });
  });
});
