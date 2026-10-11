/**
 * The audio-session mode for message media (voice messages, audio and video attachments), and
 * the rule that a call's session is never touched.
 *
 * expo-audio's `setAudioModeAsync` does not merge: every field left out falls back to its
 * default, and on iOS the defaults mean "muted by the silent switch, mixed under other apps".
 * So the media layer only ever applies one of two complete modes:
 *
 * - **playback**: plays with the ringer switch on silent (a voice message someone tapped is
 *   meant to be heard) and pauses other apps' audio while it plays, like any media player;
 * - **recording**: the same, plus the microphone (iOS play-and-record, speaker output).
 *
 * During a voice call the call owns the session (LiveKit configures it for two-way audio);
 * changing the category under it would cut the call's microphone. The voice layer registers
 * `setAudioSessionGuard(() => callActive)`, and while it answers true nothing here changes
 * the mode.
 */
import { setAudioModeAsync, type AudioMode } from 'expo-audio';

const PLAYBACK: AudioMode = {
  playsInSilentMode: true,
  interruptionMode: 'doNotMix',
  allowsRecording: false,
  shouldPlayInBackground: false,
  shouldRouteThroughEarpiece: false,
};

const RECORDING: AudioMode = { ...PLAYBACK, allowsRecording: true };

let isBusy: (() => boolean) | null = null;

/** Register who else may own the audio session (the voice layer: "is a call active?"). */
export function setAudioSessionGuard(guard: (() => boolean) | null): void {
  isBusy = guard;
}

export function audioSessionBusy(): boolean {
  try {
    return isBusy?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Put the session in the mode message media needs. Resolves false, changing nothing, while a
 * call owns the session; rejects if the platform refuses the mode.
 */
export async function applyMessageAudioMode(kind: 'playback' | 'recording'): Promise<boolean> {
  if (audioSessionBusy()) return false;
  await setAudioModeAsync(kind === 'recording' ? RECORDING : PLAYBACK);
  return true;
}
