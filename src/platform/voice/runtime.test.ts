/**
 * The call runtime follows the voice session: audio session and Android call service start
 * with a call, survive the brief idle of a move/rejoin, update for the camera, and stop
 * after the call.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createSignal } from 'solid-js';

const mockLog: string[] = [];

jest.mock('@livekit/react-native', () => ({ registerGlobals: () => mockLog.push('registerGlobals') }));
jest.mock('@web/i18n/t', () => ({ t: (k: string) => k }));
jest.mock('./audioSession', () => ({
  startCallAudio: async () => void mockLog.push('audio:start'),
  stopCallAudio: async () => void mockLog.push('audio:stop'),
}));
jest.mock('./callService', () => ({
  startCallService: async (_c: unknown, camera: boolean) => void mockLog.push(`service:start camera=${camera}`),
  stopCallService: async () => void mockLog.push('service:stop'),
}));

// eslint-disable-next-line import/first
import { AppState, PermissionsAndroid, Platform } from 'react-native';
// eslint-disable-next-line import/first
import { initMobileVoiceRuntime, type RuntimeSession } from './runtime';

// The Android path (the call service exists only there), in the foreground, mic granted.
Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
jest.spyOn(PermissionsAndroid, 'check').mockResolvedValue(true);

const [session, setSession] = createSignal<RuntimeSession>({ status: 'idle', camera: false });
initMobileVoiceRuntime(() => session());

const tick = () => jest.advanceTimersByTimeAsync(0);

describe('initMobileVoiceRuntime', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  it('runs the audio session and call service for the life of a call', async () => {
    expect(mockLog).toEqual(['registerGlobals']);
    mockLog.length = 0;

    setSession({ status: 'connecting', camera: false });
    await tick();
    expect(mockLog).toEqual(['audio:start', 'service:start camera=false']);

    setSession({ status: 'connected', camera: true });
    await tick();
    expect(mockLog.slice(2)).toEqual(['service:start camera=true']);

    // A moderator move: idle for a moment, then connecting elsewhere - nothing is released.
    mockLog.length = 0;
    setSession({ status: 'idle', camera: false });
    await jest.advanceTimersByTimeAsync(500);
    setSession({ status: 'connecting', camera: false });
    await jest.advanceTimersByTimeAsync(5_000);
    expect(mockLog).not.toContain('audio:stop');
    expect(mockLog).not.toContain('service:stop');

    // Hang up: released after the grace period.
    mockLog.length = 0;
    setSession({ status: 'idle', camera: false });
    await jest.advanceTimersByTimeAsync(1_000);
    expect(mockLog).toEqual([]);
    await jest.advanceTimersByTimeAsync(1_500);
    expect(mockLog).toEqual(['service:stop', 'audio:stop']);
  });
});
