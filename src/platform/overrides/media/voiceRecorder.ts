/**
 * Mobile replacement for web/src/lib/voiceRecorder.ts - voice-message recording.
 *
 * Same exports and handle (`startVoiceRecording()` -> `{elapsedMs, levels, stop, cancel}`,
 * the constants, the error reasons), so the composer drives it the way the web's does: poll
 * `elapsedMs()`/`levels()` for the live waveform, `stop()` for the clip, which goes into the
 * attachment queue like any other file.
 *
 * The capture is expo-audio's recorder (AVAudioRecorder / MediaRecorder): AAC in MPEG-4, mono
 * 48 kHz at 64 kbit/s - clear speech at under half a megabyte a minute, and a container every
 * client plays, iOS and every browser included (the web's own recordings are WebM/Ogg, which
 * iOS cannot play; see src/platform/media/playability.ts). The clip is named
 * `voice-message.m4a`, type `audio/mp4` - named from its sniffed bytes, as the web names its
 * clips - which is all that marks it as a voice message on the wire.
 *
 * The live level comes from the recorder's metering (dBFS: average power on iOS, peak
 * amplitude on Android), sampled every 50 ms like the web's analyser and mapped onto the
 * web's 0..1 curve so the bars look alike.
 *
 * The audio session: recording on iOS needs the play-and-record category, so the recorder
 * switches to the media layer's recording mode for the clip and back to its playback mode
 * afterwards - unless a call owns the session (src/platform/media/audioSession.ts).
 */
import { Platform } from 'react-native';
import {
  AudioModule,
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  type AudioRecorder,
  type RecordingOptions,
} from 'expo-audio';
import { File } from 'expo-file-system';
import { voiceMessageFilename } from '@web-original/lib/attachments/format';
import { sniffClipFormat } from '@web-original/lib/media/clipFormat';
import { applyMessageAudioMode } from '../../media/audioSession';
import { deleteFileQuietly, fileSize, mediaDirectory, randomName, readHeadBytes } from '../../media/files';
import type { LocalFile } from '../../media/types';

/** Longest clip we let someone record, matching the cap the composer enforces. */
export const VOICE_MESSAGE_MAX_MS = 5 * 60 * 1000;

/** Below this the clip is treated as a mis-click and thrown away rather than sent. */
export const VOICE_MESSAGE_MIN_MS = 500;

/** How often we sample the input level for the live waveform. */
const SAMPLE_MS = 50;

export type VoiceRecorderErrorReason = 'unsupported' | 'denied' | 'unavailable' | 'failed' | 'tooShort';

export class VoiceRecorderError extends Error {
  readonly reason: VoiceRecorderErrorReason;
  constructor(reason: VoiceRecorderErrorReason, message?: string) {
    super(message ?? reason);
    this.name = 'VoiceRecorderError';
    this.reason = reason;
  }
}

export interface VoiceRecording {
  /** Named `voice-message.<ext>` so the renderer recognises it as a voice message. */
  file: LocalFile;
  durationMs: number;
}

export interface VoiceRecorderHandle {
  /** Milliseconds captured so far. */
  elapsedMs(): number;
  /** Input level per ~50ms sample, oldest first, each 0..1. Drives the live waveform. */
  levels(): number[];
  /** Finish and return the clip. Resolves null if the clip was too short to keep. */
  stop(): Promise<VoiceRecording | null>;
  /** Throw the recording away. Safe to call after stop(). */
  cancel(): void;
}

const VOICE_RECORDING: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 48000,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: true,
  directory: 'cache',
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac', audioSource: 'mic' },
  ios: { outputFormat: IOSOutputFormat.MPEG4AAC, audioQuality: AudioQuality.HIGH },
  web: {},
};

/**
 * The native recorder takes the common options merged with this platform's (what expo-audio's
 * own useAudioRecorder does before constructing one).
 */
function nativeOptions(o: RecordingOptions): Partial<RecordingOptions> {
  const common = {
    extension: o.extension,
    sampleRate: o.sampleRate,
    numberOfChannels: o.numberOfChannels,
    bitRate: o.bitRate,
    isMeteringEnabled: o.isMeteringEnabled ?? false,
    directory: o.directory,
  };
  const platform = Platform.OS === 'ios' ? o.ios : o.android;
  return { ...common, ...platform } as unknown as Partial<RecordingOptions>;
}

/**
 * Map a metering reading (dBFS, -160..0) onto the web's 0..1 level curve
 * (`min(1, (rms * 3.2) ^ 0.7)`). Android reports peak amplitude, which runs about 9 dB above
 * the RMS the curve was tuned for; `peak` takes that off.
 */
export function meteringToLevel(db: number | null | undefined, peak = false): number {
  if (typeof db !== 'number' || !Number.isFinite(db) || db <= -160) return 0;
  const amplitude = Math.pow(10, (Math.min(0, db) - (peak ? 9 : 0)) / 20);
  return Math.min(1, Math.pow(amplitude * 3.2, 0.7));
}

/** Whether this device can record at all. */
export function isVoiceRecordingSupported(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function message(err: unknown): string | undefined {
  return err instanceof Error ? err.message : undefined;
}

function releaseRecorder(recorder: AudioRecorder): void {
  try {
    recorder.release();
  } catch {
    /* already released */
  }
}

/**
 * Request the microphone and start capturing. Rejects with a VoiceRecorderError: 'denied'
 * (permission refused), 'unavailable' (the microphone could not be opened - another app or a
 * call holds it), 'unsupported' or 'failed'.
 */
export async function startVoiceRecording(): Promise<VoiceRecorderHandle> {
  if (!isVoiceRecordingSupported()) throw new VoiceRecorderError('unsupported');

  let granted = false;
  try {
    granted = (await requestRecordingPermissionsAsync()).granted;
  } catch (err) {
    throw new VoiceRecorderError('failed', message(err));
  }
  if (!granted) throw new VoiceRecorderError('denied');

  let managedSession = false;
  try {
    managedSession = await applyMessageAudioMode('recording');
  } catch (err) {
    throw new VoiceRecorderError('unavailable', message(err));
  }
  const restoreSession = () => {
    if (managedSession) void applyMessageAudioMode('playback').catch(() => undefined);
  };

  let recorder: AudioRecorder;
  try {
    recorder = new AudioModule.AudioRecorder(nativeOptions(VOICE_RECORDING));
  } catch (err) {
    restoreSession();
    throw new VoiceRecorderError('failed', message(err));
  }
  try {
    await recorder.prepareToRecordAsync();
    // The composer stops at the cap; this is the backstop if its timer is not running (the
    // app in the background, say).
    recorder.record({ forDuration: VOICE_MESSAGE_MAX_MS / 1000 });
  } catch (err) {
    releaseRecorder(recorder);
    restoreSession();
    throw new VoiceRecorderError('unavailable', message(err));
  }

  const peakMetering = Platform.OS === 'android';
  const levels: number[] = [];
  const startedAt = performance.now();
  let frozenMs: number | null = null;
  const timer = setInterval(() => {
    let db: number | undefined;
    try {
      db = recorder.getStatus().metering;
    } catch {
      db = undefined;
    }
    levels.push(meteringToLevel(db, peakMetering));
  }, SAMPLE_MS);

  let stopped = false;
  const freeze = () => {
    frozenMs = performance.now() - startedAt;
    clearInterval(timer);
  };

  /** Stop the native recorder and hand back the file it wrote, releasing everything. */
  const finish = async (): Promise<{ uri: string | null; nativeMs: number; failed: unknown }> => {
    let nativeMs = 0;
    try {
      nativeMs = recorder.getStatus().durationMillis ?? 0;
    } catch {
      nativeMs = 0;
    }
    let failed: unknown = null;
    try {
      await recorder.stop();
    } catch (err) {
      // Stopping one that already stopped itself (the backstop above) is not a failure.
      failed = err;
    }
    let uri: string | null = null;
    try {
      uri = recorder.uri;
    } catch {
      uri = null;
    }
    releaseRecorder(recorder);
    restoreSession();
    return { uri, nativeMs, failed };
  };

  const handle: VoiceRecorderHandle = {
    elapsedMs: () => frozenMs ?? performance.now() - startedAt,

    levels: () => levels,

    stop: async () => {
      if (stopped) return null;
      stopped = true;
      freeze();
      const { uri, nativeMs, failed } = await finish();
      if (!uri) {
        if (failed) throw new VoiceRecorderError('failed', message(failed));
        return null;
      }
      const durationMs = Math.min(nativeMs > 0 ? nativeMs : frozenMs ?? 0, VOICE_MESSAGE_MAX_MS);
      const size = fileSize(uri) ?? 0;
      if (durationMs < VOICE_MESSAGE_MIN_MS || size <= 0) {
        deleteFileQuietly(uri);
        return null;
      }
      // Named after what the recorder actually wrote, as the web names its clips.
      const format = sniffClipFormat(readHeadBytes(uri, 16)) ?? { ext: 'm4a', type: 'audio/mp4' };
      // Into the media directory, which is swept at start-up: an unsent recording has no
      // use after a restart, and the recorder's own cache folder is never cleaned.
      let finalUri = uri;
      try {
        const dest = new File(mediaDirectory('recordings'), `${randomName()}.${format.ext}`);
        new File(uri).moveSync(dest);
        finalUri = dest.uri;
      } catch {
        finalUri = uri;
      }
      const file: LocalFile = { uri: finalUri, name: voiceMessageFilename(format.ext), type: format.type, size, owned: true };
      return { file, durationMs };
    },

    cancel: () => {
      if (stopped) return;
      stopped = true;
      freeze();
      void finish().then(({ uri }) => deleteFileQuietly(uri));
    },
  };

  return handle;
}
