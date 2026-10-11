/**
 * strafe-push: the native half of push notifications (Kotlin + Swift, Expo Modules API).
 *
 * The instance sends standard Web Push (RFC 8030/8291/8292) to an endpoint this device
 * registered; the body is encrypted to a key pair that lives only here, so neither Apple,
 * Google, a UnifiedPush distributor nor the Strafe push gateway can read it. This module
 * owns those keys, the transports (Android: Firebase Cloud Messaging or UnifiedPush; iOS:
 * APNs through expo-notifications' token plus a Notification Service Extension), and the
 * decrypt-and-render path that runs while the JavaScript app is not.
 *
 * One *slot* per signed-in account (`[A-Za-z0-9_-]{1,32}`, chosen by JS): its own keys and,
 * through the gateway's sealed endpoints or a UnifiedPush instance, its own endpoint.
 *
 * Wire formats and the whole design: docs/PUSH.md in StrafeChat/deploy.
 */
import { requireOptionalNativeModule, type EventSubscription } from 'expo-modules-core';

/** Web Push subscription keys, base64url without padding. */
export interface PushKeys {
  /** The 65-byte uncompressed P-256 public key. */
  p256dh: string;
  /** The 16-byte auth secret. */
  auth: string;
}

export interface Distributor {
  /** Package name of the UnifiedPush distributor app. */
  id: string;
  /** Its user-facing name. */
  name: string;
}

export interface PushCapabilities {
  /** Android: this build carries Firebase config and Google Play services are present. */
  fcm: boolean;
  /** iOS: always true (APNs). */
  apns: boolean;
  /** Android: at least one UnifiedPush distributor is installed. */
  unifiedPush: boolean;
  distributors: Distributor[];
  /** The distributor UnifiedPush is currently bound to, if any. */
  selectedDistributor: string | null;
}

/** Localized templates the native renderer uses (`{{name}}` placeholders). */
export interface PushStrings {
  appName: string;
  newMessage: string;
  encryptedMessage: string;
  attachment: string;
  /** `#{{room}} · {{space}}` */
  spaceRoom: string;
  /** `{{thread}} · #{{room}}` */
  threadRoom: string;
  incomingCall: string;
  /** `{{name}} is calling` */
  callFrom: string;
  /** `{{name}} is calling {{room}}` */
  callFromIn: string;
  markRead: string;
  reply: string;
  answer: string;
  decline: string;
  testTitle: string;
  testBody: string;
  channelMessages: string;
  channelMessagesSilent: string;
  channelCalls: string;
}

export interface DisplayAccount {
  slot: string;
  userId: string;
  /** Shown as sub-text when more than one account is configured, e.g. `@alice@example.org`. */
  label: string;
  /** The account's instance API base URL (no trailing slash). */
  apiBase: string;
  /** Android only: the session token, for the Mark as read / Decline actions. Stored encrypted. */
  token?: string;
}

export interface DisplayConfig {
  strings: PushStrings;
  accounts: DisplayAccount[];
  /** The account the running app is signed in as (foreground suppression applies to it only). */
  activeSlot: string | null;
  /** Show message text when the push carries it. */
  preview: boolean;
  /** Play the notification sound. */
  sounds: boolean;
}

export interface UnifiedPushEndpointEvent {
  slot: string;
  endpoint: string;
  /** Present when the UnifiedPush connector manages the Web Push keys itself. */
  keys?: PushKeys;
}

export type StrafePushEvents = {
  fcmToken: (e: { token: string }) => void;
  unifiedPushEndpoint: (e: UnifiedPushEndpointEvent) => void;
  unifiedPushUnregistered: (e: { slot: string }) => void;
  unifiedPushFailed: (e: { slot: string; reason: string }) => void;
};

interface StrafePushNative {
  getCapabilities(): Promise<PushCapabilities>;
  ensureKeys(slot: string): Promise<PushKeys>;
  deleteKeys(slot: string): Promise<void>;
  /** Android: the FCM registration token, or null when FCM is unavailable. iOS: always null. */
  getFcmToken(): Promise<string | null>;
  /** Android: stop using FCM - auto-init off, the token deleted with Google. iOS: nothing. */
  releaseFcm(): Promise<void>;
  /**
   * Android, synchronous: this install's notification link key. The native renderer puts it in
   * the `strafe://push/open` links of its buttons; a link without it is not one of ours.
   */
  getLinkKey?(): string;
  /** iOS: which APNs environment this build's provisioning profile targets. Android: 'production'. */
  getApnsEnvironment(): Promise<'sandbox' | 'production'>;
  /** Android: bind `slot` to UnifiedPush (via `distributor`, or the saved/default one); the endpoint arrives as an event. */
  registerUnifiedPush(slot: string, distributor: string | null): Promise<void>;
  unregisterUnifiedPush(slot: string): Promise<void>;
  /** Android: the last endpoint UnifiedPush gave `slot`, if any. */
  getUnifiedPushEndpoint(slot: string): Promise<UnifiedPushEndpointEvent | null>;
  setDisplayConfig(config: DisplayConfig): Promise<void>;
  /** Remove the notifications of one room (both platforms). */
  clearRoom(slot: string, roomId: string): Promise<void>;
  /** Remove every notification of `slot`, or all Strafe notifications when null. */
  clearAll(slot: string | null): Promise<void>;
  addListener<E extends keyof StrafePushEvents>(event: E, listener: StrafePushEvents[E]): EventSubscription;
}

/** Null where the native module isn't built in (Jest, Expo Go, web). */
const native = requireOptionalNativeModule<StrafePushNative>('StrafePush');

export function isAvailable(): boolean {
  return native !== null;
}

function need(): StrafePushNative {
  if (!native) throw new Error('strafe-push: native module not available in this build');
  return native;
}

export const getCapabilities = () => need().getCapabilities();
export const ensureKeys = (slot: string) => need().ensureKeys(slot);
export const deleteKeys = (slot: string) => need().deleteKeys(slot);
export const getFcmToken = () => need().getFcmToken();
/** A no-op where the native side predates it (a dev client not rebuilt yet): nothing to release then. */
export const releaseFcm = async (): Promise<void> => {
  const n = need();
  if (typeof n.releaseFcm === 'function') await n.releaseFcm();
};
export const getApnsEnvironment = () => need().getApnsEnvironment();
export const registerUnifiedPush = (slot: string, distributor: string | null) => need().registerUnifiedPush(slot, distributor);
export const unregisterUnifiedPush = (slot: string) => need().unregisterUnifiedPush(slot);
export const getUnifiedPushEndpoint = (slot: string) => need().getUnifiedPushEndpoint(slot);
export const setDisplayConfig = (config: DisplayConfig) => need().setDisplayConfig(config);
export const clearRoom = (slot: string, roomId: string) => need().clearRoom(slot, roomId);
export const clearAll = (slot: string | null) => need().clearAll(slot);

/**
 * This install's notification link key (Android), or null where there is none - iOS, whose
 * notification buttons never travel as links, and builds without the module.
 */
export function getLinkKey(): string | null {
  if (!native || typeof native.getLinkKey !== 'function') return null;
  try {
    const key = native.getLinkKey();
    return typeof key === 'string' && key.length > 0 ? key : null;
  } catch {
    return null;
  }
}

export function addListener<E extends keyof StrafePushEvents>(event: E, listener: StrafePushEvents[E]): EventSubscription {
  return need().addListener(event, listener);
}
