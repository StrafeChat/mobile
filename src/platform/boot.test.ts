import {
  API,
  FakeSocket,
  INSTANCE,
  flush,
  reply,
  resetEnv,
  routeFetch,
  storeSession,
  type FetchMock,
} from './boot.testenv';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

type Boot = typeof import('./boot');
type Session = typeof import('./session');
type AuthStore = typeof import('@web/stores/auth');
type Network = { isConnected: boolean | null; isInternetReachable: boolean | null };

const ONLINE: Network = { isConnected: true, isInternetReachable: true };
const OFFLINE: Network = { isConnected: false, isInternetReachable: false };

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
  spaces: [{ id: '100', name: 'A space', owner_id: '1', roles: [] }],
  space_rooms: { '100': [{ id: '200', type: 3, name: 'general', position: 0 }] },
  voice_states: [],
  calls: [],
};

interface App {
  boot: Boot;
  session: Session;
  auth: AuthStore['auth'];
  reloadApp: jest.Mock;
  fetch: FetchMock;
}

function setNetwork(state: Network): void {
  (require('@react-native-community/netinfo') as { __setNetwork(s: Network): void }).__setNetwork(state);
}

function savedAccounts(accounts: unknown[]): void {
  (require('@tauri-apps/api/core') as { __setAccountsFile(f: unknown): void }).__setAccountsFile({
    version: 1,
    active: accounts.length ? ACCOUNT.id : null,
    accounts,
  });
}

function accountsFile(): { accounts: { id: string }[]; active: string | null } {
  return (require('@tauri-apps/api/core') as { __accountsFile(): { accounts: { id: string }[]; active: string | null } }).__accountsFile();
}

async function startApp(fetch: FetchMock, network: Network = ONLINE): Promise<App> {
  (globalThis as unknown as { fetch: unknown }).fetch = fetch;
  setNetwork(network);
  const boot = require('./boot') as Boot;
  const session = require('./session') as Session;
  const { auth } = require('@web/stores/auth') as AuthStore;
  const { reloadApp } = require('@/platform/reload') as { reloadApp: jest.Mock };
  await boot.startApp();
  await flush();
  return { boot, session, auth, reloadApp, fetch };
}

function stored(key: string): string | null {
  return localStorage.getItem(key);
}

function calledPaths(fetch: FetchMock): string[] {
  return fetch.mock.calls.map(([input]) => String(input).replace(API, ''));
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  resetEnv();
  // The web stores log the failed requests these tests make on purpose.
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('restoring a stored session', () => {
  test('starting offline keeps the session and shows the app, then catches up when the network returns', async () => {
    storeSession();
    savedAccounts([ACCOUNT]);
    const app = await startApp(routeFetch({}), OFFLINE);

    // The saved account stands in for READY's user until the instance answers.
    expect(app.auth.user).toMatchObject({ id: '1', username: 'me', display_name: 'Me' });
    FakeSocket.latest().drop();
    await jest.advanceTimersByTimeAsync(0);
    await flush();

    expect(app.boot.bootState()).toBe('ready');
    expect(app.boot.sessionUnsynced()).toBe(true);
    expect(stored('session_token')).toBe('tok-1');
    expect(app.auth.token).toBe('tok-1');
    expect(app.reloadApp).not.toHaveBeenCalled();

    // Back online: the gateway reconnects at once and READY fills everything in.
    setNetwork(ONLINE);
    const socket = FakeSocket.latest();
    expect(FakeSocket.instances.length).toBeGreaterThan(1);
    socket.open();
    socket.receive({ op: 4, d: READY });
    expect(app.boot.bootState()).toBe('ready');
    expect(app.boot.sessionUnsynced()).toBe(false);
    expect(app.auth.hydrated).toBe(true);
  });

  test('a network failure during the REST fallback is not a sign-out', async () => {
    storeSession();
    const app = await startApp(routeFetch({}));
    // The socket stays stuck connecting; READY never comes.
    await jest.advanceTimersByTimeAsync(5_000);
    await flush();
    expect(calledPaths(app.fetch)).toContain('/users/@me');
    expect(app.boot.bootState()).toBe('ready');
    expect(stored('session_token')).toBe('tok-1');
    expect(app.reloadApp).not.toHaveBeenCalled();
  });

  test('a server error during the REST fallback is not a sign-out either', async () => {
    storeSession();
    const app = await startApp(routeFetch({ '/users/@me': () => reply(502, {}) }));
    await jest.advanceTimersByTimeAsync(5_000);
    await flush();
    expect(app.boot.bootState()).toBe('ready');
    expect(stored('session_token')).toBe('tok-1');
    expect(app.reloadApp).not.toHaveBeenCalled();
  });

  test('a 401 from the REST fallback ends the session, says why, and restarts', async () => {
    storeSession();
    savedAccounts([ACCOUNT]);
    const app = await startApp(routeFetch({ '/users/@me': () => reply(401, { error: 'session expired' }) }));
    await jest.advanceTimersByTimeAsync(5_000);
    await flush(10);

    expect(app.reloadApp).toHaveBeenCalled();
    expect(stored('session_token')).toBeNull();
    expect(app.auth.token).toBeNull();
    // The splash stays up until the restart, rather than flashing the sign-in screen.
    expect(app.boot.bootState()).toBe('booting');
    expect(accountsFile().accounts).toEqual([]);
    expect(app.session.takeSignOutNotice()).toMatchObject({ reason: 'expired' });
    expect(app.session.takeSignOutNotice()).toBeNull();
  });

  test('a gateway that refuses the token is noticed without waiting for the fallback', async () => {
    storeSession();
    const app = await startApp(routeFetch({ '/users/@me': () => reply(401, { error: 'session revoked' }) }));
    // A refused upgrade is only a close to a WebSocket.
    FakeSocket.latest().drop();
    await flush(10);
    expect(app.reloadApp).toHaveBeenCalled();
    expect(stored('session_token')).toBeNull();
    expect(app.session.takeSignOutNotice()).toMatchObject({ reason: 'revoked' });
  });

  test('a dropped gateway with a session that is still good changes nothing', async () => {
    storeSession();
    const app = await startApp(routeFetch({ '/users/@me': () => reply(200, ME) }));
    FakeSocket.latest().drop();
    await flush(10);
    expect(calledPaths(app.fetch)).toContain('/users/@me');
    expect(app.reloadApp).not.toHaveBeenCalled();
    expect(stored('session_token')).toBe('tok-1');
  });

  test('the REST fallback restores our own presence as we see it: invisible, with the game a desktop reports', async () => {
    storeSession();
    const game = { type: 'playing', name: 'Hades', started_at: 1_761_000_000_000 };
    const app = await startApp(
      routeFetch({
        '/users/@me': () => reply(200, { ...ME, presence: { status: 'invisible', custom_status: 'brb', activities: [game] } }),
        '/rooms': () => reply(200, []),
        '/users/@me/relationships': () => reply(200, []),
        '/spaces': () => reply(200, []),
      }),
    );
    // The socket stays stuck connecting; READY never comes.
    await jest.advanceTimersByTimeAsync(5_000);
    await flush(10);
    expect(app.auth.hydrated).toBe(true);
    const { presence } = require('@web/stores/presence') as typeof import('@web/stores/presence');
    expect(presence.byUser['1']).toEqual({ status: 'invisible', custom_status: 'brb', activities: [game] });
  });

  test('READY hydrates the stores and subscribes the user, the spaces and their channels', async () => {
    storeSession();
    const app = await startApp(routeFetch({}));
    const socket = FakeSocket.latest();
    expect(socket.url).toBe('wss://chat.example.org/gateway/events?token=tok-1');
    expect(app.boot.bootState()).toBe('booting');
    socket.open();
    socket.receive({ op: 4, d: READY });
    expect(app.boot.bootState()).toBe('ready');
    expect(app.auth.user).toMatchObject(ME);
    expect(socket.sent).toEqual(
      expect.arrayContaining([
        { op: 1, d: { user_id: '1' } },
        { op: 1, d: { space_id: '100' } },
        { op: 1, d: { space_id: '200' } },
      ]),
    );
  });
});

describe('re-asserting subscriptions', () => {
  const subscribes = (socket: FakeSocket) => socket.sent.filter((f) => f.op === 1);

  test('a fresh sign-in subscribes each channel once: READY spaces are not "joined"', async () => {
    localStorage.setItem('strafe.desktop.instance', JSON.stringify(INSTANCE));
    const app = await startApp(routeFetch({}));
    // Sets `hydrated` before READY, with no spaces yet: the case that used to re-assert
    // every subscription twice (a 4403 storm, since upstream resubscribeAll mangles ids).
    app.session.finishSignIn({ token: 'tok-2', user: ME });
    const socket = FakeSocket.latest();
    socket.open();
    socket.receive({ op: 4, d: READY });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(subscribes(socket)).toEqual([
      { op: 1, d: { user_id: '1' } },
      { op: 1, d: { space_id: '100' } },
      { op: 1, d: { space_id: '200' } },
    ]);
  });

  test('a space joined mid-session gets its subscriptions re-asserted', async () => {
    storeSession();
    await startApp(routeFetch({}));
    const socket = FakeSocket.latest();
    socket.open();
    socket.receive({ op: 4, d: READY });
    const before = subscribes(socket).length;
    const { addOrUpdateSpace } = require('@web/stores/spaces') as typeof import('@web/stores/spaces');
    addOrUpdateSpace({ id: '101', name: 'Joined', owner_id: '2' } as never);
    await jest.advanceTimersByTimeAsync(5_000);
    // The new space itself, then two rounds of resubscribeAll over everything held.
    expect(subscribes(socket).length).toBeGreaterThan(before + 2);
    expect(subscribes(socket)).toContainEqual({ op: 1, d: { space_id: '101' } });
  });
});

describe('noticing that a session ended', () => {
  async function readyApp(fetch: FetchMock): Promise<App & { socket: FakeSocket }> {
    storeSession();
    savedAccounts([ACCOUNT]);
    const app = await startApp(fetch);
    const socket = FakeSocket.latest();
    socket.open();
    socket.receive({ op: 4, d: READY });
    await flush();
    return { ...app, socket };
  }

  test('a 401 that is not about the session (a wrong password) is checked and ignored', async () => {
    const fetch = routeFetch({
      '/users/@me': () => reply(200, ME),
      '/users/@me/2fa/totp/disable': () => reply(401, { error: 'invalid password', code: 'invalid_password' }),
    });
    const app = await readyApp(fetch);
    const { api } = require('@web/api/client') as typeof import('@web/api/client');
    jest.advanceTimersByTime(31_000);
    await expect(api('/users/@me/2fa/totp/disable', { method: 'POST', json: { password: 'x' } })).rejects.toMatchObject({
      status: 401,
    });
    await flush(10);
    expect(calledPaths(fetch).filter((p) => p === '/users/@me')).toHaveLength(1);
    expect(app.reloadApp).not.toHaveBeenCalled();
    expect(stored('session_token')).toBe('tok-1');
  });

  test('a 401 from any call, confirmed by the server, ends an expired session', async () => {
    const fetch = routeFetch({
      '/users/@me': () => reply(401, { error: 'session expired' }),
      '/rooms/9/ack': () => reply(401, { error: 'session expired' }),
    });
    const app = await readyApp(fetch);
    jest.advanceTimersByTime(31_000);
    const { ackRoom } = require('@web/api/rooms') as typeof import('@web/api/rooms');
    await ackRoom('9', '10').catch(() => undefined);
    await flush(10);
    expect(app.reloadApp).toHaveBeenCalled();
    expect(app.session.takeSignOutNotice()).toMatchObject({ reason: 'expired' });
  });

  test('SESSION_REVOKED from the gateway signs out with its reason', async () => {
    const app = await readyApp(routeFetch({}));
    app.socket.receive({ op: 3, d: { t: 'SESSION_REVOKED', user_id: '1', d: { reason: 'banned' } } });
    await flush(10);
    expect(stored('session_token')).toBeNull();
    expect(app.reloadApp).toHaveBeenCalled();
    expect(app.session.takeSignOutNotice()).toMatchObject({ reason: 'banned' });
  });

  test('signing out tells the server, forgets the account and restarts, with no notice', async () => {
    const fetch = routeFetch({ '/auth/logout': () => reply(200, { ok: true }) });
    const app = await readyApp(fetch);
    await app.session.signOut();
    await flush(10);
    const logoutCall = fetch.mock.calls.find(([input]) => String(input) === `${API}/auth/logout`);
    expect(logoutCall?.[1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer tok-1' } });
    expect(stored('session_token')).toBeNull();
    expect(accountsFile().accounts).toEqual([]);
    expect(app.reloadApp).toHaveBeenCalled();
    expect(app.session.takeSignOutNotice()).toBeNull();
  });

  test('signing out offline still signs out locally', async () => {
    const app = await readyApp(routeFetch({}));
    await app.session.signOut();
    await flush(10);
    expect(stored('session_token')).toBeNull();
    expect(app.reloadApp).toHaveBeenCalled();
  });
});

describe('start-up states', () => {
  test('no stored session: signed out, and a sign-in connects', async () => {
    localStorage.setItem('strafe.desktop.instance', JSON.stringify(INSTANCE));
    const app = await startApp(routeFetch({}));
    expect(app.boot.bootState()).toBe('signed-out');
    expect(FakeSocket.instances).toHaveLength(0);
    app.session.finishSignIn({ token: 'tok-2', user: ME });
    expect(app.boot.bootState()).toBe('ready');
    expect(stored('session_token')).toBe('tok-2');
    expect(FakeSocket.latest().url).toContain('token=tok-2');
  });

  test('a second factor is asked for, without passkeys', async () => {
    const app = await startApp(routeFetch({}));
    expect(app.session.finishSignIn({ mfa_required: true, mfa_token: 'm', methods: ['webauthn', 'totp'] })).toEqual({
      kind: 'second-factor',
      mfaToken: 'm',
      methods: ['totp'],
    });
    expect(app.boot.bootState()).toBe('signed-out');
  });

  test('a token with no known instance is dropped, never sent to a default server', async () => {
    localStorage.setItem('session_token', 'orphan');
    const app = await startApp(routeFetch({}));
    expect(stored('session_token')).toBeNull();
    expect(app.boot.bootState()).toBe('signed-out');
    expect(FakeSocket.instances).toHaveLength(0);
  });

  test("a token is sent to its own account's instance even if another one was selected", async () => {
    localStorage.setItem('session_token', 'tok-1');
    localStorage.setItem(
      'strafe.desktop.instance',
      JSON.stringify({ domain: 'elsewhere.example', apiUrl: 'https://elsewhere.example/api', stargateUrl: 'wss://elsewhere.example/gateway/events' }),
    );
    savedAccounts([ACCOUNT]);
    await startApp(routeFetch({}));
    expect(FakeSocket.latest().url.startsWith('wss://chat.example.org/')).toBe(true);
  });

  test('an account whose sign-out was cut short by the restart is removed at the next start', async () => {
    savedAccounts([ACCOUNT]);
    const { appStorage } = require('@/platform/storage') as { appStorage: { set(k: string, v: string): void } };
    appStorage.set('session.ended', JSON.stringify({ reason: 'expired', accountId: ACCOUNT.id, at: 1 }));
    const app = await startApp(routeFetch({}));
    expect(accountsFile().accounts).toEqual([]);
    expect(app.session.peekSignOutNotice()).toMatchObject({ reason: 'expired' });
  });
});
