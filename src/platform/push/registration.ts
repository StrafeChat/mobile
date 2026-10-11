/**
 * Push registration: getting every signed-in account's notifications delivered to this
 * device while the app is closed, and keeping that true as things change.
 *
 * One run (ensurePushRegistration) walks the whole chain and only does network work where
 * something changed since the last successful run:
 *
 *  1. push on for this device (Settings) and the OS lets Strafe notify - asked once, after
 *     the first sign-in, through the app's existing permission flow; never nagged;
 *  2. a transport: APNs on iOS; on Android the person's choice - Firebase, a UnifiedPush
 *     distributor, or Automatic (Firebase, else the one distributor installed) - plus, in
 *     development builds only, the gateway's debug platform;
 *  3. per account: its slot (slots.ts), its keys (generated and kept natively), an endpoint
 *     (the push gateway's sealed endpoint for an APNs/FCM token - cached per token, slot and
 *     fallback text - or UnifiedPush's for the slot), then PUT /users/@me/push on its
 *     instance, re-sent only when endpoint, keys or kind changed (prefs alone go as a PATCH)
 *     or the last one is a day old (the instance drops subscriptions that keep failing, and
 *     says nothing);
 *  4. the native renderer's display config: strings in the current language, every account,
 *     the open one, preview and sound preferences.
 *
 * Push off, permission gone or no transport left: the instances are told to stop
 * (DELETE /users/@me/push) so they do not keep encrypting to an endpoint nobody reads, and
 * the app falls back to notifying only while it runs. Runs are serialised; triggers that
 * arrive during one coalesce into a single follow-up run. See lifecycle.ts for the triggers.
 */
import * as StrafePush from '@strafe/push';
import type { Distributor, PushCapabilities, PushKeys, UnifiedPushEndpointEvent } from '@strafe/push';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { activeDesktopAccountId, desktopAccountsLoaded } from '@web/desktop/accounts';
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { notificationPrefs, requestDesktopPermission, setNotificationPrefs } from '@web/stores/notificationPrefs';
import { appStorage } from '../storage';
import { activePushAccount, pushAccounts } from './accounts';
import {
  PushRequestError,
  deleteSubscription,
  patchSubscriptionPrefs,
  putSubscription,
  registerWithGateway,
  type InstancePrefs,
  type PushAccount,
  type SubscriptionKind,
} from './api';
import { distributorOf, pushEnabled, pushGatewayUrl, transportPref } from './config';
import { buildDisplayConfig } from './display';
import { fingerprint, mappedSlots, releaseSlot } from './slots';
import { setPushCapabilities, setPushStatus, type NoTransportReason, type PushStatus, type TransportInfo } from './status';

/** A subscription the instance has not heard about for this long is sent again. */
export const SUBSCRIPTION_REFRESH_MS = 24 * 60 * 60 * 1000;
/** How long UnifiedPush gets to hand over an endpoint. */
export const UNIFIEDPUSH_TIMEOUT_MS = 20_000;

const ASKED_KEY = 'strafe.push.permissionAsked';
const TRANSPORT_USED_KEY = 'strafe.push.transportUsed';
const gatewayKey = (slot: string) => `strafe.push.gw.${slot}`;
const subscriptionKey = (slot: string) => `strafe.push.sub.${slot}`;
const unifiedPushKey = (slot: string) => `strafe.push.up.${slot}`;

// ---- small persistence helpers -------------------------------------------------------------------

function readJson<T>(key: string): T | null {
  try {
    const raw = appStorage.getString(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  appStorage.set(key, JSON.stringify(value));
}

interface GatewayRecord {
  hash: string;
  endpoint: string;
}

/** What the instance was last sent for a slot - the base of the diff. */
export interface SubscriptionRecord {
  accountId: string;
  endpoint: string;
  keys: PushKeys;
  kind: SubscriptionKind;
  prefs: InstancePrefs;
  at: number;
}

interface UnifiedPushRecord {
  distributor: string;
}

function forgetCaches(slot: string): void {
  appStorage.remove(gatewayKey(slot));
  appStorage.remove(subscriptionKey(slot));
  appStorage.remove(unifiedPushKey(slot));
}

// ---- inputs ----------------------------------------------------------------------------------------

/** The prefs the instance filters with, from the web's (per-device) notification preferences. */
export function instancePrefs(): InstancePrefs {
  return {
    preview: notificationPrefs.preview,
    pm: notificationPrefs.pmMode === 'none' ? 'none' : 'all',
    space: notificationPrefs.spaceMode,
    // No per-device calls toggle exists; ringing is governed by the room's own settings.
    calls: true,
  };
}

function samePrefs(a: InstancePrefs, b: InstancePrefs): boolean {
  return a.preview === b.preview && a.pm === b.pm && a.space === b.space && a.calls === b.calls;
}

/**
 * What a run has to do with a slot's subscription, given what the instance was last sent:
 * `put` the whole thing, `patch` the prefs, or nothing.
 */
export function subscriptionChange(
  previous: SubscriptionRecord | null,
  next: Omit<SubscriptionRecord, 'at'>,
  now: number,
  force = false,
): 'put' | 'patch' | 'none' {
  if (
    force ||
    !previous ||
    previous.accountId !== next.accountId ||
    previous.endpoint !== next.endpoint ||
    previous.kind !== next.kind ||
    previous.keys?.p256dh !== next.keys.p256dh ||
    previous.keys?.auth !== next.keys.auth ||
    !(now - previous.at < SUBSCRIPTION_REFRESH_MS)
  ) {
    return 'put';
  }
  return samePrefs(previous.prefs, next.prefs) ? 'none' : 'patch';
}

// ---- permission -----------------------------------------------------------------------------------

/**
 * Whether Strafe may post notifications. With an account open and the OS never asked, asks
 * once (the app's existing flow, which also turns the in-app notifications on): a person
 * who refused is not asked again - Settings says how to change it.
 */
async function notificationPermission(canAsk: boolean): Promise<boolean> {
  let perm: Notifications.NotificationPermissionsStatus;
  try {
    perm = await Notifications.getPermissionsAsync();
  } catch {
    return false;
  }
  if (perm.granted || perm.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return true;
  const asked = appStorage.getBoolean(ASKED_KEY) === true;
  if (!canAsk || asked || !perm.canAskAgain || perm.status !== Notifications.PermissionStatus.UNDETERMINED) return false;
  appStorage.set(ASKED_KEY, true);
  const result = await requestDesktopPermission();
  if (result !== 'granted') return false;
  if (!notificationPrefs.desktop) setNotificationPrefs({ desktop: true });
  return true;
}

// ---- transport ------------------------------------------------------------------------------------

export type ResolvedTransport =
  | { kind: 'apns'; token: string; sandbox: boolean }
  | { kind: 'fcm'; token: string }
  /** Firebase is there but has not issued a token yet; the fcmToken event brings it. */
  | { kind: 'fcm-pending' }
  | { kind: 'debug' }
  | { kind: 'unifiedpush'; distributor: Distributor }
  | { kind: 'none'; reason: NoTransportReason }
  | { kind: 'failed'; transport: TransportInfo; detail: string };

/** The transport the Android preference names, against what the device offers. */
export function chooseAndroidTransport(
  pref: ReturnType<typeof transportPref>,
  caps: PushCapabilities,
  dev: boolean,
): { kind: 'fcm' } | { kind: 'debug' } | { kind: 'unifiedpush'; distributor: Distributor } | { kind: 'none'; reason: NoTransportReason } {
  if (pref === 'debug') return dev ? { kind: 'debug' } : chooseAndroidTransport('auto', caps, dev);
  if (pref === 'fcm') return caps.fcm ? { kind: 'fcm' } : { kind: 'none', reason: 'fcm-unavailable' };
  const wanted = distributorOf(pref);
  if (wanted) {
    const found = caps.distributors.find((d) => d.id === wanted);
    return found ? { kind: 'unifiedpush', distributor: found } : { kind: 'none', reason: 'distributor-missing' };
  }
  if (caps.fcm) return { kind: 'fcm' };
  if (caps.distributors.length === 1) return { kind: 'unifiedpush', distributor: caps.distributors[0]! };
  return { kind: 'none', reason: caps.distributors.length > 1 ? 'choose-distributor' : 'none' };
}

async function resolveTransport(caps: PushCapabilities): Promise<ResolvedTransport> {
  if (Platform.OS === 'ios') {
    try {
      const [token, env] = await Promise.all([Notifications.getDevicePushTokenAsync(), StrafePush.getApnsEnvironment()]);
      if (typeof token.data !== 'string' || !token.data) throw new Error('no APNs token');
      return { kind: 'apns', token: token.data, sandbox: env === 'sandbox' };
    } catch (e) {
      return { kind: 'failed', transport: { kind: 'apns' }, detail: e instanceof Error ? e.message : String(e) };
    }
  }
  const choice = chooseAndroidTransport(transportPref(), caps, __DEV__);
  if (choice.kind !== 'fcm') return choice;
  try {
    const token = await StrafePush.getFcmToken();
    return token ? { kind: 'fcm', token } : { kind: 'fcm-pending' };
  } catch (e) {
    return { kind: 'failed', transport: { kind: 'fcm' }, detail: e instanceof Error ? e.message : String(e) };
  }
}

function transportInfo(r: ResolvedTransport): TransportInfo | null {
  switch (r.kind) {
    case 'apns':
    case 'fcm':
    case 'debug':
      return { kind: r.kind };
    case 'fcm-pending':
      return { kind: 'fcm' };
    case 'unifiedpush':
      return { kind: 'unifiedpush', distributorId: r.distributor.id, distributorName: r.distributor.name };
    case 'failed':
      return r.transport;
    default:
      return null;
  }
}

/** One word per transport (and distributor), to notice a switch between runs. */
function transportKey(r: ResolvedTransport): string {
  return r.kind === 'unifiedpush' ? `unifiedpush:${r.distributor.id}` : r.kind;
}

// ---- endpoints ------------------------------------------------------------------------------------

type Usable = Extract<ResolvedTransport, { kind: 'apns' | 'fcm' | 'debug' | 'unifiedpush' }>;

class StepError extends Error {
  constructor(
    readonly where: 'transport' | 'gateway' | 'distributor' | 'instance' | 'unsupported',
    detail: string,
  ) {
    super(detail);
  }
}

async function gatewayEndpoint(transport: Exclude<Usable, { kind: 'unifiedpush' }>, slot: string): Promise<string> {
  const gateway = pushGatewayUrl();
  const reg = {
    platform: transport.kind,
    token: transport.kind === 'debug' ? 'emulator' : transport.token,
    slot,
    sandbox: transport.kind === 'apns' ? transport.sandbox : false,
    fallback: t('mobile.push.fallback'),
  };
  const hash = fingerprint(JSON.stringify([gateway, reg.platform, reg.token, reg.slot, reg.sandbox, reg.fallback]));
  const cached = readJson<GatewayRecord>(gatewayKey(slot));
  if (cached?.hash === hash && cached.endpoint) return cached.endpoint;
  try {
    const endpoint = await registerWithGateway(gateway, reg);
    writeJson(gatewayKey(slot), { hash, endpoint } satisfies GatewayRecord);
    return endpoint;
  } catch (e) {
    throw new StepError('gateway', e instanceof Error ? e.message : String(e));
  }
}

/** Bind a slot to a distributor and wait for UnifiedPush's endpoint (or its refusal). */
function registerUnifiedPushAndWait(slot: string, distributor: string): Promise<UnifiedPushEndpointEvent> {
  return new Promise<UnifiedPushEndpointEvent>((resolve, reject) => {
    const subs: { remove(): void }[] = [];
    const done = () => {
      clearTimeout(timer);
      for (const s of subs) s.remove();
    };
    const timer = setTimeout(() => {
      done();
      reject(new StepError('distributor', 'timed out'));
    }, UNIFIEDPUSH_TIMEOUT_MS);
    subs.push(
      StrafePush.addListener('unifiedPushEndpoint', (e) => {
        if (e.slot !== slot) return;
        done();
        resolve(e);
      }),
      StrafePush.addListener('unifiedPushFailed', (e) => {
        if (e.slot !== slot) return;
        done();
        reject(new StepError('distributor', e.reason || 'refused'));
      }),
    );
    StrafePush.registerUnifiedPush(slot, distributor).catch((err: unknown) => {
      done();
      reject(new StepError('distributor', err instanceof Error ? err.message : String(err)));
    });
  });
}

async function unifiedPushEndpoint(distributor: Distributor, slot: string): Promise<{ endpoint: string; keys?: PushKeys }> {
  const record = readJson<UnifiedPushRecord>(unifiedPushKey(slot));
  if (record?.distributor === distributor.id) {
    const stored = await StrafePush.getUnifiedPushEndpoint(slot).catch(() => null);
    if (stored?.endpoint) return { endpoint: stored.endpoint, ...(stored.keys ? { keys: stored.keys } : {}) };
  }
  const event = await registerUnifiedPushAndWait(slot, distributor.id);
  writeJson(unifiedPushKey(slot), { distributor: distributor.id } satisfies UnifiedPushRecord);
  return { endpoint: event.endpoint, ...(event.keys ? { keys: event.keys } : {}) };
}

// ---- per account ----------------------------------------------------------------------------------

async function registerAccount(account: PushAccount, transport: Usable, prefs: InstancePrefs, force: boolean): Promise<void> {
  let endpoint: string;
  let keys: PushKeys | undefined;
  if (transport.kind === 'unifiedpush') {
    ({ endpoint, keys } = await unifiedPushEndpoint(transport.distributor, account.slot));
  } else {
    endpoint = await gatewayEndpoint(transport, account.slot);
  }
  if (!keys) {
    try {
      keys = await StrafePush.ensureKeys(account.slot);
    } catch (e) {
      throw new StepError('transport', e instanceof Error ? e.message : String(e));
    }
  }
  // The gateway's debug platform stands in for Firebase; the instance sees an FCM device.
  const kind: SubscriptionKind = transport.kind === 'debug' ? 'fcm' : transport.kind;
  const next = { accountId: account.id, endpoint, keys, kind, prefs };
  const previous = readJson<SubscriptionRecord>(subscriptionKey(account.slot));
  const now = Date.now();
  try {
    switch (subscriptionChange(previous, next, now, force)) {
      case 'none':
        return;
      case 'patch':
        if (await patchSubscriptionPrefs(account, prefs)) {
          writeJson(subscriptionKey(account.slot), { ...previous!, prefs } satisfies SubscriptionRecord);
          return;
        }
        // The instance no longer has it: send the whole subscription.
        break;
      case 'put':
        break;
    }
    await putSubscription(account, { endpoint, keys, kind, prefs });
    writeJson(subscriptionKey(account.slot), { ...next, at: now } satisfies SubscriptionRecord);
  } catch (e) {
    appStorage.remove(subscriptionKey(account.slot));
    if (e instanceof PushRequestError && e.status === 404) throw new StepError('unsupported', e.message);
    throw new StepError('instance', e instanceof Error ? e.message : String(e));
  }
}

/**
 * Tell the account's instance to stop pushing to this device (best effort: offline, the
 * subscription lapses on the instance's side when its endpoint goes away).
 */
async function unsubscribe(account: Pick<PushAccount, 'apiBase' | 'token' | 'slot'>, opts: { always?: boolean } = {}): Promise<void> {
  const had = readJson<SubscriptionRecord>(subscriptionKey(account.slot));
  appStorage.remove(subscriptionKey(account.slot));
  if (!had && !opts.always) return;
  await deleteSubscription(account).catch(() => undefined);
}

/**
 * Firebase is no longer how this device gets pushes (another transport, or none): stop it
 * renewing a token with Google that nothing uses. getFcmToken() opts back in.
 */
async function releaseFcm(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await StrafePush.releaseFcm();
  } catch {
    // Best effort: the token lapses with Google on its own if this fails.
  }
}

async function teardown(accounts: readonly PushAccount[], opts: { dropKeys: boolean }): Promise<void> {
  if (appStorage.getString(TRANSPORT_USED_KEY) === 'fcm') await releaseFcm();
  for (const account of accounts) {
    await unsubscribe(account);
    if (Platform.OS === 'android' && readJson<UnifiedPushRecord>(unifiedPushKey(account.slot))) {
      await StrafePush.unregisterUnifiedPush(account.slot).catch(() => undefined);
      appStorage.remove(unifiedPushKey(account.slot));
    }
    if (opts.dropKeys) {
      await StrafePush.deleteKeys(account.slot).catch(() => undefined);
      forgetCaches(account.slot);
    }
  }
  appStorage.remove(TRANSPORT_USED_KEY);
}

/** Switching away from UnifiedPush releases the distributor's registrations. */
async function releaseUnifiedPush(accounts: readonly PushAccount[]): Promise<void> {
  for (const account of accounts) {
    if (!readJson<UnifiedPushRecord>(unifiedPushKey(account.slot))) continue;
    await StrafePush.unregisterUnifiedPush(account.slot).catch(() => undefined);
    appStorage.remove(unifiedPushKey(account.slot));
  }
}

/**
 * Slots whose account is no longer on this device (signed out, forgotten, a sign-out the
 * restart cut short): their keys, endpoint registrations and notifications go. The
 * instance side went with the session.
 */
async function releaseOrphanedSlots(accounts: readonly PushAccount[]): Promise<void> {
  const present = new Set(accounts.map((a) => a.id));
  for (const { accountId, slot } of mappedSlots()) {
    if (present.has(accountId)) continue;
    await forgetSlotLocally(accountId, slot);
  }
}

async function forgetSlotLocally(accountId: string, slot: string): Promise<void> {
  if (Platform.OS === 'android') await StrafePush.unregisterUnifiedPush(slot).catch(() => undefined);
  await StrafePush.deleteKeys(slot).catch(() => undefined);
  await StrafePush.clearAll(slot).catch(() => undefined);
  forgetCaches(slot);
  releaseSlot(accountId);
}

// ---- display config -------------------------------------------------------------------------------

let appliedDisplay: string | null = null;

/** Hand the native renderer the current config (skipped when nothing changed this run). */
export async function applyDisplayConfig(excludeAccountId?: string): Promise<void> {
  if (!StrafePush.isAvailable() || !desktopAccountsLoaded()) return;
  const accounts = pushAccounts(excludeAccountId);
  const activeId = activeDesktopAccountId();
  const config = buildDisplayConfig({
    accounts,
    activeAccountId: activeId && activeId !== excludeAccountId && auth.token ? activeId : null,
    preview: notificationPrefs.preview,
    sounds: notificationPrefs.sounds,
    includeTokens: Platform.OS === 'android',
  });
  const json = JSON.stringify(config);
  if (json === appliedDisplay) return;
  await StrafePush.setDisplayConfig(config);
  appliedDisplay = json;
}

// ---- the run --------------------------------------------------------------------------------------

function errorStatus(e: unknown, transport: TransportInfo | null): PushStatus {
  if (e instanceof StepError) return { state: 'error', where: e.where, transport, detail: e.message };
  return { state: 'error', where: 'instance', transport, detail: e instanceof Error ? e.message : String(e) };
}

async function run(force: boolean): Promise<void> {
  if (!StrafePush.isAvailable()) {
    setPushStatus({ state: 'unavailable' });
    return;
  }
  // The account list decides everything below (and which slots are orphans): wait for it.
  if (!desktopAccountsLoaded()) return;
  const accounts = pushAccounts();
  const active = activePushAccount();

  await releaseOrphanedSlots(accounts);
  const caps = await StrafePush.getCapabilities().catch(() => null);
  setPushCapabilities(caps);
  await applyDisplayConfig().catch((e: unknown) => console.warn('[push] could not hand over the display config', e));

  if (!pushEnabled()) {
    await teardown(accounts, { dropKeys: true });
    setPushStatus({ state: 'disabled' });
    return;
  }
  if (accounts.length === 0) {
    setPushStatus({ state: 'signed-out' });
    return;
  }
  if (!(await notificationPermission(!!active))) {
    await teardown(accounts, { dropKeys: false });
    setPushStatus(active ? { state: 'permission' } : { state: 'signed-out' });
    return;
  }
  if (!caps) {
    setPushStatus({ state: 'unavailable' });
    return;
  }

  const transport = await resolveTransport(caps);
  if (transport.kind === 'none') {
    await teardown(accounts, { dropKeys: false });
    setPushStatus(active ? { state: 'no-transport', reason: transport.reason } : { state: 'signed-out' });
    return;
  }
  if (transport.kind === 'fcm-pending') {
    setPushStatus(active ? { state: 'registering', transport: { kind: 'fcm' } } : { state: 'signed-out' });
    return;
  }
  const info = transportInfo(transport);
  if (transport.kind === 'failed') {
    setPushStatus(active ? errorStatus(new StepError('transport', transport.detail), info) : { state: 'signed-out' });
    return;
  }

  const key = transportKey(transport);
  const previousKey = appStorage.getString(TRANSPORT_USED_KEY);
  if (previousKey !== key) {
    if (transport.kind !== 'unifiedpush') await releaseUnifiedPush(accounts);
    if (previousKey === 'fcm') await releaseFcm();
    appStorage.set(TRANSPORT_USED_KEY, key);
  }

  if (active) setPushStatus({ state: 'registering', transport: info });
  else setPushStatus({ state: 'signed-out' });
  const prefs = instancePrefs();
  for (const account of accounts) {
    try {
      await registerAccount(account, transport, prefs, force && account.id === active?.id);
      if (account.id === active?.id) setPushStatus({ state: 'active', transport: info! });
    } catch (e) {
      if (account.id === active?.id) setPushStatus(errorStatus(e, info));
      else console.warn(`[push] could not register ${account.slot}:`, e instanceof Error ? e.message : e);
    }
  }
}

let queue: Promise<void> = Promise.resolve();
let next: Promise<void> | null = null;
let nextForce = false;

/** Run `task` after whatever push work is in flight, one at a time. */
function serial<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task);
  queue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Bring push registration up to date (see the top of this file). Calls made while a run is
 * waiting share it; `force` re-sends the open account's subscription even if nothing seems
 * to have changed (the instance said it has none). Never rejects.
 */
export function ensurePushRegistration(opts: { force?: boolean } = {}): Promise<void> {
  if (opts.force) nextForce = true;
  if (next) return next;
  const scheduled = serial(async () => {
    next = null;
    const force = nextForce;
    nextForce = false;
    try {
      await run(force);
    } catch (e) {
      console.warn('[push] registration failed', e);
    }
  });
  next = scheduled;
  return scheduled;
}

/**
 * An account is leaving this device (signed out, or forgotten from the account list):
 * its instance stops pushing here while its session can still say so, then its keys,
 * UnifiedPush registration and notifications go, and the native side forgets it. Other
 * accounts keep their subscriptions. `server: false` when the session is already gone.
 */
export async function forgetPushAccount(accountId: string, opts: { server: boolean }): Promise<void> {
  if (!StrafePush.isAvailable()) return;
  const account = pushAccounts().find((a) => a.id === accountId);
  // Not queued behind a registration in flight: the session may have seconds left.
  if (opts.server && account) await unsubscribe(account, { always: true });
  await serial(async () => {
    const slot = account?.slot ?? mappedSlots().find((m) => m.accountId === accountId)?.slot;
    if (!slot) return;
    await forgetSlotLocally(accountId, slot);
    await applyDisplayConfig(accountId).catch(() => undefined);
  });
}

/**
 * A subscription the instance accepted for this slot is on record (from this run or an
 * earlier one) - what "push covers this account" means before this run has checked.
 */
export function hasStoredSubscription(slot: string): boolean {
  return readJson<SubscriptionRecord>(subscriptionKey(slot)) !== null;
}

/** For tests: forget what this process handed the native side. */
export function resetPushRegistrationForTests(): void {
  appliedDisplay = null;
  queue = Promise.resolve();
  next = null;
  nextForce = false;
}
