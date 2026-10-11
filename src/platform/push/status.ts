/**
 * Where push stands for the account that is open - what Settings -> Notifications shows,
 * and what decides whether the in-app notification path stands aside in the background.
 */
import { createSignal } from 'solid-js';
import type { PushCapabilities } from '@strafe/push';

export type TransportKind = 'fcm' | 'apns' | 'unifiedpush' | 'debug';

export interface TransportInfo {
  kind: TransportKind;
  /** UnifiedPush: the distributor's package and its name. */
  distributorId?: string;
  distributorName?: string;
}

/** Why no transport could be used (Android). */
export type NoTransportReason =
  /** Neither Firebase (this build or this device) nor any UnifiedPush distributor. */
  | 'none'
  /** Automatic, no Firebase, and several distributors: the person has to pick one. */
  | 'choose-distributor'
  /** Firebase was chosen but this build or device does not have it. */
  | 'fcm-unavailable'
  /** The chosen distributor is no longer installed. */
  | 'distributor-missing';

export type PushStatus =
  /** Not evaluated yet. */
  | { state: 'idle' }
  /** This build has no native push module (Expo Go, tests). */
  | { state: 'unavailable' }
  /** Turned off on this device. */
  | { state: 'disabled' }
  | { state: 'signed-out' }
  /** The OS does not let Strafe post notifications. */
  | { state: 'permission' }
  | { state: 'no-transport'; reason: NoTransportReason }
  | { state: 'registering'; transport: TransportInfo | null }
  | { state: 'active'; transport: TransportInfo }
  | {
      state: 'error';
      /** transport: no token from APNs / Firebase; gateway: no endpoint from the push gateway;
       * distributor: UnifiedPush refused or timed out; instance: the instance refused the
       * subscription; unsupported: the instance has no push (or has it switched off). */
      where: 'transport' | 'gateway' | 'distributor' | 'instance' | 'unsupported';
      transport: TransportInfo | null;
      detail?: string;
    };

const [status, setStatusSignal] = createSignal<PushStatus>({ state: 'idle' });
const [capabilities, setCapabilitiesSignal] = createSignal<PushCapabilities | null>(null);

/** The open account's push status; reactive. */
export function pushStatus(): PushStatus {
  return status();
}

export function setPushStatus(next: PushStatus): void {
  setStatusSignal(next);
}

/** What the device offers (transports, distributors); null until first read. Reactive. */
export function pushCapabilities(): PushCapabilities | null {
  return capabilities();
}

export function setPushCapabilities(caps: PushCapabilities | null): void {
  setCapabilitiesSignal(caps);
}

/** Pushes reach this device for the open account. */
export function pushIsActive(): boolean {
  return status().state === 'active';
}
