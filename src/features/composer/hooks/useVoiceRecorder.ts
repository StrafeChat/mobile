/**
 * The composer's voice-message recorder: the media layer's recorder (the web's
 * lib/voiceRecorder API over expo-audio) driven the way the web composer drives it - polled
 * every 100 ms for the elapsed time and the live levels, auto-stopped at the 5 minute cap,
 * cancelled (microphone released) if the composer goes away mid-take.
 *
 * Mobile adds the hold-to-record states: a take started by pressing and holding is `held`
 * until it is released (stop and send), slid away (cancel) or locked (hands-free; the bar
 * then offers discard and send). A take started from a screen reader starts locked.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@web/i18n/t';
import { startVoiceRecording, VOICE_MESSAGE_MAX_MS, VoiceRecorderError, type VoiceRecorderHandle, type VoiceRecording } from '@/platform/media';
import { haptics } from '@/ui';

export type RecorderPhase = 'idle' | 'starting' | 'recording';

export interface VoiceRecorderState {
  phase: RecorderPhase;
  /** Hands-free (slid up, or started from a screen reader). */
  locked: boolean;
  elapsedMs: number;
  /** Input levels, oldest first, 0..1 each (the most recent `WAVEFORM_SLOTS`). */
  levels: number[];
}

/** Slots in the live waveform (the web's WAVEFORM_BARS). */
export const WAVEFORM_SLOTS = 72;
const POLL_MS = 100;

const IDLE: VoiceRecorderState = { phase: 'idle', locked: false, elapsedMs: 0, levels: [] };

/** The message to show for a failed start (the web's voiceErrorKey; mobile wording for the
 * permission case, which the web words for a browser's site settings). */
export function voiceErrorText(err: unknown): string {
  const reason = err instanceof VoiceRecorderError ? err.reason : 'failed';
  switch (reason) {
    case 'unsupported':
      return t('composer.voiceUnavailable');
    case 'denied':
      return t('mobile.media.micDenied');
    case 'unavailable':
      return t('attachments.voice.unavailable');
    default:
      return t('attachments.voice.failed');
  }
}

export interface VoiceRecorderControls {
  state: VoiceRecorderState;
  /** Start a take; `locked` for hands-free from the start. */
  begin(locked?: boolean): void;
  /** The finger let go / the send button: stop, and hand the clip over (null = too short). */
  finish(): void;
  /** Slide-up: keep recording without holding. */
  lock(): void;
  /** Throw the take away. */
  cancel(): void;
}

export function useVoiceRecorder(opts: {
  /** A finished clip (≥ 0.5 s), ready for the attachment queue. */
  onClip: (clip: VoiceRecording, reason: 'released' | 'max') => void;
  onError: (message: string) => void;
}): VoiceRecorderControls {
  const [state, setState] = useState<VoiceRecorderState>(IDLE);
  const handle = useRef<VoiceRecorderHandle | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** The press that started the take is still active (or the take is locked). */
  const wanted = useRef(false);
  const lockedRef = useRef(false);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  const reset = useCallback(() => {
    stopTimer();
    handle.current = null;
    wanted.current = false;
    lockedRef.current = false;
    setState(IDLE);
  }, []);

  const stopAndDeliver = useCallback(
    (reason: 'released' | 'max') => {
      const h = handle.current;
      reset();
      if (!h) return;
      void h.stop().then(
        (clip) => {
          if (!clip) {
            haptics.warning();
            optsRef.current.onError(t('attachments.voice.tooShort'));
            return;
          }
          haptics.success();
          optsRef.current.onClip(clip, reason);
        },
        () => optsRef.current.onError(t('attachments.voice.failed')),
      );
    },
    [reset],
  );

  const begin = useCallback(
    (locked = false) => {
      if (handle.current || wanted.current) return;
      wanted.current = true;
      lockedRef.current = locked;
      setState({ ...IDLE, phase: 'starting', locked });
      startVoiceRecording().then(
        (h) => {
          // Let go (or cancelled) while the microphone was opening - a permission prompt, say.
          if (!wanted.current) {
            h.cancel();
            setState(IDLE);
            return;
          }
          handle.current = h;
          haptics.impact('medium');
          setState({ phase: 'recording', locked: lockedRef.current, elapsedMs: 0, levels: [] });
          timer.current = setInterval(() => {
            const cur = handle.current;
            if (!cur) return;
            const elapsed = cur.elapsedMs();
            setState((s) => ({ ...s, elapsedMs: elapsed, levels: cur.levels().slice(-WAVEFORM_SLOTS) }));
            if (elapsed >= VOICE_MESSAGE_MAX_MS) stopAndDeliver('max');
          }, POLL_MS);
        },
        (err: unknown) => {
          reset();
          optsRef.current.onError(voiceErrorText(err));
        },
      );
    },
    [reset, stopAndDeliver],
  );

  const finish = useCallback(() => {
    if (!handle.current) {
      // Released before the microphone opened: nothing to keep.
      wanted.current = false;
      if (state.phase === 'starting') setState(IDLE);
      return;
    }
    stopAndDeliver('released');
  }, [state.phase, stopAndDeliver]);

  const lock = useCallback(() => {
    if (lockedRef.current) return;
    lockedRef.current = true;
    haptics.selection();
    setState((s) => (s.phase === 'idle' ? s : { ...s, locked: true }));
  }, []);

  const cancel = useCallback(() => {
    const h = handle.current;
    const active = !!h || wanted.current;
    reset();
    h?.cancel();
    if (active) haptics.warning();
  }, [reset]);

  // Never leave the microphone running if the composer goes away mid-recording.
  useEffect(
    () => () => {
      stopTimer();
      wanted.current = false;
      handle.current?.cancel();
      handle.current = null;
    },
    [],
  );

  return { state, begin, finish, lock, cancel };
}
