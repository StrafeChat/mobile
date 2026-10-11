/**
 * The call runtime follows the voice session: audio session and Android call service start
 * with a call, survive the brief idle of a move/rejoin, update for the camera and the
 * microphone, and stop after the call. The service notification's buttons run the store's
 * actions.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createSignal } from 'solid-js';

const mockLog: string[] = [];
const mockService: {
  running: { camera: boolean } | null;
  handlers: { action?: (a: 'mute' | 'hangup') => void; stopped?: () => void };
} = { running: null, handlers: {} };

jest.mock('@livekit/react-native', () => ({ registerGlobals: () => mockLog.push('registerGlobals') }));
jest.mock('@web/i18n/t', () => ({ t: (k: string) => k }));
jest.mock('./audioSession', () => ({
  startCallAudio: async () => void mockLog.push('audio:start'),
  stopCallAudio: async () => void mockLog.push('audio:stop'),
}));
jest.mock('./callService', () => ({
  callServiceRunningWith: (camera: boolean) => !!mockService.running && mockService.running.camera === camera,
  startCallService: async (c: { muteLabel: string | null }, s: { camera: boolean; muted: boolean }) => {
    const update = !!mockService.running && mockService.running.camera === s.camera;
    mockService.running = { camera: s.camera };
    mockLog.push(`service:${update ? 'update' : 'start'} camera=${s.camera} muted=${s.muted} button=${c.muteLabel}`);
  },
  stopCallService: async () => {
    mockService.running = null;
    mockLog.push('service:stop');
  },
  onCallServiceEvent: (h: typeof mockService.handlers) => {
    mockService.handlers = h;
    return () => undefined;
  },
}));

// eslint-disable-next-line import/first
import { AppState, PermissionsAndroid, Platform } from 'react-native';
// eslint-disable-next-line import/first
import { initMobileVoiceRuntime, type RuntimeSession } from './runtime';

// The Android path (the call service exists only there), in the foreground, mic granted.
Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
let appState = 'active';
Object.defineProperty(AppState, 'currentState', { get: () => appState, configurable: true });
jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);

const base: RuntimeSession = { status: 'idle', camera: false, selfMute: false, selfDeaf: false, serverMute: false, suppress: false };
const [session, setSession] = createSignal<RuntimeSession>(base);
const actions = { toggleMute: jest.fn(), hangUp: jest.fn() };
initMobileVoiceRuntime(() => session(), actions);

const tick = () => jest.advanceTimersByTimeAsync(0);

describe('initMobileVoiceRuntime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    appState = 'active';
    actions.toggleMute.mockClear();
    actions.hangUp.mockClear();
  });

  it('runs the audio session and call service for the life of a call', async () => {
    expect(mockLog).toEqual(['registerGlobals']);
    mockLog.length = 0;

    setSession({ ...base, status: 'connecting' });
    await tick();
    expect(mockLog).toEqual(['audio:start', 'service:start camera=false muted=false button=voice.mute']);

    setSession({ ...base, status: 'connected', camera: true });
    await tick();
    expect(mockLog.slice(2)).toEqual(['service:start camera=true muted=false button=voice.mute']);

    // A moderator move: idle for a moment, then connecting elsewhere - nothing is released.
    mockLog.length = 0;
    setSession({ ...base });
    await jest.advanceTimersByTimeAsync(500);
    setSession({ ...base, status: 'connecting' });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(mockLog).not.toContain('audio:stop');
    expect(mockLog).not.toContain('service:stop');

    // Hang up: released after the grace period.
    mockLog.length = 0;
    setSession({ ...base });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(mockLog).toEqual([]);
    await jest.advanceTimersByTimeAsync(1_500);
    expect(mockLog).toEqual(['service:stop', 'audio:stop']);
  });

  it('keeps the notification mute button current, even from the background', async () => {
    setSession({ ...base, status: 'connected' });
    await tick();
    mockLog.length = 0;

    // Muted from the notification while the app is in the background: an update in place,
    // not a new start (which Android forbids from there) and not a 2 s retry loop.
    appState = 'background';
    mockService.handlers.action?.('mute');
    expect(actions.toggleMute).toHaveBeenCalledTimes(1);
    setSession({ ...base, status: 'connected', selfMute: true });
    await tick();
    expect(mockLog).toEqual(['service:update camera=false muted=true button=voice.unmute']);

    // A moderator's mute: no button (it could not unmute), and a stale press does nothing.
    mockLog.length = 0;
    setSession({ ...base, status: 'connected', serverMute: true });
    await tick();
    expect(mockLog).toEqual(['service:update camera=false muted=true button=null']);
    mockService.handlers.action?.('mute');
    expect(actions.toggleMute).toHaveBeenCalledTimes(1);

    mockService.handlers.action?.('hangup');
    expect(actions.hangUp).toHaveBeenCalledTimes(1);

    setSession({ ...base });
    await jest.advanceTimersByTimeAsync(2_500);
  });

  it('restarts a service that ended on its own during a call, a bounded number of times', async () => {
    setSession({ ...base, status: 'connected' });
    await tick();
    mockLog.length = 0;

    for (let i = 0; i < 8; i++) {
      mockService.running = null;
      mockService.handlers.stopped?.();
      await jest.advanceTimersByTimeAsync(2_100);
    }
    expect(mockLog.filter((l) => l.startsWith('service:start'))).toHaveLength(5);

    setSession({ ...base });
    await jest.advanceTimersByTimeAsync(2_500);
  });
});
