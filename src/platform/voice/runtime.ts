/**
 * What a call needs from the phone around it, driven by the shared voice store's session:
 * WebRTC globals for livekit-client, the audio session, and on Android the foreground
 * service that keeps the microphone (and camera) alive in the background - whose ongoing
 * notification carries Mute / Unmute and Hang up, run through the store's own actions.
 *
 * The voice store override calls `initMobileVoiceRuntime` once with a reader for its
 * session and its toggleMute / leaveVoiceRoom; nothing here imports the store, so there is
 * no import cycle.
 */
import { AppState, PermissionsAndroid, Platform } from 'react-native';
import { createComputed, createRoot, on } from 'solid-js';
import { registerGlobals } from '@livekit/react-native';
import { t } from '@web/i18n/t';
import { startCallAudio, stopCallAudio } from './audioSession';
import { callServiceRunningWith, onCallServiceEvent, startCallService, stopCallService } from './callService';

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
  selfMute: boolean;
  selfDeaf: boolean;
  serverMute: boolean;
  /** No Speak permission: no microphone, so no mute button either. */
  suppress: boolean;
}

/** The voice store's actions behind the ongoing-call notification's buttons. */
export interface RuntimeActions {
  /** The store's toggleMute (unmuting while deafened undeafens, as in the app). */
  toggleMute(): void;
  /** The store's leaveVoiceRoom. */
  hangUp(): void;
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
/**
 * How many times one call restarts a service that ended on its own. A service that cannot
 * hold the foreground at all (a missing permission) would otherwise be restarted for ever.
 */
const MAX_SERVICE_RESTARTS = 5;

let initialised = false;

/** The microphone as the mute buttons show it: off, and whether you may turn it on. */
function micState(s: RuntimeSession): { off: boolean; canToggle: boolean } {
  return { off: s.selfMute || s.selfDeaf || s.serverMute || s.suppress, canToggle: !s.serverMute && !s.suppress };
}

export function initMobileVoiceRuntime(read: () => RuntimeSession, actions?: RuntimeActions): void {
  if (initialised) return;
  initialised = true;
  ensureLiveKitGlobals();

  let active = false;
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let camera = false;
  let mic = { off: false, canToggle: true };
  let restarts = 0;

  const serviceContent = () => ({
    title: t('voice.connected'),
    text: t('voice.e2ee'),
    channelName: t('voice.connected'),
    // The same labels as the call screen's buttons; none while a moderator holds the mic.
    muteLabel: actions && mic.canToggle ? t(mic.off ? 'voice.unmute' : 'voice.mute') : null,
    hangUpLabel: t('voice.leave'),
  });
  const serviceState = () => ({ camera, muted: mic.off });

  /**
   * Android 14 starts a microphone-typed service only with the microphone permission
   * already granted - which, on someone's first call, happens a moment after connecting,
   * when the store publishes the microphone. Until then, keep checking.
   */
  const ensureService = async () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = undefined;
    if (!active || Platform.OS !== 'android') return;
    // Running already with the right types: only the notification changes (mute state),
    // which needs neither the foreground nor a permission check - a notification button
    // is pressed with the app in the background.
    if (callServiceRunningWith(camera)) {
      await startCallService(serviceContent(), serviceState());
      return;
    }
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
    await startCallService(serviceContent(), serviceState());
  };

  // The notification's buttons, and the service ending on its own while a call is up
  // (refused the foreground, stopped by the system): start it again when allowed.
  onCallServiceEvent({
    action: (action) => {
      if (!actions) return;
      if (action === 'hangup') {
        actions.hangUp();
        return;
      }
      if (active && micState(read()).canToggle) actions.toggleMute();
    },
    stopped: () => {
      if (!active || retryTimer || restarts >= MAX_SERVICE_RESTARTS) return;
      restarts += 1;
      retryTimer = setTimeout(() => void ensureService(), SERVICE_RETRY_MS);
    },
  });

  createRoot(() => {
    createComputed(
      on(
        () => {
          const s = read();
          return { live: s.status !== 'idle', camera: s.camera, mic: micState(s) };
        },
        (next) => {
          camera = next.camera;
          mic = next.mic;
          if (next.live) {
            if (releaseTimer) clearTimeout(releaseTimer);
            releaseTimer = undefined;
            if (!active) {
              active = true;
              restarts = 0;
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
