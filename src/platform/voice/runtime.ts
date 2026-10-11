/**
 * What a call needs from the phone around it, driven by the shared voice store's session:
 * WebRTC globals for livekit-client, the audio session, and on Android the foreground
 * service that keeps the microphone (and camera) alive in the background.
 *
 * The voice store override calls `initMobileVoiceRuntime` once with a reader for its
 * session; nothing here imports the store, so there is no import cycle.
 */
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { createComputed, createRoot, on } from 'solid-js';
import { registerGlobals } from '@livekit/react-native';
import { t } from '@web/i18n/t';
import { startCallAudio, stopCallAudio } from './audioSession';
import { startCallService, stopCallService } from './callService';

let globalsRegistered = false;

/**
 * livekit-client on React Native: RTCPeerConnection, getUserMedia & co. from
 * @livekit/react-native-webrtc, plus the iOS audio session following the audio engine.
 * Idempotent; done before anything constructs a Room.
 */
export function ensureLiveKitGlobals(): void {
  if (globalsRegistered) return;
  globalsRegistered = true;
  registerGlobals({ autoConfigureAudioSession: true });
}

export interface RuntimeSession {
  status: 'idle' | 'connecting' | 'connected' | 'reconnecting';
  camera: boolean;
}

/**
 * A call that ends and immediately starts again (a moderator move, a reconnect, switching
 * rooms) passes through idle for a moment. Releasing the session and the service only
 * after this long keeps them across that gap - which matters on Android, where a
 * backgrounded app may keep a microphone service it has but may not start a new one.
 */
const RELEASE_GRACE_MS = 2_000;
/** While a call runs without its service (permission not granted yet), check this often. */
const SERVICE_RETRY_MS = 2_000;

let initialised = false;

export function initMobileVoiceRuntime(read: () => RuntimeSession): void {
  if (initialised) return;
  initialised = true;
  ensureLiveKitGlobals();

  let active = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let camera = false;

  const serviceContent = () => ({
    title: t('voice.connected'),
    text: t('voice.e2ee'),
    channelName: t('voice.connected'),
  });

  /**
   * Android 14 starts a microphone-typed service only with the microphone permission
   * already granted - which, on someone's first call, happens a moment after connecting,
   * when the store publishes the microphone. Until then, keep checking.
   */
  const ensureService = async () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    if (!active || Platform.OS !== 'android') return;
    let granted = true;
    try {
      granted = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    } catch {
      /* assume granted; the service start reports otherwise */
    }
    if (!active) return;
    if (!granted || AppState.currentState !== 'active') {
      retryTimer = setTimeout(() => void ensureService(), SERVICE_RETRY_MS);
      return;
    }
    await startCallService(serviceContent(), camera);
  };

  createRoot(() => {
    createComputed(
      on(
        () => {
          const s = read();
          return { live: s.status !== 'idle', camera: s.camera };
        },
        (next) => {
          camera = next.camera;
          if (next.live) {
            if (releaseTimer) clearTimeout(releaseTimer);
            releaseTimer = undefined;
            if (!active) {
              active = true;
              void startCallAudio().catch((err) => console.warn('[voice] audio session did not start', err));
            }
            void ensureService();
            return;
          }
          if (!active || releaseTimer) return;
          releaseTimer = setTimeout(() => {
            releaseTimer = undefined;
            active = false;
            if (retryTimer) clearTimeout(retryTimer);
            void stopCallService();
            void stopCallAudio().catch(() => undefined);
          }, RELEASE_GRACE_MS);
        },
      ),
    );
  });
}
