/**
 * Who shows a notification when both the app and a push could.
 *
 * - App not active, open account's pushes working: the push does. The app's own (local)
 *   message notification would be the same message twice, so it stands aside. Active, the
 *   app's notification logic runs as it always has, and the native renderer suppresses the
 *   open account's pushes instead (Android natively; iOS asks the app, below). On iOS "not
 *   active" includes 'inactive' - open, with Notification Center, the app switcher or a call
 *   banner over it - where iOS still hands the app its pushes: both sides then use the same
 *   rule (pushTakesOver), so the message notifies exactly once.
 * - A push for another account on this device is never covered by the running app (it has
 *   no session for it): it always shows.
 * - A test push always shows: it is the answer to "does this work?".
 */
import type { AppStateStatus } from 'react-native';
import { pushDataOf, type PushData } from './links';
import { isValidSlot } from './slots';

/** Local message notifications carry the web's per-room tag. */
function isMessageNotification(n: { tag?: string }): boolean {
  return !!n.tag && n.tag.startsWith('room:');
}

/** The open account's message notifications are the push's, not the app's. */
function pushTakesOver(appState: AppStateStatus, pushActive: boolean): boolean {
  return pushActive && appState !== 'active';
}

/** Keep the app's local notification back? */
export function suppressLocalNotification(n: { tag?: string }, appState: AppStateStatus, pushActive: boolean): boolean {
  return pushTakesOver(appState, pushActive) && isMessageNotification(n);
}

/**
 * How a Strafe push that reached the running app (iOS) is presented. The open account's
 * message push shows exactly when its local notification was held back; its call push never
 * does - while the app runs, the voice store rings for the call itself (ringtone, vibration,
 * the incoming-call screen).
 */
export function presentRemotePush(
  data: PushData,
  activeSlot: string | null,
  sounds: boolean,
  appState: AppStateStatus,
  pushActive: boolean,
): { show: boolean; sound: boolean } {
  if (data.type === 'test' || data.slot !== activeSlot) return { show: true, sound: sounds };
  if (data.type === 'msg' && pushTakesOver(appState, pushActive)) return { show: true, sound: sounds };
  return { show: false, sound: false };
}

/**
 * How a remote notification reaching the running app (iOS) is presented: null when it is not
 * a Strafe push. One that came through the push gateway (its `s`, the slot, is in the APNs
 * payload) but names nothing to route is the extension's "show nothing" content - a push for
 * an account no longer here, or another user - and stays hidden in the foreground too, rather
 * than falling through to the default banner.
 */
export function presentRemoteNotification(
  content: { data?: unknown },
  triggerPayload: unknown,
  activeSlot: string | null,
  sounds: boolean,
  appState: AppStateStatus,
  pushActive: boolean,
): { show: boolean; sound: boolean } | null {
  const data = pushDataOf(content, triggerPayload);
  if (data) return presentRemotePush(data, activeSlot, sounds, appState, pushActive);
  const slot = (triggerPayload as { s?: unknown } | null | undefined)?.s;
  return typeof slot === 'string' && isValidSlot(slot) ? { show: false, sound: false } : null;
}
