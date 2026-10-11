/**
 * Push settings that belong to this device, and what this build was configured with.
 *
 * The person's choices (on/off, which transport on Android) are per device, like the web's
 * notification preferences: MMKV under `strafe.push.*` in the app store, not the web
 * stores' localStorage, because they mean nothing to the web client. Reactive through a
 * signal so the settings screen and the registration lifecycle both see a change at once.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { createSignal } from 'solid-js';
import { appStorage } from '../storage';

export const ENABLED_KEY = 'strafe.push.enabled';
export const TRANSPORT_KEY = 'strafe.push.transport';

/** The gateway the published app build registers with; app.config.js's `extra.pushGateway`. */
export const DEFAULT_PUSH_GATEWAY = 'https://push.strafe.chat';

/**
 * Android's transport choice. `auto`: Firebase when this build and device have it, else the
 * one installed UnifiedPush distributor. `debug` exists in development builds only (the
 * gateway's in-memory debug platform, replayed into the app by adb - see the gateway docs).
 */
export type TransportPref = 'auto' | 'fcm' | 'debug' | `unifiedpush:${string}`;

function readEnabled(): boolean {
  try {
    return appStorage.getBoolean(ENABLED_KEY) ?? true;
  } catch {
    return true;
  }
}

function parseTransport(raw: string | undefined): TransportPref {
  if (raw === 'fcm' || raw === 'auto') return raw;
  // A development build's choice must not survive into a release build's reading of it.
  if (raw === 'debug') return __DEV__ ? 'debug' : 'auto';
  if (raw && raw.startsWith('unifiedpush:') && raw.length > 'unifiedpush:'.length) return raw as TransportPref;
  return 'auto';
}

function readTransport(): TransportPref {
  try {
    return parseTransport(appStorage.getString(TRANSPORT_KEY));
  } catch {
    return 'auto';
  }
}

const [enabled, setEnabledSignal] = createSignal(readEnabled());
const [transport, setTransportSignal] = createSignal<TransportPref>(readTransport());

/** Push on for this device (default on); reactive. */
export function pushEnabled(): boolean {
  return enabled();
}

export function setPushEnabled(on: boolean): void {
  appStorage.set(ENABLED_KEY, on);
  setEnabledSignal(on);
}

/** The Android transport choice; reactive. Always `auto` on iOS (APNs is the only one). */
export function transportPref(): TransportPref {
  return Platform.OS === 'ios' ? 'auto' : transport();
}

export function setTransportPref(next: TransportPref): void {
  const value = parseTransport(next);
  appStorage.set(TRANSPORT_KEY, value);
  setTransportSignal(value);
}

/** The distributor a `unifiedpush:<id>` choice names, else null. */
export function distributorOf(pref: TransportPref): string | null {
  return pref.startsWith('unifiedpush:') ? pref.slice('unifiedpush:'.length) : null;
}

interface BuildExtra {
  pushGateway?: unknown;
}

/** The push gateway's base URL (no trailing slash). */
export function pushGatewayUrl(): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as BuildExtra;
  const url = typeof extra.pushGateway === 'string' && /^https?:\/\//i.test(extra.pushGateway) ? extra.pushGateway : DEFAULT_PUSH_GATEWAY;
  return url.replace(/\/+$/, '');
}
