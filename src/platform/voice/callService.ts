/**
 * Keeping a call alive in the background.
 *
 * iOS keeps the app running while its audio session is active (UIBackgroundModes `audio`
 * and `voip` in app.json); nothing to do here. Android stops a backgrounded app's
 * microphone and camera unless a foreground service of the matching type is running, so
 * while a call is up this starts one - `StrafeCallService`, generated into the Android
 * project by plugins/withStrafeCallService.js (a Service with
 * foregroundServiceType="microphone|camera" and a tiny module to start and stop it).
 * The service holds nothing but its ongoing notification: the call itself stays in
 * JavaScript and WebRTC, the service only tells the OS it is in use.
 *
 * The camera type is added only while the camera is on: Android 14 refuses a camera-typed
 * service without the camera permission, and the microphone type alone is right for an
 * audio call. Screen sharing has its own mediaProjection service, inside
 * react-native-webrtc (enabled by the LiveKit Expo plugin's enableScreenShareService).
 */
import { NativeModules, Platform } from 'react-native';

interface CallServiceModule {
  start(options: { title: string; text: string; channelName: string; camera: boolean }): Promise<boolean>;
  stop(): Promise<boolean>;
}

function nativeModule(): CallServiceModule | undefined {
  if (Platform.OS !== 'android') return undefined;
  return (NativeModules as { StrafeCallService?: CallServiceModule }).StrafeCallService;
}

let warned = false;
let running: { camera: boolean } | null = null;

export interface CallServiceContent {
  title: string;
  text: string;
  /** Name of the notification channel in the system settings. */
  channelName: string;
}

/** Start the service, or update its types (camera on/off). Android only. */
export async function startCallService(content: CallServiceContent, camera: boolean): Promise<void> {
  const mod = nativeModule();
  if (!mod) {
    if (Platform.OS === 'android' && !warned) {
      warned = true;
      console.warn('[voice] StrafeCallService missing (prebuild without plugins/withStrafeCallService); calls stop in the background');
    }
    return;
  }
  if (running && running.camera === camera) return;
  running = { camera };
  try {
    await mod.start({ ...content, camera });
  } catch (err) {
    // Typically: started from the background (Android 14 forbids a microphone service
    // then) or the camera permission missing for the camera type. The call goes on in the
    // foreground either way.
    console.warn('[voice] call foreground service refused', err);
    running = null;
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
