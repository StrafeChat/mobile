/**
 * "One thing plays at a time" for native players, through the web's stores/mediaPlayback.
 *
 * The web store pauses whatever was playing when another player claims playback, and only
 * ever reads `.paused` and calls `.pause()` on what it holds. expo-audio's AudioPlayer and
 * expo-video's VideoPlayer both expose `playing` and `pause()`, so each is wrapped in a stable
 * handle with that shape (one per player, so claim and release agree on identity) and handed
 * to the store unchanged. The remembered volume (`preferredVolume` / `rememberVolume`) is the
 * store's too; players should open at it, as the web's do.
 *
 * Start players with `playExclusive`, which also puts the audio session in the message-media
 * mode first (./audioSession.ts).
 */
import { useEffect } from 'react';
import { claimPlayback, releasePlayback } from '@web/stores/mediaPlayback';
import { applyMessageAudioMode } from './audioSession';

/** What expo-audio and expo-video players have in common, as far as exclusivity goes. */
export interface PlayerLike {
  readonly playing: boolean;
  pause(): void;
  play(): void;
}

interface PlaybackHandle {
  readonly paused: boolean;
  pause(): void;
}

const handles = new WeakMap<PlayerLike, PlaybackHandle>();

function handleFor(player: PlayerLike): PlaybackHandle {
  let h = handles.get(player);
  if (!h) {
    h = {
      // A player released on unmount throws on access; a released player is not playing.
      get paused() {
        try {
          return !player.playing;
        } catch {
          return true;
        }
      },
      pause() {
        try {
          player.pause();
        } catch {
          /* already released */
        }
      },
    };
    handles.set(player, h);
  }
  return h;
}

/** Mark `player` as the one playing, pausing any other. Call it as playback starts. */
export function claimPlayer(player: PlayerLike): void {
  claimPlayback(handleFor(player) as unknown as HTMLMediaElement);
}

/** Forget `player` (unmounted or stopped) so it is not paused on someone else's behalf. */
export function releasePlayer(player: PlayerLike): void {
  releasePlayback(handleFor(player) as unknown as HTMLMediaElement);
}

/**
 * Start `player`, pausing whatever else was playing, in the message-media audio mode (heard
 * with the ringer on silent; see ./audioSession.ts - left alone during a call).
 */
export async function playExclusive(player: PlayerLike): Promise<void> {
  claimPlayer(player);
  await applyMessageAudioMode('playback').catch(() => undefined);
  player.play();
}

/**
 * Keep `player` in the exclusivity store for a component's lifetime. Pass the player's
 * `playing` state (useAudioPlayerStatus(...).playing, or expo-video's playingChange) so a
 * start from native controls - which never went through `playExclusive` - still pauses the
 * others. Released on unmount or when the player is replaced.
 */
export function useExclusivePlayback(player: PlayerLike | null | undefined, playing?: boolean): void {
  useEffect(() => {
    if (player && playing) claimPlayer(player);
  }, [player, playing]);
  useEffect(() => {
    if (!player) return undefined;
    return () => releasePlayer(player);
  }, [player]);
}
