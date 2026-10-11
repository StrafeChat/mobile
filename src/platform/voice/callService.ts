/**
 * Keeping a call alive in the background.
 *
 * iOS keeps the app running while its audio session is active (UIBackgroundModes `audio`
 * and `voip` in app.json); nothing to do here. Android stops a backgrounded app's
 * microphone and camera unless a foreground service of the matching type is running, so
 * while a call is up this starts one - `StrafeCallService`, generated into the Android
 * project by plugins/withStrafeCallService.js (a Service with
 * foregroundServiceType="microphone|camera" and a tiny module to start, update and stop it).
 * The service holds nothing but its ongoing notification: the call itself stays in
 * JavaScript and WebRTC, the service only tells the OS it is in use. The notification's
 * Mute and Hang up buttons come back as events (onCallServiceEvent) for the voice runtime
 * to act on, and the runtime keeps their labels current with updates.
 *
 * The camera type is added only while the camera is on: Android 14 refuses a camera-typed
 * service without the camera permission, and the microphone type alone is right for an
 * audio call. Screen sharing has its own mediaProjection service, inside
 * react-native-webrtc (enabled by the LiveKit Expo plugin's enableScreenShareService).
 */
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

/** What the ongoing notification shows (all strings already translated). */
export interface CallServiceContent {
  title: string;
  text: string;
  /** Name of the notification channel in the system settings. */
  channelName: string;
  /** The mute button's label ("Mute" / "Unmute"), or null for no button (server mute, no Speak). */
  muteLabel: string | null;
  /** The hang-up button's label. */
  hangUpLabel: string;
}

export interface CallServiceState {
  camera: boolean;
  /** The microphone is off (drawn on the mute button). */
  muted: boolean;
}

type NativeOptions = CallServiceContent & CallServiceState;

interface CallServiceModule {
  start(options: NativeOptions): Promise<boolean>;
  /** Re-post the running notification; false when the service is not running. */
  update(options: NativeOptions): Promise<boolean>;
  stop(): Promise<boolean>;
}

/** The native module's device event (StrafeCallServiceModule.EVENT). */
export const CALL_SERVICE_EVENT = 'StrafeCallServiceEvent';

export type CallServiceAction = 'mute' | 'hangup';

interface CallServiceEvent {
  type?: string;
  action?: string;
}

function nativeModule(): CallServiceModule | undefined {
  if (Platform.OS !== 'android') return undefined;
  return (NativeModules as { StrafeCallService?: CallServiceModule }).StrafeCallService;
}

let warned = false;
/** What the service was last started or updated with; null while it is not running. */
let running: NativeOptions | null = null;

function sameOptions(a: NativeOptions, b: NativeOptions): boolean {
  return (
    a.camera === b.camera &&
    a.muted === b.muted &&
    a.title === b.title &&
    a.text === b.text &&
    a.channelName === b.channelName &&
    a.muteLabel === b.muteLabel &&
    a.hangUpLabel === b.hangUpLabel
  );
}

/** Whether the service is running with the camera type `camera` (an update is enough). */
export function callServiceRunningWith(camera: boolean): boolean {
  return !!running && running.camera === camera;
}

/**
 * Start the service, change its types (camera on/off), or - running with the same types -
 * update its notification in place. Android only.
 */
export async function startCallService(content: CallServiceContent, state: CallServiceState): Promise<void> {
  const mod = nativeModule();
  if (!mod) {
    if (Platform.OS === 'android' && !warned) {
      warned = true;
      console.warn('[voice] StrafeCallService missing (prebuild without plugins/withStrafeCallService); calls stop in the background');
    }
    return;
  }
  const next: NativeOptions = { ...content, ...state };
  const prev = running;
  if (prev && sameOptions(prev, next)) return;
  running = next;
  if (prev && prev.camera === next.camera) {
    // Same foreground types: a notification update, which (unlike a start) is allowed
    // from the background - where the notification's own buttons are pressed.
    try {
      if (await mod.update(next)) return;
    } catch (err) {
      console.warn('[voice] call notification update failed', err);
    }
    // Not running after all (it stopped itself): start it again below.
  }
  try {
    await mod.start(next);
  } catch (err) {
    // Typically: started from the background (Android 14 forbids a microphone service
    // then) or the camera permission missing for the camera type. The call goes on in the
    // foreground either way.
    console.warn('[voice] call foreground service refused', err);
    if (running === next) running = null;
  }
}

export async function stopCallService(): Promise<void> {
  const mod = nativeModule();
  if (!mod || !running) return;
  running = null;
  try {
    await mod.stop();
  } catch {
    /* already gone */
  }
}

/**
 * The service's notification buttons (Mute / Unmute, Hang up) and its end. `stopped` also
 * comes when the service refused the foreground or was stopped by the system, so the caller
 * can start it again while a call is still up.
 */
export function onCallServiceEvent(handlers: { action?: (action: CallServiceAction) => void; stopped?: () => void }): () => void {
  if (Platform.OS !== 'android') return () => undefined;
  const sub = DeviceEventEmitter.addListener(CALL_SERVICE_EVENT, (ev: CallServiceEvent | undefined) => {
    if (ev?.type === 'stopped') {
      running = null;
      handlers.stopped?.();
    } else if (ev?.type === 'action' && (ev.action === 'mute' || ev.action === 'hangup')) {
      handlers.action?.(ev.action);
    }
  });
  return () => sub.remove();
}
