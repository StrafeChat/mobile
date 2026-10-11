/**
 * Push notifications, the JavaScript half: registration, routing, suppression. The native
 * half (keys, transports, decryption, rendering) is modules/strafe-push; the design and
 * wire formats are docs/PUSH.md in StrafeChat/deploy.
 *
 * For the rest of the app:
 *   installPushLifecycle()          once, from the app wiring
 *   ensurePushRegistration()        re-check now (Settings after a change)
 *   forgetPushAccount(id, opts)     an account leaves this device (session.ts)
 *   pushStatus() / pushCapabilities()   what Settings shows (reactive)
 *   routePushTarget(target)         open what a push was about (+native-intent)
 */
export { installPushLifecycle, clearPushRoom } from './lifecycle';
export { ensurePushRegistration, forgetPushAccount } from './registration';
export { pushStatus, pushCapabilities, pushIsActive, type PushStatus, type TransportInfo, type NoTransportReason } from './status';
export { pushEnabled, setPushEnabled, transportPref, setTransportPref, type TransportPref } from './config';
export { parsePushUrl, buildPushUrl, type PushTarget } from './links';
export { routePushTarget } from './routing';
export { sendTestPush } from './api';
export { activePushAccount } from './accounts';
