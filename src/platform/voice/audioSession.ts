/**
 * The phone's audio session for calls: voice-chat mode, routing (speaker, earpiece,
 * wired headset, Bluetooth) and the platform voice processing.
 *
 * On the web the browser owns all of this and "output device" is a sink id. On a phone the
 * OS routes a call's audio as a whole, so:
 *
 * - **Session.** Android needs LiveKit's AudioSession started before connecting (audio
 *   focus, MODE_IN_COMMUNICATION, which is what makes the hardware echo canceller and
 *   Bluetooth SCO work) and stopped afterwards. iOS's AVAudioSession is configured by
 *   @livekit/react-native from the WebRTC audio engine's own lifecycle (registerGlobals'
 *   automatic configuration: playAndRecord + voiceChat while the microphone runs), so
 *   start/stop there only add the route preference. ./runtime.ts calls start/stop as the
 *   voice session leaves and returns to idle.
 * - **Routes.** `voiceSettings.outputDeviceId` holds a route on mobile: '' (automatic -
 *   Bluetooth, then a wired headset, then the speaker), 'speaker', 'earpiece', 'headset',
 *   'bluetooth' (Android's ids; iOS knows 'speaker'/'earpiece' and offers the system route
 *   picker for the rest). The in-call speaker button flips speaker/earpiece for this call
 *   without changing the saved preference. The microphone follows the route (a Bluetooth
 *   headset's microphone comes with its speaker), which is why input device selection has
 *   no separate meaning here.
 * - **Processing.** Echo cancellation / noise suppression / gain control are capture
 *   constraints (./micPipeline.ts); on iOS the voice-processing I/O unit does all three as
 *   one, so it is bypassed only when both echo cancellation and noise suppression are off
 *   (bypassing it for "suppression off" alone would also remove echo cancellation, and a
 *   phone on speaker without it feeds every voice back to its owner), and its AGC follows
 *   the gain-control setting.
 */
import { Platform } from 'react-native';
import { createSignal } from 'solid-js';
import { AudioDeviceModule, AudioSession, AndroidAudioTypePresets, setupIOSAudioManagement } from '@livekit/react-native';
import { voiceSettings } from '@web/stores/voiceSettings';

export type AudioRoute = '' | 'speaker' | 'earpiece' | 'headset' | 'bluetooth';

const [speakerphone, setSpeakerphoneSignal] = createSignal(true);
const [sessionActive, setSessionActive] = createSignal(false);

/** Whether the call plays through the loudspeaker (false: earpiece or a headset route). */
export { speakerphone, sessionActive };

/** Native session calls run one at a time, in the order they were asked for. */
let queue: Promise<void> = Promise.resolve();
function serial(fn: () => Promise<void>): Promise<void> {
  queue = queue.catch(() => undefined).then(fn);
  return queue;
}

function savedRoute(): AudioRoute {
  const v = voiceSettings.outputDeviceId;
  return v === 'speaker' || v === 'earpiece' || v === 'headset' || v === 'bluetooth' ? v : '';
}

/** Android's preference order for automatic routing, the saved route first if any. */
export function preferredOutputs(route: AudioRoute): ('speaker' | 'earpiece' | 'headset' | 'bluetooth')[] {
  const auto: ('speaker' | 'earpiece' | 'headset' | 'bluetooth')[] = ['bluetooth', 'headset', 'speaker', 'earpiece'];
  if (!route) return auto;
  return [route, ...auto.filter((r) => r !== route)];
}

/** Configure and start the session for a call. Safe to call while already started. */
export function startCallAudio(): Promise<void> {
  return serial(async () => {
    if (sessionActive()) return;
    const route = savedRoute();
    setSpeakerphoneSignal(route === '' || route === 'speaker');
    if (Platform.OS === 'ios') setupIOSAudioManagement(route !== 'earpiece');
    await AudioSession.configureAudio({
      android: {
        preferredOutputList: preferredOutputs(route),
        audioTypeOptions: AndroidAudioTypePresets.communication,
      },
      ios: { defaultOutput: route === 'earpiece' ? 'earpiece' : 'speaker' },
    });
    await AudioSession.startAudioSession();
    setSessionActive(true);
  });
}

/** Give the audio session back (audio focus, communication mode). */
export function stopCallAudio(): Promise<void> {
  return serial(async () => {
    if (!sessionActive()) return;
    setSessionActive(false);
    await AudioSession.stopAudioSession();
  });
}

/** Loudspeaker on/off for the current call. */
export function setSpeakerphone(on: boolean): Promise<void> {
  setSpeakerphoneSignal(on);
  return serial(async () => {
    if (Platform.OS === 'ios') {
      setupIOSAudioManagement(on);
      await AudioSession.selectAudioOutput(on ? 'force_speaker' : 'default');
    } else {
      await AudioSession.selectAudioOutput(on ? 'speaker' : 'earpiece');
    }
  });
}

export function toggleSpeakerphone(): Promise<void> {
  return setSpeakerphone(!speakerphone());
}

/**
 * Routes the device offers right now: Android lists 'speaker', 'earpiece', 'headset',
 * 'bluetooth' as connected; iOS only distinguishes 'default' / 'force_speaker' and uses
 * the system picker (showAudioRoutePicker) for headsets and AirPlay.
 */
export function listAudioOutputs(): Promise<string[]> {
  return AudioSession.getAudioOutputs().catch(() => []);
}

/** Route the call to one of listAudioOutputs()'s ids ('' = automatic). */
export function selectAudioRoute(route: string): Promise<void> {
  return serial(async () => {
    if (!sessionActive()) return;
    if (Platform.OS === 'ios') {
      await AudioSession.selectAudioOutput(route === 'speaker' || route === 'force_speaker' ? 'force_speaker' : 'default');
      setSpeakerphoneSignal(route === 'speaker' || route === 'force_speaker' || route === '');
      return;
    }
    if (!route) {
      await AudioSession.configureAudio({
        android: { preferredOutputList: preferredOutputs(''), audioTypeOptions: AndroidAudioTypePresets.communication },
      });
      setSpeakerphoneSignal(true);
      return;
    }
    await AudioSession.selectAudioOutput(route);
    setSpeakerphoneSignal(route === 'speaker');
  });
}

/** iOS: the system route picker (AirPods, car, AirPlay). No-op elsewhere. */
export function showAudioRoutePicker(): Promise<void> {
  return AudioSession.showAudioRoutePicker().catch(() => undefined);
}

/** Apply the processing switches that are not capture constraints (iOS only; see above). */
export async function applyVoiceProcessing(p: {
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}): Promise<void> {
  if (Platform.OS !== 'ios') return;
  try {
    AudioDeviceModule.setVoiceProcessingBypassed(!p.echoCancellation && !p.noiseSuppression);
    AudioDeviceModule.setVoiceProcessingAGCEnabled(p.autoGainControl);
  } catch (err) {
    console.warn('[voice] could not apply voice processing settings', err);
  }
}
