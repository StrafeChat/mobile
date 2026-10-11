/**
 * The voice-message recorder hook: a held take is delivered on release, a slide cancels it
 * and releases the microphone, a lock keeps it going, a too-short take explains itself, and
 * a release while the microphone is still opening throws the take away.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';

const mockHandle = {
  elapsedMs: jest.fn(() => 1200),
  levels: jest.fn(() => [0.2, 0.5]),
  stop: jest.fn(async (): Promise<unknown> => ({ file: { uri: 'file:///voice-message.m4a', name: 'voice-message.m4a', type: 'audio/mp4', size: 9 }, durationMs: 1200 })),
  cancel: jest.fn(),
};
let mockStart: () => Promise<unknown> = async () => mockHandle;

// The shell (reached through @/ui) is not under test here; keep its navigation imports out.
jest.mock('@/shell/SwipeShell', () => ({
  HorizontalGestureOwner: ({ children }: { children: unknown }) => children,
  useShellGesture: () => ({ pan: null, progress: null }),
}));

jest.mock('@/platform/media', () => ({
  startVoiceRecording: () => mockStart(),
  VOICE_MESSAGE_MAX_MS: 300000,
  VoiceRecorderError: class extends Error {},
}));

beforeEach(() => {
  jest.useFakeTimers();
  mockStart = async () => mockHandle;
  Object.values(mockHandle).forEach((f) => f.mockClear());
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function setup() {
  const onClip = jest.fn();
  const onError = jest.fn();
  const hook = renderHook(() => useVoiceRecorder({ onClip, onError }));
  return { onClip, onError, hook };
}

describe('useVoiceRecorder', () => {
  test('hold, poll the levels, release: the clip is delivered', async () => {
    const { onClip, hook } = setup();
    const { result } = await hook;
    await act(async () => result.current.begin());
    expect(result.current.state.phase).toBe('recording');
    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    expect(result.current.state.elapsedMs).toBe(1200);
    expect(result.current.state.levels).toEqual([0.2, 0.5]);
    await act(async () => result.current.finish());
    expect(onClip).toHaveBeenCalledWith(expect.objectContaining({ durationMs: 1200 }), 'released');
    expect(result.current.state.phase).toBe('idle');
  });

  test('cancel releases the microphone and delivers nothing', async () => {
    const { onClip, hook } = setup();
    const { result } = await hook;
    await act(async () => result.current.begin());
    await act(async () => result.current.cancel());
    expect(mockHandle.cancel).toHaveBeenCalled();
    expect(onClip).not.toHaveBeenCalled();
  });

  test('lock keeps the take; a too-short one says so', async () => {
    mockHandle.stop.mockImplementationOnce(async () => null);
    const { onClip, onError, hook } = setup();
    const { result } = await hook;
    await act(async () => result.current.begin());
    await act(async () => result.current.lock());
    expect(result.current.state.locked).toBe(true);
    await act(async () => result.current.finish());
    expect(onClip).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("That was too short to send - hold on a little longer next time.");
  });

  test('let go while the microphone is still opening: the take is thrown away', async () => {
    let resolve!: (h: unknown) => void;
    mockStart = () => new Promise((r) => (resolve = r));
    const { onClip, hook } = setup();
    const { result } = await hook;
    await act(async () => result.current.begin());
    expect(result.current.state.phase).toBe('starting');
    await act(async () => result.current.finish());
    await act(async () => resolve(mockHandle));
    expect(mockHandle.cancel).toHaveBeenCalled();
    expect(onClip).not.toHaveBeenCalled();
    expect(result.current.state.phase).toBe('idle');
  });

  test('unmounting mid-take releases the microphone', async () => {
    const { hook } = setup();
    const { result, unmount } = await hook;
    await act(async () => result.current.begin());
    await act(async () => unmount());
    expect(mockHandle.cancel).toHaveBeenCalled();
  });
});
