/**
 * The session's lifecycle: which instance, signing in, switching and adding accounts,
 * signing out, and noticing that the server has ended a session.
 *
 * Accounts are the desktop app's (web/src/desktop/accounts.ts, reused as-is: its invoke()
 * calls are answered by overrides/packages/tauri-core.ts, tokens in the OS keystore). The
 * active session is still the web client's: the token in localStorage, which every API
 * call reads, and the instance in desktop/instanceOverride, which runtimeConfig reads.
 *
 * What this adds to the web client, deliberately:
 * - **Only a definitive 401 ends a session.** The web's READY fallback (bootstrapFromRest)
 *   deletes the token when GET /users/@me fails for any reason, so a phone that starts
 *   offline would be signed out. restoreFromRest() keeps the token unless the server says
 *   401, and a 401 from any other endpoint is confirmed against /users/@me first: several
 *   (a wrong password when turning off 2FA) answer 401 for reasons that are not the
 *   session.
 * - **Expiry is noticed.** Sessions have a fixed lifetime and no refresh. On the web an
 *   expired token fails every call and leaves the gateway "Reconnecting..." forever (its
 *   401 comes at the HTTP upgrade, which a WebSocket cannot read). Here a 401 from any API
 *   call, or a gateway that keeps failing, is checked, and a dead session ends with a
 *   reason the sign-in screen shows.
 * - **Signing out tells the server** (POST /auth/logout; the web never calls it) and then
 *   restarts the JS (reloadApp), like every other session change: the stores, the
 *   gateway, the E2EE engine and the voice session belong to one account, and the web's
 *   logout() leaves most of them populated.
 * - **An account leaving the device takes its push registration with it**: the instance
 *   is told to stop pushing here while the session can still say so, and the account's
 *   push keys and notifications go (setAccountLeavingHook: the push lifecycle installs
 *   push/registration.ts forgetPushAccount, so this module does not load push itself).
 */
import Constants from 'expo-constants';
import { createComputed, createEffect, createRoot, createSignal } from 'solid-js';
import { api } from '@web/api/client';
import { isApiError } from '@web/api/ApiError';
import { isMFAChallenge, type LoginResponse, type LoginResult } from '@web/api/auth';
import { getMe, toAuthUser } from '@web/api/users';
import {
  activeDesktopAccount,
  activeDesktopAccountId,
  beginAddDesktopAccount,
  desktopAccounts,
  lastDesktopInstance,
  removeDesktopAccount,
  sortedDesktopAccounts,
  switchDesktopAccount,
  type DesktopAccount,
} from '@web/desktop/accounts';
import { resolveInstance } from '@web/desktop/instance';
import { getDesktopInstance, setDesktopInstance, type DesktopInstance } from '@web/desktop/instanceOverride';
import { apiUrl } from '@web/lib/runtimeConfig';
import { disconnectStargate, onStargateEvent } from '@web/services/stargate/client';
import { auth, logout, setAuth, setAuthToken, setAuthUser } from '@web/stores/auth';
import { setUserPresence } from '@web/stores/presence';
import { loadRelationships } from '@web/stores/relationships';
import { loadRooms } from '@web/stores/rooms';
import { loadSpaces } from '@web/stores/spaces';
import { loadInstanceInfo, resetInstanceInfo } from './overrides/runtime/instance';
import { reloadApp } from './reload';
import { appStorage } from './storage';

export { InstanceResolveError, type InstanceResolveCode } from '@web/desktop/instance';
export type { DesktopAccount as Account, DesktopInstance as Instance };
export {
  desktopAccounts as accounts,
  sortedDesktopAccounts as sortedAccounts,
  activeDesktopAccount as activeAccount,
  activeDesktopAccountId as activeAccountId,
};

/** Why the sign-in screen is showing after a session ended without the person asking. */
export type SignOutReason = 'expired' | 'revoked' | 'banned';

export interface SignOutNotice {
  reason: SignOutReason;
  at: number;
}

/** The web client's key for the session token (api/client.ts, stores/auth.ts). */
const SESSION_KEY = 'session_token';
/** What a session that ended left behind for the next start (the app restarts at once). */
const ENDED_KEY = 'session.ended';
const PROBE_PATH = '/users/@me';
/** After the session was seen to be valid, a 401 within this long is about something else. */
const RECENTLY_VALID_MS = 30_000;
const LOGOUT_TIMEOUT_MS = 5_000;
const ACCOUNT_WRITE_TIMEOUT_MS = 3_000;
const INSTANCE_PROBE_TIMEOUT_MS = 8_000;
/** Unsubscribing from push must not hold a sign-out up when the instance is slow. */
const ACCOUNT_LEAVING_TIMEOUT_MS = 4_000;

// ---- small helpers ---------------------------------------------------------------------------

function storedToken(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

/** Resolve after `p` settles or `ms` passes, whichever is first; never rejects. */
function settleWithin(p: Promise<unknown>, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    p.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

// ---- leaving the session ----------------------------------------------------------------------

/**
 * Called before an account leaves this device. `server`: its session can still speak for
 * it (sign-out, forgetting another account), so the instance can be told too.
 */
export type AccountLeavingHook = (accountId: string, opts: { server: boolean }) => Promise<void>;

let accountLeavingHook: AccountLeavingHook | null = null;

export function setAccountLeavingHook(hook: AccountLeavingHook | null): void {
  accountLeavingHook = hook;
}

/** Run the hook for an account, bounded: leaving must not wait on a slow instance. */
function accountLeaving(accountId: string | null, opts: { server: boolean }): Promise<void> {
  if (!accountId || !accountLeavingHook) return Promise.resolve();
  let run: Promise<void>;
  try {
    run = accountLeavingHook(accountId, opts);
  } catch {
    return Promise.resolve();
  }
  return settleWithin(run, ACCOUNT_LEAVING_TIMEOUT_MS);
}

/**
 * Set once the session is being left (sign-out, expiry, switch, add): the app restarts
 * next. A plain flag for the guards, mirrored in a signal for the boot gate.
 */
let leaving = false;
const [leavingSignal, setLeavingSignal] = createSignal(false);
/** The active account, remembered past the moment a sign-out clears it. */
let knownAccountId: string | null = null;

function setLeaving(value: boolean): void {
  leaving = value;
  setLeavingSignal(value);
}

/**
 * True while this session is on its way out and the app is about to restart; reactive.
 * The boot gate keeps the splash up meanwhile, so the sign-in screen does not flash (and
 * consume the sign-out notice) before the restart.
 */
export function isLeavingSession(): boolean {
  return leavingSignal();
}

interface EndedMarker {
  reason: SignOutReason | null;
  accountId: string | null;
  at: number;
}

function readMarker(): EndedMarker | null {
  try {
    const raw = appStorage.getString(ENDED_KEY);
    if (!raw) return null;
    const m = JSON.parse(raw) as Partial<EndedMarker>;
    const reason = m.reason === 'expired' || m.reason === 'revoked' || m.reason === 'banned' ? m.reason : null;
    return { reason, accountId: typeof m.accountId === 'string' ? m.accountId : null, at: typeof m.at === 'number' ? m.at : 0 };
  } catch {
    return null;
  }
}

function writeMarker(m: EndedMarker | null): void {
  if (!m || (!m.reason && !m.accountId)) appStorage.remove(ENDED_KEY);
  else appStorage.set(ENDED_KEY, JSON.stringify(m));
}

/**
 * Record, synchronously, that the session ended (and why, when it was not asked for), so
 * the next start can say so and finish removing the account even if the restart cut the
 * keystore write short. The first reason recorded wins: SESSION_REVOKED says "banned"
 * before anything generic runs.
 */
function noteSessionEnded(reason: SignOutReason | null): void {
  const existing = readMarker();
  writeMarker({
    reason: existing?.reason ?? reason,
    accountId: existing?.accountId ?? activeDesktopAccountId() ?? knownAccountId,
    at: Date.now(),
  });
}

/**
 * Why the last session ended, if the person did not end it themselves - for the sign-in
 * screen (t('auth.login.bannedNotice'), t('auth.login.revokedNotice'), and a mobile key for
 * "expired"). This clears it; a screen that renders it should rather peekSignOutNotice()
 * (render twice, effects run twice in development) - signing in clears it anyway.
 */
export function takeSignOutNotice(): SignOutNotice | null {
  const m = readMarker();
  if (!m?.reason) return null;
  writeMarker({ ...m, reason: null });
  return { reason: m.reason, at: m.at };
}

/** The same, without clearing it. */
export function peekSignOutNotice(): SignOutNotice | null {
  const m = readMarker();
  return m?.reason ? { reason: m.reason, at: m.at } : null;
}

/** Disconnect, forget the account on this device, clear the stores' session, restart. */
async function endSession(): Promise<void> {
  const accountId = activeDesktopAccountId() ?? knownAccountId;
  disconnectStargate();
  if (accountId) await settleWithin(removeDesktopAccount(accountId), ACCOUNT_WRITE_TIMEOUT_MS);
  logout();
  await reloadApp('strafe: session ended');
}

/**
 * The server no longer accepts this session (expired, revoked elsewhere, banned): sign out
 * on this device, remember why for the sign-in screen, restart.
 */
export async function expireSession(reason: SignOutReason): Promise<void> {
  if (leaving) return;
  setLeaving(true);
  noteSessionEnded(reason);
  // The session is gone, and its push subscription with it on the instance's side.
  await accountLeaving(activeDesktopAccountId() ?? knownAccountId, { server: false });
  await endSession();
}

/**
 * Sign out of the active account: the server ends the session (all of the account's
 * sessions with `everywhere`), the account leaves this device's list, the app restarts on
 * the sign-in screen. Offline, the local sign-out still happens; the server session then
 * lapses at its expiry.
 */
export async function signOut(opts: { everywhere?: boolean } = {}): Promise<void> {
  if (leaving) return;
  setLeaving(true);
  await accountLeaving(activeDesktopAccountId() ?? knownAccountId, { server: !!auth.token });
  if (auth.token) {
    await settleWithin(api(opts.everywhere ? '/auth/logout_all' : '/auth/logout', { method: 'POST' }), LOGOUT_TIMEOUT_MS);
  }
  await endSession();
}

/**
 * Become another saved account: its instance and token into place, then a restart. The
 * gateway is closed first, or a reconnect in the moment before the restart would present
 * this account's token to the next account's instance.
 */
export async function switchAccount(id: string): Promise<void> {
  if (leaving || id === activeDesktopAccountId()) return;
  if (!desktopAccounts().some((a) => a.id === id)) return;
  setLeaving(true);
  disconnectStargate();
  await switchDesktopAccount(id);
  // desktop/accounts navigates with location.assign('/'), which the location shim turns
  // into a reload once the router has bound it; this covers the time before that.
  await reloadApp('strafe: account switched');
}

/**
 * Sign in to another account and keep this one: restart on the sign-in screen, signed
 * out, with this account's instance preselected.
 */
export async function addAccount(): Promise<void> {
  if (leaving) return;
  setLeaving(true);
  disconnectStargate();
  await beginAddDesktopAccount();
  await reloadApp('strafe: adding an account');
}

/**
 * Remove a saved account from this device. The active one is signed out properly; another
 * one has its session ended on its own instance first (best effort), so the token does not
 * stay valid on a server after the device forgot it.
 */
export async function forgetAccount(id: string): Promise<void> {
  if (id === activeDesktopAccountId()) return signOut();
  const acc = desktopAccounts().find((a) => a.id === id);
  if (!acc) return;
  await accountLeaving(id, { server: true });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LOGOUT_TIMEOUT_MS);
  try {
    await rawFetch(`${acc.instance.apiUrl.replace(/\/+$/, '')}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${acc.token}` },
      signal: ctrl.signal,
    });
  } catch {
    /* offline or already gone: forget it locally all the same */
  } finally {
    clearTimeout(timer);
  }
  await removeDesktopAccount(id);
}

/**
 * Wire the session's end to a restart. Call once at start-up, before the web's instance
 * handlers are registered (stores/instance initInstanceHandlers): gateway handlers run in
 * the order they were registered, and the revocation reason has to be recorded before that
 * handler signs out.
 */
export function initSessionLifecycle(): () => void {
  const offRevoked = onStargateEvent((event) => {
    if (event.t !== 'SESSION_REVOKED' || leaving) return;
    const d = ((event.d as { d?: unknown } | undefined)?.d ?? event.d) as { reason?: unknown } | undefined;
    noteSessionEnded(d?.reason === 'banned' ? 'banned' : 'revoked');
  });
  const dispose = createRoot((d) => {
    createComputed(() => {
      const id = activeDesktopAccountId();
      if (id) knownAccountId = id;
    });
    // However the token went away (the revocation handler above, a web flow calling
    // logout(), our own sign-out), nothing of this account may outlive it in memory.
    let previous = auth.token;
    createEffect(() => {
      const token = auth.token;
      const had = previous;
      previous = token;
      if (!had || token) return;
      if (!leaving) noteSessionEnded(null);
      setLeaving(true);
      void reloadApp('strafe: signed out');
    });
    return d;
  });
  return () => {
    offRevoked();
    dispose();
  };
}

/**
 * At start-up, before the session is restored: finish what the previous run's sign-out
 * may have left half done (the account still listed because the restart beat the keystore
 * write), and make sure a stored token is only ever sent to the instance that issued it.
 * Needs the account list loaded (initDesktopAccounts).
 */
export async function settleStoredSession(): Promise<void> {
  const token = storedToken();
  const marker = readMarker();
  if (marker?.accountId) {
    if (!token && desktopAccounts().some((a) => a.id === marker.accountId)) {
      await settleWithin(removeDesktopAccount(marker.accountId), ACCOUNT_WRITE_TIMEOUT_MS);
    }
    writeMarker({ ...marker, accountId: null });
  }
  if (!token) return;
  const owner = desktopAccounts().find((a) => a.token === token);
  const inst = getDesktopInstance();
  if (owner && (!inst || inst.apiUrl !== owner.instance.apiUrl)) {
    setDesktopInstance(owner.instance);
    return;
  }
  if (!owner && !inst) {
    // A token without an instance would go to the localhost default: drop it rather than
    // hand a credential to a server that did not issue it.
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      /* nothing stored, nothing to drop */
    }
  }
}

/**
 * Before READY, give the shell the signed-in user from the saved account (name, avatar),
 * so an offline start shows who is signed in instead of nothing. READY replaces it.
 */
export function seedUserFromAccount(): void {
  const token = auth.token;
  if (!token || auth.user) return;
  const acc = desktopAccounts().find((a) => a.token === token);
  if (!acc) return;
  setAuthUser({
    id: acc.userId,
    username: acc.username,
    display_name: acc.displayName,
    ...(acc.avatar ? { avatar: acc.avatar } : {}),
  });
}

// ---- is the session still good? ---------------------------------------------------------------

export type SessionCheck = { state: 'valid' } | { state: 'invalid'; reason: SignOutReason } | { state: 'unknown' };

/** fetch without the guard below, so the guard's own probe cannot feed back into it. */
let rawFetch: typeof fetch = (input, init) => fetch(input, init);
let lastValidAt = 0;
let probing: Promise<SessionCheck> | null = null;

/** Something just proved the session valid (READY arrived); 401s right after are not about it. */
export function noteSessionValid(): void {
  lastValidAt = Date.now();
}

/** 'session revoked' is the server's word for a revoked session; the rest are expiry. */
function reasonFromServer(error: unknown): SignOutReason {
  return error === 'session revoked' ? 'revoked' : 'expired';
}

async function probe(token: string): Promise<SessionCheck> {
  try {
    const res = await rawFetch(`${apiUrl()}${PROBE_PATH}`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      return { state: 'invalid', reason: reasonFromServer(body.error) };
    }
    if (res.ok) {
      lastValidAt = Date.now();
      return { state: 'valid' };
    }
    return { state: 'unknown' };
  } catch {
    return { state: 'unknown' };
  }
}

/** Ask the server whether this session is still good (GET /users/@me). Shared while in flight. */
export function verifySession(): Promise<SessionCheck> {
  const token = auth.token;
  if (!token) return Promise.resolve({ state: 'unknown' });
  if (!probing) {
    probing = probe(token).finally(() => {
      probing = null;
    });
  }
  return probing;
}

/** Verify, and end the session if the server says it is over. */
export async function confirmSessionOrExpire(): Promise<SessionCheck> {
  const token = auth.token;
  if (!token || leaving) return { state: 'unknown' };
  const result = await verifySession();
  if (result.state === 'invalid' && auth.token === token) await expireSession(result.reason);
  return result;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return (input as { url?: string }).url ?? '';
}

function bearerOf(input: RequestInfo | URL, init?: RequestInit): string | null {
  const headers = (init?.headers ?? (typeof input === 'object' && 'headers' in input ? input.headers : undefined)) as
    | HeadersInit
    | undefined;
  let value: string | null | undefined;
  if (!headers) return null;
  if (typeof (headers as Headers).get === 'function') value = (headers as Headers).get('Authorization');
  else if (Array.isArray(headers)) value = headers.find(([k]) => k.toLowerCase() === 'authorization')?.[1];
  else {
    for (const [k, v] of Object.entries(headers as Record<string, string>)) {
      if (k.toLowerCase() === 'authorization') value = v;
    }
  }
  const m = value ? /^Bearer (.+)$/.exec(value) : null;
  return m ? m[1]! : null;
}

function onUnauthorized(input: RequestInfo | URL, init?: RequestInit): void {
  const token = auth.token;
  if (!token || leaving) return;
  // Only requests this session made to its own instance speak for it: a sign-in attempt
  // carries no token, and another account's request (forgetAccount) carries its own.
  if (!requestUrl(input).startsWith(apiUrl())) return;
  if (bearerOf(input, init) !== token) return;
  if (Date.now() - lastValidAt < RECENTLY_VALID_MS) return;
  void confirmSessionOrExpire();
}

/**
 * Watch every fetch for a 401 answered to this session. The web's API client has no hook
 * for it, and several web modules call fetch directly (uploads, the keepalive ack), so the
 * guard sits on fetch itself. Returns the uninstaller.
 */
export function installSessionGuard(): () => void {
  const g = globalThis as unknown as { fetch: typeof fetch };
  const unguarded = g.fetch;
  rawFetch = (input, init) => unguarded(input, init);
  const guarded: typeof fetch = async (input, init) => {
    const res = await unguarded(input, init);
    if (res.status === 401) onUnauthorized(input, init);
    return res;
  };
  g.fetch = guarded;
  return () => {
    if (g.fetch === guarded) g.fetch = unguarded;
    rawFetch = (input, init) => fetch(input, init);
  };
}

// ---- restoring a session without READY ---------------------------------------------------------

export type RestoreOutcome = 'restored' | 'offline' | 'expired' | 'signed-out';

/**
 * The web's READY fallback (stores/auth bootstrapFromRest), for when the gateway has not
 * delivered READY in time: the same four requests and the same store updates - except
 * that only a 401 from GET /users/@me ends the session. A network failure, a timeout or a
 * 5xx keeps the token: the caller shows the app as it is and the gateway's retries bring
 * READY when the instance is reachable again.
 */
export async function restoreFromRest(): Promise<RestoreOutcome> {
  const token = auth.token;
  if (!token) {
    setAuth({ loading: false, hydrated: true });
    return 'signed-out';
  }
  try {
    const [me] = await Promise.all([getMe(), loadRooms(), loadRelationships(), loadSpaces()]);
    if (auth.token !== token) return 'signed-out';
    const p = me.presence as { status?: string; custom_status?: string } | undefined;
    if (p?.status && ['online', 'idle', 'dnd', 'offline'].includes(p.status)) {
      setUserPresence(me.id, { status: p.status as 'online' | 'idle' | 'dnd' | 'offline', custom_status: p.custom_status });
    }
    lastValidAt = Date.now();
    setAuth({ user: toAuthUser(me), loading: false, hydrated: true });
    return 'restored';
  } catch (e) {
    if (isApiError(e) && e.status === 401) {
      if (auth.token === token) await expireSession(reasonFromServer(e.message));
      return 'expired';
    }
    return 'offline';
  }
}

// ---- choosing an instance and signing in ---------------------------------------------------------

/** The instance the sign-in screen talks to, if one was chosen. */
export function currentInstance(): DesktopInstance | null {
  return getDesktopInstance();
}

/** What to prefill the instance field with: the current one, else the last account's. */
export function suggestedInstance(): DesktopInstance | null {
  return lastDesktopInstance();
}

/**
 * The instance a fresh install offers (app config `extra.defaultInstance`, app.strafe.chat
 * unless a build says otherwise; '' for none). Only an offer: the field stays editable and it
 * is looked up like anything typed.
 */
export function defaultInstanceAddress(): string {
  const value = (Constants.expoConfig?.extra as { defaultInstance?: unknown } | undefined)?.defaultInstance;
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * The CDN the instance advertises in its index (services.cdn), when it does. runtimeConfig
 * otherwise derives one by convention (<domain>/cdn, :4000 -> :4010), which a deployment
 * that serves nebula elsewhere does not follow.
 */
async function advertisedCdnUrl(api: string, signal?: AbortSignal): Promise<string | undefined> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), INSTANCE_PROBE_TIMEOUT_MS);
  const onOuter = () => ctrl.abort();
  signal?.addEventListener('abort', onOuter);
  try {
    const res = await rawFetch(`${api}/`, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { services?: { cdn?: { enabled?: boolean; url?: unknown } } };
    const cdn = body.services?.cdn;
    return cdn?.enabled === true && typeof cdn.url === 'string' && /^https?:\/\//i.test(cdn.url)
      ? cdn.url.replace(/\/+$/, '')
      : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuter);
  }
}

/**
 * Point the sign-in / sign-up screens at an instance from what the person typed (a domain,
 * or a URL for a development API). Throws InstanceResolveError (code invalid |
 * unreachable | not_strafe) for the form to translate. The instance's own settings
 * (captcha, invite-only, email) are fetched again for the new instance.
 *
 * Only while signed out: changing the instance under a live session would send its token
 * to a server that did not issue it. addAccount() is the way to another instance.
 */
export async function chooseInstance(raw: string, signal?: AbortSignal): Promise<DesktopInstance & { version?: string }> {
  if (auth.token) throw new Error('chooseInstance: a session is active; use addAccount() to reach another instance');
  const found = await resolveInstance(raw, signal);
  const cdnUrl = await advertisedCdnUrl(found.apiUrl, signal);
  // A lookup the person has typed past must not become the chosen instance after all (the
  // CDN probe swallows the abort).
  if (signal?.aborted) throw new Error('chooseInstance: superseded');
  const inst: DesktopInstance = {
    domain: found.domain,
    apiUrl: found.apiUrl,
    stargateUrl: found.stargateUrl,
    ...(cdnUrl ? { cdnUrl } : {}),
  };
  setDesktopInstance(inst);
  resetInstanceInfo();
  void loadInstanceInfo();
  return { ...inst, ...(found.version !== undefined ? { version: found.version } : {}) };
}

export type SignInOutcome =
  | { kind: 'signed-in' }
  /** A second factor is needed. `methods` is empty when only a recovery code can do. */
  | { kind: 'second-factor'; mfaToken: string; methods: 'totp'[] };

/**
 * The session is ours: store the token and the user the server returned, and let boot's
 * effects take it from there (gateway, READY, E2EE). The web's Login.completeLogin.
 */
export function completeSignIn(res: LoginResponse): void {
  if (!getDesktopInstance()) throw new Error('completeSignIn: no instance chosen');
  setLeaving(false);
  writeMarker(null);
  setAuthToken(res.token);
  setAuth({ user: res.user, token: res.token, sessionId: null, loading: false, hydrated: true });
}

/**
 * What to do with the answer of login(), verifyTotp() or verifyRecoveryCode() (web
 * api/auth): sign in, or ask for a second factor. Passkeys are left out, as in the desktop
 * app: a passkey belongs to the instance's web domain, which an app that serves every
 * instance cannot claim. TOTP and recovery codes always remain.
 */
export function finishSignIn(result: LoginResult): SignInOutcome {
  if (isMFAChallenge(result)) {
    return {
      kind: 'second-factor',
      mfaToken: result.mfa_token,
      methods: result.methods.filter((m): m is 'totp' => m === 'totp'),
    };
  }
  completeSignIn(result);
  return { kind: 'signed-in' };
}
