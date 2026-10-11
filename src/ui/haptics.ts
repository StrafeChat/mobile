/**
 * Haptic feedback, in one place so every surface uses the same vocabulary:
 *
 * - `selection`  - a value changed under the finger (segmented control, picker row, slider step)
 * - `longPress`  - a long-press opened something (action sheet on a message, a member, a room)
 * - `toggle`     - a switch flipped
 * - `impact`     - a light physical "tap" for a committed gesture (swipe-to-reply)
 * - `success` / `warning` / `error` - the outcome of an action the user is waiting on
 *
 * Android gets its own system constants (performAndroidHapticsAsync) where one exists: they
 * follow the user's "touch feedback" setting and feel native, where the generic impact styles
 * are a vibrator pulse. Every call is fire-and-forget and swallows errors - a device without a
 * motor is not a failure.
 *
 * Haptics can be switched off in the app (a user setting, persisted on this device); the OS
 * switches are honoured as well by the platform itself.
 */
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';
import { appStorage } from '@/platform/storage';

const STORAGE_KEY = 'ui.hapticsEnabled';

let enabled = readEnabled();

function readEnabled(): boolean {
  try {
    return appStorage.getBoolean(STORAGE_KEY) !== false;
  } catch {
    return true;
  }
}

/** Whether the app plays haptics (Settings -> Accessibility). Defaults to on. */
export function hapticsEnabled(): boolean {
  return enabled;
}

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
  try {
    appStorage.set(STORAGE_KEY, on);
  } catch {
    /* not persisted; still applies for this run */
  }
}

function run(fn: () => Promise<void>): void {
  if (!enabled) return;
  try {
    void fn().catch(() => undefined);
  } catch {
    /* no haptics engine */
  }
}

const android = Platform.OS === 'android';

/**
 * An Android system haptic, falling back when the device's API level predates it (Confirm,
 * Reject and the toggles arrived in Android 11, the segment ticks in 14; the app supports 8).
 */
function androidHaptic(type: Haptics.AndroidHaptics, fallback: () => Promise<void>): Promise<void> {
  return Haptics.performAndroidHapticsAsync(type).catch(fallback);
}

const clockTick = () => Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Clock_Tick);

export const haptics = {
  selection(): void {
    run(() => (android ? androidHaptic(Haptics.AndroidHaptics.Segment_Tick, clockTick) : Haptics.selectionAsync()));
  },
  longPress(): void {
    run(() =>
      android
        ? Haptics.performAndroidHapticsAsync(Haptics.AndroidHaptics.Long_Press)
        : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
    );
  },
  toggle(on: boolean): void {
    run(() =>
      android
        ? androidHaptic(on ? Haptics.AndroidHaptics.Toggle_On : Haptics.AndroidHaptics.Toggle_Off, clockTick)
        : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
    );
  },
  impact(style: 'light' | 'medium' | 'heavy' = 'light'): void {
    const map = {
      light: Haptics.ImpactFeedbackStyle.Light,
      medium: Haptics.ImpactFeedbackStyle.Medium,
      heavy: Haptics.ImpactFeedbackStyle.Heavy,
    } as const;
    run(() => Haptics.impactAsync(map[style]));
  },
  success(): void {
    run(() =>
      android
        ? androidHaptic(Haptics.AndroidHaptics.Confirm, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success))
        : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
    );
  },
  warning(): void {
    run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  },
  error(): void {
    run(() =>
      android
        ? androidHaptic(Haptics.AndroidHaptics.Reject, () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error))
        : Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
    );
  },
};
