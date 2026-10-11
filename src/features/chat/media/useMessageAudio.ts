/**
 * One expo-audio player for a message's audio or voice clip, with the web player's
 * behaviour: one clip at a time across the app (stores/mediaPlayback), the remembered volume,
 * replay from the start once a clip has ended, ±5 s steps, and the speed cycle.
 * The player is released when the row unmounts (useAudioPlayer owns it), which also stops it.
 */
import { useCallback, useEffect } from 'react';
import { useAudioPlayer, useAudioPlayerStatus, type AudioStatus } from 'expo-audio';
import { PLAYBACK_RATES } from '@web/components/media/format';
import { preferredVolume, rememberVolume } from '@web/stores/mediaPlayback';
import { playExclusive, useExclusivePlayback } from '@/platform/media';

export interface MessageAudio {
  status: AudioStatus;
  /** Play from the start after the end; pause while playing. */
  toggle: () => void;
  seekFraction: (fraction: number) => void;
  step: (seconds: number) => void;
  rate: number;
  cycleRate: () => void;
  muted: boolean;
  toggleMute: () => void;
  ended: boolean;
}

export function nextRate(current: number): number {
  const i = PLAYBACK_RATES.findIndex((r) => Math.abs(r - current) < 0.01);
  return PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length] ?? 1;
}

/** Whether a clip sitting at `time` of `duration` has played to its end. */
export function isAtEnd(time: number, duration: number, justFinished: boolean): boolean {
  return justFinished || (duration > 0 && time >= duration - 0.05);
}

export function useMessageAudio(uri: string | null): MessageAudio {
  const player = useAudioPlayer(uri ? { uri } : null, { updateInterval: 250 });
  const status = useAudioPlayerStatus(player);
  useExclusivePlayback(player, status.playing);

  useEffect(() => {
    const pref = preferredVolume();
    try {
      player.volume = pref.volume;
      player.muted = pref.muted;
    } catch {
      /* released */
    }
  }, [player]);

  const ended = !status.playing && isAtEnd(status.currentTime, status.duration, status.didJustFinish);

  const toggle = useCallback(() => {
    if (status.playing) {
      player.pause();
      return;
    }
    if (ended) {
      // A player released under the row (recycled, unmounted) rejects: nothing to do then.
      player
        .seekTo(0)
        .then(() => playExclusive(player))
        .catch(() => undefined);
      return;
    }
    playExclusive(player).catch(() => undefined);
  }, [player, status.playing, ended]);

  const seekFraction = useCallback(
    (f: number) => {
      if (status.duration > 0) player.seekTo(Math.max(0, Math.min(1, f)) * status.duration).catch(() => undefined);
    },
    [player, status.duration],
  );

  const step = useCallback(
    (s: number) => {
      const d = status.duration;
      if (d > 0) player.seekTo(Math.max(0, Math.min(d, status.currentTime + s))).catch(() => undefined);
    },
    [player, status.duration, status.currentTime],
  );

  const cycleRate = useCallback(() => {
    player.setPlaybackRate(nextRate(status.playbackRate || 1));
  }, [player, status.playbackRate]);

  const toggleMute = useCallback(() => {
    const next = !status.mute;
    player.muted = next;
    rememberVolume(player.volume, next);
  }, [player, status.mute]);

  return {
    status,
    toggle,
    seekFraction,
    step,
    rate: status.playbackRate || 1,
    cycleRate,
    muted: status.mute,
    toggleMute,
    ended,
  };
}
