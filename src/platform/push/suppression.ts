/**
 * Who shows a notification when both the app and a push could.
 *
 * - App in the background, open account's pushes working: the push does. The app's own
 *   (local) message notification would be the same message twice, so it stands aside.
 *   In the foreground the app's notification logic runs as it always has, and the native
 *   renderer suppresses the open account's pushes instead (Android natively; iOS asks the
 *   app, below).
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

/** Keep the app's local notification back? */
export function suppressLocalNotification(n: { tag?: string }, appState: AppStateStatus, pushActive: boolean): boolean {
  return pushActive && appState !== 'active' && isMessageNotification(n);
}

/** How a Strafe push that reached the running app (iOS) is presented. */
export function presentRemotePush(data: PushData, activeSlot: string | null, sounds: boolean): { show: boolean; sound: boolean } {
  if (data.type === 'test' || data.slot !== activeSlot) return { show: true, sound: sounds };
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
): { show: boolean; sound: boolean } | null {
  const data = pushDataOf(content, triggerPayload);
  if (data) return presentRemotePush(data, activeSlot, sounds);
  const slot = (triggerPayload as { s?: unknown } | null | undefined)?.s;
  return typeof slot === 'string' && isValidSlot(slot) ? { show: false, sound: false } : null;
}
