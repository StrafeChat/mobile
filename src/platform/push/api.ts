/**
 * The two servers push registration talks to: the push gateway (an APNs/FCM token in, a
 * Web Push endpoint out) and each signed-in account's instance (that endpoint and this
 * device's keys in, as the session's subscription).
 *
 * The instance calls take the account explicitly rather than going through the web API
 * client, which only knows the active session: every account on this device keeps its own
 * subscription current (a preference changed here applies to all of them, and an account
 * that is not open still gets its pushes). The active account's calls are the same requests
 * the API client would make - its instance, its session token.
 */
import type { PushKeys } from '@strafe/push';

const REQUEST_TIMEOUT_MS = 15_000;

/** An account as push registration sees it. */
export interface PushAccount {
  /** The accounts store's id, `${domain}:${userId}`. */
  id: string;
  slot: string;
  userId: string;
  username: string;
  domain: string;
  /** The instance's API base URL, no trailing slash. */
  apiBase: string;
  token: string;
}

export type SubscriptionKind = 'fcm' | 'apns' | 'unifiedpush' | 'web';

/** Mirrors the instance's `prefs`; `pm`/`space` follow the web's notification prefs. */
export interface InstancePrefs {
  preview: boolean;
  pm: 'all' | 'none';
  space: 'all' | 'mentions' | 'none';
  calls: boolean;
}

export interface SubscriptionBody {
  endpoint: string;
  keys: PushKeys;
  kind: SubscriptionKind;
  prefs: InstancePrefs;
}

/** What went wrong talking to a server: `status` 0 is "never got an answer". */
export class PushRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PushRequestError';
  }
}

async function request<T>(url: string, init: RequestInit & { json?: unknown }): Promise<{ status: number; body: T | null }> {
  const { json, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      ...rest,
      headers: {
        ...(rest.headers as Record<string, string> | undefined),
        ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      signal: ctrl.signal,
    });
  } catch (e) {
    throw new PushRequestError(e instanceof Error && e.name === 'AbortError' ? 'timed out' : 'unreachable', 0);
  } finally {
    clearTimeout(timer);
  }
  const text = res.status === 204 ? '' : await res.text().catch(() => '');
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!res.ok) {
    const error = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string' ? (body as { error: string }).error : `HTTP ${res.status}`;
    throw new PushRequestError(error, res.status);
  }
  return { status: res.status, body: body as T | null };
}

// ---- gateway ------------------------------------------------------------------------------------

export interface GatewayRegistration {
  platform: 'fcm' | 'apns' | 'debug';
  token: string;
  slot: string;
  sandbox: boolean;
  /** What APNs shows if the Notification Service Extension cannot run (localized). */
  fallback: string;
}

/** POST <gateway>/v1/register -> the Web Push endpoint for that token and slot. */
export async function registerWithGateway(gateway: string, reg: GatewayRegistration): Promise<string> {
  const { body } = await request<{ endpoint?: unknown }>(`${gateway}/v1/register`, { method: 'POST', json: reg });
  const endpoint = body?.endpoint;
  if (typeof endpoint !== 'string' || !/^https?:\/\//i.test(endpoint)) throw new PushRequestError('bad gateway response', 502);
  return endpoint;
}

// ---- instance -----------------------------------------------------------------------------------

function auth(account: PushAccount): Record<string, string> {
  return { Authorization: `Bearer ${account.token}` };
}

const PUSH_PATH = '/users/@me/push';

/** PUT /users/@me/push: this session's subscription, created or replaced. */
export async function putSubscription(account: PushAccount, body: SubscriptionBody): Promise<void> {
  await request(`${account.apiBase}${PUSH_PATH}`, { method: 'PUT', headers: auth(account), json: body });
}

/** PATCH /users/@me/push with new prefs. False when the instance has no subscription for it. */
export async function patchSubscriptionPrefs(account: PushAccount, prefs: InstancePrefs): Promise<boolean> {
  try {
    await request(`${account.apiBase}${PUSH_PATH}`, { method: 'PATCH', headers: auth(account), json: { prefs } });
    return true;
  } catch (e) {
    if (e instanceof PushRequestError && e.status === 404) return false;
    throw e;
  }
}

/** DELETE /users/@me/push (idempotent on the instance's side). */
export async function deleteSubscription(account: Pick<PushAccount, 'apiBase' | 'token'>): Promise<void> {
  await request(`${account.apiBase}${PUSH_PATH}`, { method: 'DELETE', headers: { Authorization: `Bearer ${account.token}` } });
}

export type TestResult =
  | { delivered: true }
  | { delivered: false; status: number; error: string }
  /** The instance has no subscription for this session. */
  | { delivered: false; missing: true };

/** POST /users/@me/push/test: the instance pushes a test notification and says how it went. */
export async function sendTestPush(account: PushAccount): Promise<TestResult> {
  try {
    const { body } = await request<{ delivered?: unknown; status?: unknown; error?: unknown }>(`${account.apiBase}${PUSH_PATH}/test`, {
      method: 'POST',
      headers: auth(account),
    });
    if (body?.delivered === true) return { delivered: true };
    return {
      delivered: false,
      status: typeof body?.status === 'number' ? body.status : 0,
      error: typeof body?.error === 'string' ? body.error : 'unknown',
    };
  } catch (e) {
    if (e instanceof PushRequestError && e.status === 404 && e.message !== 'push is disabled') return { delivered: false, missing: true };
    throw e;
  }
}

/** POST /rooms/:id/ack, as the web's ackRoom sends it, for any account. */
export async function ackRoomAs(account: Pick<PushAccount, 'apiBase' | 'token'>, roomId: string, messageId: string): Promise<void> {
  await request(`${account.apiBase}/rooms/${roomId}/ack`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.token}` },
    json: { last_read_message_id: messageId },
  });
}

/** POST /rooms/:id/call/decline, as the web's declineCall sends it, for any account. */
export async function declineCallAs(account: Pick<PushAccount, 'apiBase' | 'token'>, roomId: string): Promise<void> {
  await request(`${account.apiBase}/rooms/${roomId}/call/decline`, { method: 'POST', headers: { Authorization: `Bearer ${account.token}` } });
}
