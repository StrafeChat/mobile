/**
 * What the voice area mounts once at the root of the app (the integrator renders
 * <VoiceHosts/> beside the other hosts):
 *
 * - the incoming-call screen;
 * - the per-user voice sheet, voice statistics and the screen-share picker, which tiles, the
 *   dock and room-list rows open from anywhere;
 * - the screen stays awake for the whole of a call (expo-keep-awake), so a video call or a
 *   long voice session is not cut short by the display sleeping - unless the call is on
 *   the earpiece, held to the face;
 * - on iOS, which stops the camera of an app in the background, the camera is turned off
 *   when the app leaves the foreground (so others see your avatar, not a frozen frame) and
 *   back on when it returns. Android keeps it running under the call's foreground service.
 */
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSolid } from '@/bridge/solid';
import { setCameraEnabled, voice } from '@web/stores/voice';
import { audioSessionActive, speakerphone } from '@/platform/voice';
import { useExternalStore } from '@/ui';
import { currentRoute, pickedRouteStore } from './audioRoute';
import { IncomingCallOverlay } from './IncomingCallOverlay';
import { ScreenShareSheetHost } from './ScreenShareSheet';
import { VoiceStatsSheetHost } from './VoiceStatsSheet';
import { VoiceUserSheetHost } from './VoiceUserSheet';

const KEEP_AWAKE_TAG = 'strafe-voice-call';

/**
 * Holds the screen on while this device is in (or joining) a call - except for an audio
 * call on the earpiece, where the phone is held to the face: a display kept on there takes
 * cheek presses (the hang-up button), so it is left to sleep as for any phone call.
 */
export function useCallKeepAwake(): void {
  const inCall = useSolid(() => voice.session.status !== 'idle');
  const speakerOn = useSolid(() => speakerphone());
  const picked = useExternalStore(pickedRouteStore);
  // Video (yours or anyone's) is watched, not held to the ear: awake on any route.
  const video = useSolid(() => voice.session.camera || Object.values(voice.media).some((m) => !!(m?.camera || m?.screen)));
  const awake = inCall && (video || currentRoute(speakerOn, picked) !== 'earpiece');
  useEffect(() => {
    if (!awake) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    return () => {
      void Promise.resolve(deactivateKeepAwake(KEEP_AWAKE_TAG)).catch(() => undefined);
    };
  }, [awake]);
}

/**
 * The headset / Bluetooth route picked in a call belongs to that call: once its audio
 * session has ended (not at the brief idle of a move, which keeps the session), the next
 * call starts from the saved preference instead of showing a stale headset icon.
 */
export function useForgetRouteAfterCall(): void {
  const sessionOn = useSolid(() => audioSessionActive());
  useEffect(() => {
    if (!sessionOn) pickedRouteStore.set('');
  }, [sessionOn]);
}

/** iOS: camera off in the background, back on when the app returns (see above). */
export function useCameraBackgroundPause(): void {
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    let paused: string | null = null;
    const sub = AppState.addEventListener('change', (next) => {
      const s = voice.session;
      if (next === 'background' && s.status !== 'idle' && s.camera) {
        paused = s.roomId;
        void setCameraEnabled(false);
      } else if (next === 'active' && paused) {
        const room = paused;
        paused = null;
        if (voice.session.roomId === room && voice.session.status !== 'idle' && !voice.session.camera) void setCameraEnabled(true);
      }
    });
    return () => sub.remove();
  }, []);
}

export function VoiceHosts() {
  useCallKeepAwake();
  useCameraBackgroundPause();
  useForgetRouteAfterCall();
  return (
    <>
      <VoiceUserSheetHost />
      <VoiceStatsSheetHost />
      <ScreenShareSheetHost />
      <IncomingCallOverlay />
    </>
  );
}
