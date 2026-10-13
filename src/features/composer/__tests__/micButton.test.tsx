/**
 * The microphone and screen readers: a double-tap starts a locked take on both platforms.
 * VoiceOver's double-tap arrives as onAccessibilityTap (without it, iOS sends a synthesized
 * tap, which the tap gesture answers with "hold to record"), TalkBack's as the 'activate'
 * action - which is not offered on iOS, where it would be a custom action read out as
 * "activate". A disabled, unsupported or already recording microphone starts nothing.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';
import { toastStore } from '@/ui';
import { MicButton } from '../components/MicButton';
import type { VoiceRecorderControls, VoiceRecorderState } from '../hooks/useVoiceRecorder';

// The shell (reached through @/ui) is not under test here; keep its navigation imports out.
jest.mock('@/shell/SwipeShell', () => ({
  HorizontalGestureOwner: ({ children }: { children: unknown }) => children,
  useShellGesture: () => ({ pan: null, progress: null }),
}));

const originalOS = Platform.OS;
function onPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

const IDLE: VoiceRecorderState = { phase: 'idle', locked: false, elapsedMs: 0, levels: [] };

function recorder(state: VoiceRecorderState = IDLE): VoiceRecorderControls & { begin: jest.Mock } {
  return { state, begin: jest.fn(), finish: jest.fn(), lock: jest.fn(), cancel: jest.fn() } as VoiceRecorderControls & { begin: jest.Mock };
}

function mic(rec: VoiceRecorderControls, props: { disabled?: boolean; supported?: boolean } = {}) {
  return <MicButton recorder={rec} dragX={makeMutable(0)} dragY={makeMutable(0)} supported={props.supported ?? true} disabled={props.disabled} />;
}

const actionNames = () => ((screen.getByTestId('composer-mic').props.accessibilityActions ?? []) as { name: string }[]).map((a) => a.name);

beforeEach(() => {
  toastStore.set(null);
});

afterEach(() => {
  onPlatform(originalOS as 'ios');
});

describe('MicButton and screen readers', () => {
  test("iOS: VoiceOver's double-tap starts a locked take, with no toast and no raw 'activate' action", async () => {
    onPlatform('ios');
    const rec = recorder();
    await render(mic(rec));
    expect(actionNames()).toEqual([]);
    await act(async () => fireEvent(screen.getByTestId('composer-mic'), 'accessibilityTap'));
    expect(rec.begin).toHaveBeenCalledTimes(1);
    expect(rec.begin).toHaveBeenCalledWith(true);
    expect(toastStore.get()).toBeNull();
  });

  test("Android: TalkBack's double-tap (the 'activate' action) starts a locked take", async () => {
    onPlatform('android');
    const rec = recorder();
    await render(mic(rec));
    expect(actionNames()).toEqual(['activate']);
    await act(async () => fireEvent(screen.getByTestId('composer-mic'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } }));
    expect(rec.begin).toHaveBeenCalledWith(true);
  });

  test('a disabled (slowmode), unsupported or already recording microphone starts nothing', async () => {
    const cases: [VoiceRecorderControls & { begin: jest.Mock }, { disabled?: boolean; supported?: boolean }][] = [
      [recorder(), { disabled: true }],
      [recorder(), { supported: false }],
      [recorder({ ...IDLE, phase: 'recording', locked: true }), {}],
    ];
    for (const [rec, props] of cases) {
      const view = await render(mic(rec, props));
      const el = screen.getByTestId('composer-mic');
      await act(async () => fireEvent(el, 'accessibilityTap'));
      await act(async () => fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } }));
      expect(rec.begin).not.toHaveBeenCalled();
      await view.unmount();
    }
  });
});
