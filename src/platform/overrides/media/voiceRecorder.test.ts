/**
 * Voice recording over a stand-in expo-audio recorder: the web's handle contract (levels,
 * elapsed time, stop/cancel, too-short clips), the produced file, permissions and the audio
 * session.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-file-system', () => require('../../media/testing/memoryFileSystem'));

jest.mock('expo-audio', () => {
  const { memoryFs } = require('../../media/testing/memoryFileSystem');
  const control = {
    granted: true,
    metering: -20 as number | undefined,
    durationMillis: 0,
    prepareFails: false,
    instances: [] as unknown[],
    modes: [] as unknown[],
  };
  class FakeRecorder {
    options: unknown;
    uri: string | null = null;
    isRecording = false;
    released = false;
    stopped = false;
    recordOptions: unknown;
    constructor(options: unknown) {
      this.options = options;
      control.instances.push(this);
    }
    async prepareToRecordAsync() {
      if (control.prepareFails) throw new Error('mic busy');
    }
    record(opts: unknown) {
      this.recordOptions = opts;
      this.isRecording = true;
      // An MPEG-4 file, as AVAudioRecorder / MediaRecorder write it.
      const bytes = new Uint8Array(2000);
      bytes.set([0, 0, 0, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
      this.uri = memoryFs.put(`${memoryFs.cacheUri}/ExpoAudio/recording-${control.instances.length}.m4a`, bytes);
    }
    getStatus() {
      return { canRecord: true, isRecording: this.isRecording, durationMillis: control.durationMillis, mediaServicesDidReset: false, metering: control.metering, url: this.uri };
    }
    async stop() {
      this.isRecording = false;
      this.stopped = true;
    }
    release() {
      this.released = true;
    }
  }
  return {
    __control: control,
    AudioModule: { AudioRecorder: FakeRecorder },
    AudioQuality: { HIGH: 96 },
    IOSOutputFormat: { MPEG4AAC: 'aac ' },
    requestRecordingPermissionsAsync: async () => ({ granted: control.granted }),
    setAudioModeAsync: async (mode: unknown) => {
      control.modes.push(mode);
    },
  };
});

import { memoryFs } from '../../media/testing/memoryFileSystem';
import { setAudioSessionGuard } from '../../media/audioSession';
import { VOICE_MESSAGE_MAX_MS, VoiceRecorderError, meteringToLevel, startVoiceRecording } from './voiceRecorder';

const PLAYBACK_MODE = { playsInSilentMode: true, interruptionMode: 'doNotMix', allowsRecording: false, shouldPlayInBackground: false, shouldRouteThroughEarpiece: false };
const RECORDING_MODE = { ...PLAYBACK_MODE, allowsRecording: true };

interface FakeRecorder {
  options: Record<string, unknown>;
  uri: string | null;
  released: boolean;
  stopped: boolean;
  recordOptions: unknown;
}
const control = (require('expo-audio') as { __control: { granted: boolean; metering: number | undefined; durationMillis: number; prepareFails: boolean; instances: FakeRecorder[]; modes: unknown[] } }).__control;

beforeEach(() => {
  memoryFs.reset();
  jest.useFakeTimers();
  Object.assign(control, { granted: true, metering: -20, durationMillis: 0, prepareFails: false, instances: [], modes: [] });
  setAudioSessionGuard(null);
});

afterEach(() => {
  jest.useRealTimers();
});

describe('startVoiceRecording', () => {
  it('records mono AAC in MPEG-4 with metering, and produces voice-message.m4a', async () => {
    const handle = await startVoiceRecording();
    const rec = control.instances[0]!;
    expect(rec.options).toMatchObject({ extension: '.m4a', numberOfChannels: 1, isMeteringEnabled: true, sampleRate: 48000, bitRate: 64000 });
    expect(rec.recordOptions).toEqual({ forDuration: VOICE_MESSAGE_MAX_MS / 1000 });
    expect(control.modes).toEqual([RECORDING_MODE]);

    jest.advanceTimersByTime(200);
    expect(handle.levels()).toHaveLength(4);
    expect(handle.levels().every((l) => l > 0 && l <= 1)).toBe(true);
    expect(handle.elapsedMs()).toBeGreaterThanOrEqual(200);

    control.durationMillis = 3200;
    const clip = await handle.stop();
    expect(clip).not.toBeNull();
    expect(clip!.durationMs).toBe(3200);
    expect(clip!.file).toMatchObject({ name: 'voice-message.m4a', type: 'audio/mp4', size: 2000, owned: true });
    // Moved out of the recorder's folder into the swept recordings directory.
    expect(clip!.file.uri.startsWith(`${memoryFs.cacheUri}/strafe-media/recordings/`)).toBe(true);
    expect(memoryFs.exists(clip!.file.uri)).toBe(true);
    expect(memoryFs.filesUnder(`${memoryFs.cacheUri}/ExpoAudio`)).toEqual([]);
    expect(rec.released).toBe(true);
    expect(control.modes).toEqual([RECORDING_MODE, PLAYBACK_MODE]);

    // Frozen after stop, and stop is once.
    const frozen = handle.elapsedMs();
    jest.advanceTimersByTime(500);
    expect(handle.elapsedMs()).toBe(frozen);
    expect(handle.levels()).toHaveLength(4);
    await expect(handle.stop()).resolves.toBeNull();
  });

  it('throws a too-short clip away', async () => {
    const handle = await startVoiceRecording();
    control.durationMillis = 300;
    const uri = control.instances[0]!.uri!;
    await expect(handle.stop()).resolves.toBeNull();
    expect(memoryFs.exists(uri)).toBe(false);
  });

  it('cancel deletes the recording and releases everything', async () => {
    const handle = await startVoiceRecording();
    const rec = control.instances[0]!;
    handle.cancel();
    await jest.runAllTimersAsync();
    expect(rec.stopped).toBe(true);
    expect(rec.released).toBe(true);
    expect(memoryFs.exists(rec.uri!)).toBe(false);
    await expect(handle.stop()).resolves.toBeNull();
  });

  it('reports a refused permission as denied, a busy microphone as unavailable', async () => {
    control.granted = false;
    await expect(startVoiceRecording()).rejects.toMatchObject({ name: 'VoiceRecorderError', reason: 'denied' });
    expect(control.instances).toHaveLength(0);

    control.granted = true;
    control.prepareFails = true;
    const err = await startVoiceRecording().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VoiceRecorderError);
    expect((err as VoiceRecorderError).reason).toBe('unavailable');
    expect(control.instances[0]!.released).toBe(true);
    // The session it switched for recording is switched back.
    expect(control.modes.at(-1)).toEqual(PLAYBACK_MODE);
  });

  it('leaves the audio session alone while a call owns it', async () => {
    setAudioSessionGuard(() => true);
    const handle = await startVoiceRecording();
    control.durationMillis = 1000;
    await handle.stop();
    expect(control.modes).toEqual([]);
  });

  it('records silence as zero', async () => {
    control.metering = undefined;
    const handle = await startVoiceRecording();
    jest.advanceTimersByTime(100);
    expect(handle.levels()).toEqual([0, 0]);
    handle.cancel();
  });
});

describe('meteringToLevel', () => {
  it('maps dBFS onto the web curve, bounded to 0..1 and rising with loudness', () => {
    expect(meteringToLevel(-160)).toBe(0);
    expect(meteringToLevel(undefined)).toBe(0);
    expect(meteringToLevel(Number.NaN)).toBe(0);
    expect(meteringToLevel(0)).toBe(1);
    expect(meteringToLevel(6)).toBe(1);
    // -20 dBFS is an RMS of 0.1, which the web's curve maps to (0.32)^0.7.
    expect(meteringToLevel(-20)).toBeCloseTo(Math.pow(0.32, 0.7), 5);
    const levels = [-60, -45, -30, -20, -12].map((db) => meteringToLevel(db));
    expect([...levels].sort((a, b) => a - b)).toEqual(levels);
    // Android's peak reading sits lower on the curve than the same number as RMS.
    expect(meteringToLevel(-20, true)).toBeLessThan(meteringToLevel(-20));
  });
});
