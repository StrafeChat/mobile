/**
 * Microphone and camera permission prompts for calls, asked before joining rather than
 * left to WebRTC: on a phone the OS prompt is the moment to explain, and a refusal found
 * mid-join would only surface as a banner after connecting.
 *
 * A refusal never blocks the call - you can join to listen, as Discord lets you - but the
 * user is told, with a way to Settings when the OS will not ask again.
 */
import { Linking } from 'react-native';
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import { getCameraPermissionsAsync, requestCameraPermissionsAsync } from 'expo-image-picker';
import { t } from '@web/i18n/t';
import { toast } from '@/ui';

export type PermissionOutcome = 'granted' | 'denied' | 'blocked';

interface PermissionLike {
  granted: boolean;
  canAskAgain?: boolean;
}

/** Ask when we may; `blocked` when the OS will not show the prompt again (Settings only). */
export async function ensurePermission(
  get: () => Promise<PermissionLike>,
  request: () => Promise<PermissionLike>,
): Promise<PermissionOutcome> {
  try {
    const current = await get();
    if (current.granted) return 'granted';
    if (current.canAskAgain === false) return 'blocked';
    const asked = await request();
    if (asked.granted) return 'granted';
    return asked.canAskAgain === false ? 'blocked' : 'denied';
  } catch (err) {
    // A permission module that cannot answer (a test build, an odd ROM): let WebRTC try;
    // its own error reaches the stage as the store's micDenied / cameraDenied banner.
    console.warn('[voice] permission check failed', err);
    return 'granted';
  }
}

export function ensureMicPermission(): Promise<PermissionOutcome> {
  return ensurePermission(getRecordingPermissionsAsync, requestRecordingPermissionsAsync);
}

export function ensureCameraPermission(): Promise<PermissionOutcome> {
  return ensurePermission(getCameraPermissionsAsync, requestCameraPermissionsAsync);
}

function settingsAction() {
  return { label: t('common.settings'), onPress: () => void Linking.openSettings().catch(() => undefined) };
}

/** Say what a refusal means for the call, with a way to Settings. */
export function reportPermission(kind: 'mic' | 'camera', outcome: PermissionOutcome): void {
  if (outcome === 'granted') return;
  toast.warning(t(kind === 'mic' ? 'mobile.voice.micOffJoin' : 'mobile.voice.cameraOffJoin'), {
    icon: kind === 'mic' ? 'microphone-slash' : 'video-slash',
    action: settingsAction(),
  });
}
