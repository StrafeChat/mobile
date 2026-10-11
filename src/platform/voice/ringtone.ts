/**
 * The incoming-call ringtone - same exports and rules as web/src/lib/voice/ringtone.ts.
 *
 * The web synthesises two soft tones every two seconds with Web Audio. There is no
 * oscillator to run here, so the same tones are a bundled loop (assets/ringtone.wav,
 * rendered by assets/make-ringtone.mjs from the web's frequencies and envelope) played
 * with expo-audio at the web's level: 0.15 x the notification volume, silent when
 * notification sounds are off. Like the web it does not consult Do Not Disturb.
 *
 * A phone also vibrates while ringing (the web has nothing to vibrate); that follows the
 * same sounds switch, so turning notification sounds off quiets both.
 */
import { Vibration } from 'react-native';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { notificationPrefs } from '@web/stores/notificationPrefs';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const RINGTONE: number = require('./assets/ringtone.wav');

/** Ring, pause, ring, long pause - in step with the two-second tone loop. */
const VIBRATION_PATTERN = [0, 350, 50, 350, 1250];

let player: AudioPlayer | null = null;

export function playRingtone(): void {
  stopRingtone();
  const volume = notificationPrefs.sounds ? notificationPrefs.volume : 0;
  if (volume <= 0) return;
  try {
    player = createAudioPlayer(RINGTONE);
    player.loop = true;
    player.volume = Math.min(1, Math.max(0, 0.15 * volume));
    player.play();
  } catch (err) {
    console.warn('[voice] ringtone unavailable', err);
    player = null;
  }
  Vibration.vibrate(VIBRATION_PATTERN, true);
}

export function stopRingtone(): void {
  Vibration.cancel();
  const p = player;
  player = null;
  if (!p) return;
  try {
    p.pause();
    p.remove();
  } catch {
    /* already released */
  }
}
