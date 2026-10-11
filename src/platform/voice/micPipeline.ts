/**
 * The microphone for calls on a phone - same exports and contract as
 * web/src/lib/voice/micPipeline.ts, without Web Audio.
 *
 * The web builds getUserMedia -> gain -> RNNoise -> level meter -> gate in an AudioContext
 * and publishes the gate's output. React Native has no Web Audio graph to put between the
 * microphone and the encoder, so here:
 *
 * - **Processing** is WebRTC's own, on the device: echo cancellation, noise suppression and
 *   gain control are capture constraints, which react-native-webrtc hands to libwebrtc's
 *   audio processing on both platforms (and iOS's voice-processing I/O unit; see
 *   ./audioSession.ts). Both suppressor modes ('rnnoise' and 'browser') mean "WebRTC's
 *   suppressor on" - RNNoise itself needs WebAssembly, which Hermes lacks - and 'off' means
 *   off. Nothing about the microphone leaves the device for it, as on the web.
 * - **The gate** (push-to-talk, the sensitivity threshold, mute) is the track's `enabled`
 *   flag: a disabled audio track keeps the sender running and sends digital silence, the
 *   same thing the web's closed gain stage produces, and nothing is renegotiated. LiveKit
 *   also writes `enabled` when it mutes and unmutes a publication, so the flag is wrapped:
 *   LiveKit's writes and reads see its own value, and the native track is on only when
 *   LiveKit wants it on AND the gate is open. (Without that, an unmute while push-to-talk
 *   is released would transmit until the next gate refresh.)
 * - **The level** comes from the sender's `media-source` statistics (`audioLevel`, the
 *   captured signal before the encoder - measured even while the gate holds the track
 *   disabled, so the threshold can open it). It exists once LiveKit has published the
 *   track; before that, and on a platform that does not report it, `level()` says -100
 *   dBFS and the pipeline reports `levelAvailable() === false`. libwebrtc's level is a
 *   peak-based one, so it reads a few dB above the web's RMS meter at the same voice.
 * - **Input gain** has no equivalent (no gain stage before the encoder): `setInputGain` is
 *   accepted and ignored, and automatic gain control is what levels the voice.
 *
 * `createVoiceAudioContext` returns a stand-in with the state machine stores/voice.ts
 * drives (resume / suspend / close) and nothing else; the call's audio session is started
 * and stopped by ./runtime.ts from the voice session's status.
 */
import type { MicPipeline, MicPipelineOptions } from '@web-original/lib/voice/micPipeline';
import { voiceSettings } from '@web/stores/voiceSettings';
import { applyVoiceProcessing } from './audioSession';
import { senderForTrack } from './senders';

export type { MicPipeline, MicPipelineOptions };
// The voice-activity gate is pure logic; the web's is used as it is.
export { createVadGate } from '@web-original/lib/voice/micPipeline';

/** 48 kHz, like the web's call context; nothing here depends on it. */
const SAMPLE_RATE = 48_000;
/** Level polling: fast enough for a manual threshold, slower when only a meter reads it. */
const LEVEL_INTERVAL_FAST_MS = 100;
const LEVEL_INTERVAL_SLOW_MS = 250;
/** How long to wait for a sender's first audioLevel before deciding there is none. */
const LEVEL_SOURCE_GRACE_MS = 2_000;

type ContextState = 'suspended' | 'running' | 'closed';

/**
 * The few members of AudioContext stores/voice.ts touches. Like a real context, `resume()`
 * flips the state only once its promise settles - stores/voice.ts relies on that ordering
 * (a join resumes, then may tear the previous call down, which suspends only a context that
 * is already running).
 */
class CallAudioContext {
  private _state: ContextState = 'suspended';
  readonly sampleRate = SAMPLE_RATE;
  private readonly startedAt = Date.now();

  get state(): ContextState {
    return this._state;
  }

  get currentTime(): number {
    return (Date.now() - this.startedAt) / 1000;
  }

  resume(): Promise<void> {
    if (this._state === 'closed') return Promise.reject(new Error('context closed'));
    return Promise.resolve().then(() => {
      if (this._state !== 'closed') this._state = 'running';
    });
  }

  suspend(): Promise<void> {
    if (this._state !== 'closed') this._state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this._state = 'closed';
    return Promise.resolve();
  }
}

export function createVoiceAudioContext(): AudioContext {
  return new CallAudioContext() as unknown as AudioContext;
}

/** Map a DOM-style permission refusal onto the name the shared store checks for. */
function normaliseError(err: unknown): unknown {
  // react-native-webrtc rejects a refused permission as SecurityError; the web (and so
  // stores/voice.ts) expects NotAllowedError for "the user said no".
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'SecurityError') {
    const e = new Error((err as { message?: string }).message ?? 'Permission denied');
    e.name = 'NotAllowedError';
    return e;
  }
  return err;
}

interface RnTrack {
  enabled: boolean;
  readyState: string;
  stop(): void;
  release?: () => void;
}

interface RnStream {
  getAudioTracks(): RnTrack[];
  getTracks(): RnTrack[];
  release?: (releaseTracks?: boolean) => void;
}

/**
 * Wrap `track.enabled` so the gate and LiveKit's mute share it (see the file comment).
 * Returns the gate's setter.
 */
export function installEnabledGate(track: object): (open: boolean) => void {
  let proto: object | null = Object.getPrototypeOf(track);
  let desc: PropertyDescriptor | undefined;
  while (proto && !(desc = Object.getOwnPropertyDescriptor(proto, 'enabled'))) proto = Object.getPrototypeOf(proto);
  const setNative = desc?.set;
  if (!setNative) throw new Error('track has no enabled accessor');
  let wanted = true;
  let gate = false;
  const apply = () => setNative.call(track, wanted && gate);
  Object.defineProperty(track, 'enabled', {
    configurable: true,
    enumerable: true,
    get: () => wanted,
    set: (v: boolean) => {
      wanted = Boolean(v);
      apply();
    },
  });
  apply();
  return (open: boolean) => {
    gate = open;
    apply();
  };
}

/** dBFS from WebRTC's linear 0..1 audio level. */
export function levelToDb(level: number): number {
  if (!(level > 0)) return -100;
  return Math.max(-100, Math.min(0, 20 * Math.log10(level)));
}

/** The captured level from a sender's stats report, if it has one. */
export function mediaSourceLevel(report: Map<string, unknown>): number | undefined {
  for (const v of report.values()) {
    const r = v as { type?: string; kind?: string; audioLevel?: unknown };
    if (r.type === 'media-source' && (r.kind === 'audio' || r.kind === undefined) && typeof r.audioLevel === 'number') {
      return r.audioLevel;
    }
  }
  return undefined;
}

export interface MobileMicPipeline extends MicPipeline {
  /** Whether a real level is being measured (false before publishing, or if never reported). */
  levelAvailable(): boolean;
}

export async function createMicPipeline(opts: MicPipelineOptions): Promise<MobileMicPipeline> {
  const suppress = opts.noiseSuppression !== 'off';
  // Device choice is the audio route on a phone (./audioSession.ts), not a capture id.
  const { deviceId: _route, ...rest } = opts.constraints;
  const constraints: MediaTrackConstraints = { ...rest, noiseSuppression: suppress };
  if (opts.context && opts.context.state === 'suspended') void opts.context.resume().catch(() => undefined);
  void applyVoiceProcessing({
    echoCancellation: constraints.echoCancellation !== false,
    noiseSuppression: suppress,
    autoGainControl: constraints.autoGainControl !== false,
  });

  const media = (navigator as unknown as { mediaDevices?: { getUserMedia?: (c: unknown) => Promise<RnStream> } }).mediaDevices;
  if (!media?.getUserMedia) throw new Error('getUserMedia unavailable (registerGlobals not called)');
  let stream: RnStream;
  try {
    stream = await media.getUserMedia({ audio: constraints, video: false });
  } catch (err) {
    throw normaliseError(err);
  }
  const track = stream.getAudioTracks()[0];
  if (!track) {
    stream.getTracks().forEach((t) => t.stop());
    stream.release?.();
    throw new Error('no audio track');
  }

  const setGate = installEnabledGate(track);
  let open = false;
  let currentDb = -100;
  let measured = false;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const startedAt = Date.now();

  const poll = async () => {
    if (closed) return;
    const sender = senderForTrack(track);
    if (sender) {
      try {
        const level = mediaSourceLevel((await sender.getStats()) as Map<string, unknown>);
        if (level !== undefined) {
          measured = true;
          currentDb = levelToDb(level);
          if (!closed) opts.onLevel?.(currentDb);
        }
      } catch {
        /* the sender went away between ticks */
      }
    }
    if (closed) return;
    const fast = voiceSettings.inputMode === 'vad' && !voiceSettings.autoSensitivity;
    timer = setTimeout(() => void poll(), fast ? LEVEL_INTERVAL_FAST_MS : LEVEL_INTERVAL_SLOW_MS);
  };
  timer = setTimeout(() => void poll(), LEVEL_INTERVAL_FAST_MS);

  const levelAvailable = () => measured || Date.now() - startedAt < LEVEL_SOURCE_GRACE_MS;

  return {
    track: track as unknown as MediaStreamTrack,
    source: track as unknown as MediaStreamTrack,
    noiseSuppression: suppress ? 'browser' : 'off',
    setInputGain() {
      /* no gain stage on mobile; see the file comment */
    },
    setOpen(next) {
      open = next;
      setGate(next);
    },
    isOpen: () => open,
    // With no level source at all a manual threshold could never open, which would leave
    // someone unable to speak; once the grace period has passed with nothing measured, the
    // level reads as full scale so the threshold passes (mute and push-to-talk still gate).
    level: () => (measured ? currentDb : levelAvailable() ? -100 : 0),
    levelAvailable: () => measured,
    close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      setGate(false);
      try {
        track.stop();
      } catch {
        /* already stopped by LiveKit's unpublish */
      }
      stream.release?.(true);
    },
  };
}
