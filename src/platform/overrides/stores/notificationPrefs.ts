/**
 * Mobile replacement for web/src/stores/notificationPrefs.ts.
 *
 * Kept from the web module: the preferences store and its persistence (`strafe_notifications`
 * in localStorage, so MMKV), and the permission pair - desktopPermission() /
 * requestDesktopPermission() already take their native branch, because isDesktop() is true here
 * and desktop/native is the expo-notifications override.
 *
 * Replaced, because they are browser APIs:
 *
 * - showDesktopNotification() posts a local notification (src/platform/notifications.ts),
 *   tagged per room so a newer one replaces the older, with the caller's onClick as its tap
 *   action and the room id (and its space) in its data, so a tap that launches the app can
 *   still route.
 *
 * - playNotificationSound(). The web synthesises a two-note chime with Web Audio. Here the
 *   chime is the *notification's own sound*: lib/notifications (and the settings "test"
 *   button) call playNotificationSound() and then showDesktopNotification() in the same turn,
 *   so the sound request is held until the end of the turn and, when a notification is posted,
 *   travels with it as its `sound`. The system plays it: the device's notification tone, at the
 *   notification volume, silenced by the ringer switch and Focus modes, never touching the
 *   app's audio session. expo-audio is deliberately not used and no chime asset is shipped:
 *   playing through it would activate the app's shared AVAudioSession (stopping the person's
 *   music under the default category) and deactivate it after the chime - which cuts a voice
 *   call's audio - and on Android it would take transient audio focus from a call. When no
 *   notification follows (system notifications off, permission denied, a friend request), the
 *   sound-only cue is a light haptic tap until the platform layer offers a sound-only
 *   notification presentation.
 *
 * The notification permission is primed at load and re-read whenever the app comes back to the
 * foreground (the person may have changed it in the system settings), so desktopPermission()
 * can answer synchronously, as the web's does.
 */
import { AppState } from 'react-native';
import * as Haptics from 'expo-haptics';
import { nativeNotificationsGranted } from '../desktop/native';
import { desktopPermission, notificationPrefs } from '@web-original/stores/notificationPrefs';
import type { DesktopNotificationOptions } from '@web-original/stores/notificationPrefs';
import { showLocalNotification, type LocalNotification } from '../../notifications';
import { spaceIdOfRoom } from '../../rooms';

export {
  desktopPermission,
  notificationPrefs,
  requestDesktopPermission,
  setNotificationPrefs,
  setNotificationPrefsStore,
} from '@web-original/stores/notificationPrefs';
export type {
  DesktopNotificationOptions,
  DesktopPermission,
  NotificationPrefs,
  PmNotifyMode,
  SpaceNotifyMode,
} from '@web-original/stores/notificationPrefs';

/**
 * A local notification that may carry the notification sound. `sound` is honoured by
 * src/platform/notifications.ts once it supports it (requested); until then the field is
 * ignored and notifications stay silent, as they are today.
 */
type SoundedNotification = LocalNotification & { sound?: boolean };

void nativeNotificationsGranted();
AppState.addEventListener('change', (state) => {
  if (state === 'active') void nativeNotificationsGranted();
});

// ---- sound -----------------------------------------------------------------------------------

let chimeWanted = false;
let chimeFlushQueued = false;

/** Take the sound requested this turn, if any, so a notification can carry it. */
function takeChime(): boolean {
  const wanted = chimeWanted;
  chimeWanted = false;
  return wanted;
}

function chimeWithoutNotification(): void {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

/**
 * Ask for the notification chime. Volume 0..1 as on the web; nothing at 0. The sound is the
 * notification's, if one is posted before this turn ends, otherwise a haptic tap.
 */
export function playNotificationSound(volume = notificationPrefs.volume): void {
  if (!(volume > 0)) return;
  chimeWanted = true;
  if (chimeFlushQueued) return;
  chimeFlushQueued = true;
  queueMicrotask(() => {
    chimeFlushQueued = false;
    if (takeChime()) chimeWithoutNotification();
  });
}

// ---- notifications ---------------------------------------------------------------------------

/** `room:<id>` is the web's per-room tag (lib/notifications); the id routes a cold-start tap. */
function roomIdFromTag(tag: string | undefined): string | null {
  const m = tag ? /^room:(\d+)$/.exec(tag) : null;
  return m ? m[1]! : null;
}

/** Shows a system notification when permission has been granted. Returns whether it was posted. */
export function showDesktopNotification(opts: DesktopNotificationOptions): boolean {
  if (desktopPermission() !== 'granted') return false;
  const roomId = roomIdFromTag(opts.tag);
  const notification: SoundedNotification = {
    title: opts.title,
    ...(opts.body ? { body: opts.body } : {}),
    ...(opts.tag ? { tag: opts.tag } : {}),
    ...(opts.onClick ? { onPress: opts.onClick } : {}),
    // The space too ('' for a PM): a tap that launches the app routes before READY.
    ...(roomId ? { data: { roomId, spaceId: spaceIdOfRoom(roomId) ?? '' } } : {}),
    sound: takeChime(),
  };
  void showLocalNotification(notification);
  return true;
}
