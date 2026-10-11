/**
 * Mobile replacement for web/src/lib/notifications.ts - the web's decision logic, run as is.
 *
 * Whether an incoming message notifies is one set of rules shared with the web: muted rooms,
 * the room's own notify mode over the space default over the global per-room-type default,
 * "only mentions" (direct, @everyone/@here, and role mentions), Do Not Disturb, never your own
 * or system messages, and not for the room you are looking at unless "while focused" is on. It
 * has had real bugs fixed in it (space channels once took the PM rules), so it is not copied:
 * this module calls the web's maybeNotifyMessage.
 *
 * The one thing that function reads that the app lacks is `document.visibilityState` - "is the
 * tab on screen". The app deliberately has no global `document` (see shims/window.ts), so for
 * the duration of that synchronous call only, a `document` carrying nothing but the visibility
 * - from AppState: on screen only while the app is active - stands in for it. Everything else
 * it uses is already provided:
 *
 * - the room on screen is `window.location.pathname` (/rooms/:id or /spaces/:sid/rooms/:id),
 *   which the shell keeps current through shims/window.ts's setLocationPath;
 * - the sound and the system notification go through stores/notificationPrefs, overridden with
 *   expo-notifications (the chime rides on the notification);
 * - a tap calls requestNavigate(path), a `strafe:navigate` window event (the window shim
 *   provides CustomEvent and dispatchEvent); the app routes it from onNavigateRequest.
 */
import { AppState } from 'react-native';
import { maybeNotifyMessage as decideAndNotify } from '@web-original/lib/notifications';

export { onNavigateRequest, requestNavigate } from '@web-original/lib/notifications';

interface VisibilityOnlyDocument {
  readonly visibilityState: 'visible' | 'hidden';
  readonly hidden: boolean;
}

function appVisibility(): 'visible' | 'hidden' {
  return AppState.currentState === 'active' ? 'visible' : 'hidden';
}

/**
 * Run `fn` with a visibility-only `document` installed, removed again before returning. Only
 * when there is no `document` already (there never is in the app; a test may provide one).
 */
function withVisibilityDocument(fn: () => void): void {
  const g = globalThis as { document?: unknown };
  if (g.document !== undefined) {
    fn();
    return;
  }
  const visibilityState = appVisibility();
  const doc: VisibilityOnlyDocument = { visibilityState, hidden: visibilityState === 'hidden' };
  g.document = doc;
  try {
    fn();
  } finally {
    delete g.document;
  }
}

/** Notify for a message that just arrived, if the person's preferences say so. */
export function maybeNotifyMessage(roomId: string, messageId: string): void {
  try {
    withVisibilityDocument(() => decideAndNotify(roomId, messageId));
  } catch (e) {
    // If the web logic starts reading more of `document` than its visibility, this is where it
    // shows: a warning per message rather than an unhandled rejection in the message pipeline.
    console.warn('[notifications] could not decide on a notification', e);
  }
}
