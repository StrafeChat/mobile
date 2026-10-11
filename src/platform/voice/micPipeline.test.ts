/**
 * The mobile microphone pipeline: the enabled-flag gate shared with LiveKit's mute, the
 * level read from sender statistics, and the AudioContext stand-in's state ordering.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

// The web pipeline (reused for createVadGate) imports RNNoise's WASM assets.
jest.mock('../../../web/src/lib/voice/rnnoise', () => ({ RNNOISE_SAMPLE_RATE: 48000 }));
jest.mock('./audioSession', () => ({ applyVoiceProcessing: async () => undefined }));

// eslint-disable-next-line import/first
import {
  createMicPipeline,
  createVadGate,
  createVoiceAudioContext,
  installEnabledGate,
  levelToDb,
  mediaSourceLevel,
} from './micPipeline';
// eslint-disable-next-line import/first
import { noteTrackSender } from './senders';

/** Stand-in for react-native-webrtc's MediaStreamTrack: `enabled` is a prototype accessor. */
class FakeTrack {
  nativeEnabled = true;
  readyState = 'live';
  writes: boolean[] = [];
  get enabled(): boolean {
    return this.nativeEnabled;
  }
  set enabled(v: boolean) {
    this.nativeEnabled = v;
    this.writes.push(v);
  }
  stop() {
    this.enabled = false;
    this.readyState = 'ended';
  }
}

describe('installEnabledGate', () => {
  it('transmits only when LiveKit wants the track on AND the gate is open', () => {
    const t = new FakeTrack();
    const setGate = installEnabledGate(t);
    expect(t.nativeEnabled).toBe(false); // starts closed, like the web's gain of 0
    setGate(true);
    expect(t.nativeEnabled).toBe(true);
    t.enabled = false; // LiveKit mutes the publication
    expect(t.nativeEnabled).toBe(false);
    expect(t.enabled).toBe(false);
    setGate(false);
    t.enabled = true; // LiveKit unmutes while push-to-talk is released
    expect(t.enabled).toBe(true); // LiveKit sees its own value...
    expect(t.nativeEnabled).toBe(false); // ...but nothing is transmitted
    setGate(true);
    expect(t.nativeEnabled).toBe(true);
  });
});

describe('levels', () => {
  it('converts WebRTC audioLevel to dBFS', () => {
    expect(levelToDb(1)).toBe(0);
    expect(levelToDb(0)).toBe(-100);
    expect(levelToDb(0.1)).toBeCloseTo(-20, 5);
    expect(levelToDb(1e-9)).toBe(-100);
  });

  it('reads the media-source level from a stats report', () => {
    const report = new Map<string, unknown>([
      ['OT1', { type: 'outbound-rtp', kind: 'audio' }],
      ['SA1', { type: 'media-source', kind: 'audio', audioLevel: 0.25 }],
    ]);
    expect(mediaSourceLevel(report)).toBe(0.25);
    expect(mediaSourceLevel(new Map([['x', { type: 'media-source', kind: 'video' }]]))).toBeUndefined();
  });

  it('reuses the web voice-activity gate', () => {
    const vad = createVadGate();
    expect(vad.update(-60, -50, true, 0)).toBe(true);
    expect(vad.update(-40, -50, false, 1000)).toBe(true);
    expect(vad.update(-60, -50, false, 1300)).toBe(true); // hangover
    expect(vad.update(-60, -50, false, 1500)).toBe(false);
  });
});

describe('createVoiceAudioContext', () => {
  it('becomes running only after resume settles, as a browser context does', async () => {
    const ctx = createVoiceAudioContext();
    expect(ctx.state).toBe('suspended');
    const p = ctx.resume();
    expect(ctx.state).toBe('suspended');
    await p;
    expect(ctx.state).toBe('running');
    await ctx.suspend();
    expect(ctx.state).toBe('suspended');
    await ctx.close();
    await expect(ctx.resume()).rejects.toThrow();
  });
});

describe('createMicPipeline', () => {
  const nav = globalThis.navigator as unknown as { mediaDevices?: unknown };
  let track: FakeTrack;
  let lastConstraints: unknown;

  beforeEach(() => {
    jest.useFakeTimers();
    track = new FakeTrack();
    nav.mediaDevices = {
      getUserMedia: async (c: unknown) => {
        lastConstraints = c;
        return { getAudioTracks: () => [track], getTracks: () => [track], release: () => undefined };
      },
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    delete nav.mediaDevices;
  });

  it('maps both suppressors to WebRTC noise suppression and drops the device id', async () => {
    await createMicPipeline({
      constraints: { deviceId: { ideal: 'x' }, echoCancellation: true, noiseSuppression: false, autoGainControl: true },
      inputGain: 1,
      noiseSuppression: 'rnnoise',
    });
    expect(lastConstraints).toEqual({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
    const off = await createMicPipeline({ constraints: {}, inputGain: 1, noiseSuppression: 'off' });
    expect((lastConstraints as { audio: { noiseSuppression: boolean } }).audio.noiseSuppression).toBe(false);
    expect(off.noiseSuppression).toBe('off');
  });

  it('reports a permission refusal as NotAllowedError', async () => {
    nav.mediaDevices = {
      getUserMedia: async () => {
        throw { name: 'SecurityError', message: 'Permission denied.' };
      },
    };
    await expect(createMicPipeline({ constraints: {}, inputGain: 1, noiseSuppression: 'off' })).rejects.toMatchObject({
      name: 'NotAllowedError',
    });
  });

  it('gates the track and reads levels from its sender once published', async () => {
    const levels: number[] = [];
    const pipeline = await createMicPipeline({ constraints: {}, inputGain: 1, noiseSuppression: 'rnnoise', onLevel: (db) => levels.push(db) });
    expect(track.nativeEnabled).toBe(false);
    pipeline.setOpen(true);
    expect(track.nativeEnabled).toBe(true);
    expect(pipeline.isOpen()).toBe(true);

    noteTrackSender(track, {
      getStats: async () => new Map([['SA', { type: 'media-source', kind: 'audio', audioLevel: 0.1 }]]),
    } as never);
    await jest.advanceTimersByTimeAsync(300);
    expect(pipeline.levelAvailable()).toBe(true);
    expect(pipeline.level()).toBeCloseTo(-20, 5);
    expect(levels.length).toBeGreaterThan(0);

    pipeline.close();
    expect(track.nativeEnabled).toBe(false);
    expect(track.readyState).toBe('ended');
  });

  it('lets a manual threshold pass when no level source ever appears', async () => {
    const pipeline = await createMicPipeline({ constraints: {}, inputGain: 1, noiseSuppression: 'off' });
    expect(pipeline.level()).toBe(-100);
    await jest.advanceTimersByTimeAsync(2_500);
    expect(pipeline.levelAvailable()).toBe(false);
    expect(pipeline.level()).toBe(0);
    pipeline.close();
  });
});
