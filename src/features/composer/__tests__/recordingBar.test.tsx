/**
 * The recording bar and screen readers: whatever the screen reader says on the loudspeaker
 * while the microphone is open is recorded into the clip, so "Recording" is said once, while
 * the microphone is still opening, and nothing after: the clock is labelled but never live, and
 * the lock and the cap drawing near are felt, not said.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import i18next from 'i18next';
import { AccessibilityInfo } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { makeMutable } from 'react-native-reanimated';
import { haptics } from '@/ui';
import composerEn from '@/i18n/areas/composer/en';
import { RecordingBar } from '../components/RecordingBar';
import type { VoiceRecorderState } from '../hooks/useVoiceRecorder';

// The shell (reached through @/ui) is not under test here; keep its navigation imports out.
jest.mock('@/shell/SwipeShell', () => ({
  HorizontalGestureOwner: ({ children }: { children: unknown }) => children,
  useShellGesture: () => ({ pan: null, progress: null }),
}));

jest.mock('@/platform/media', () => ({ VOICE_MESSAGE_MAX_MS: 300000 }));

i18next.addResourceBundle('en', 'translation', { mobile: { composer: composerEn } }, true, true);

const announce = jest.fn();
const buzz = jest.fn();

beforeEach(() => {
  announce.mockClear();
  buzz.mockClear();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(announce);
  jest.spyOn(haptics, 'warning').mockImplementation(buzz);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const take = (over: Partial<VoiceRecorderState> = {}): VoiceRecorderState => ({ phase: 'recording', locked: true, elapsedMs: 0, levels: [], ...over });

function bar(state: VoiceRecorderState) {
  return <RecordingBar state={state} dragX={makeMutable(0)} rtl={false} onCancel={() => undefined} />;
}

/** Every node in the rendered tree that carries a live region. */
function liveRegions(): unknown[] {
  return screen.container.queryAll((n) => n.props.accessibilityLiveRegion != null && n.props.accessibilityLiveRegion !== 'none');
}

describe('RecordingBar', () => {
  test('"recording" is said once, before the microphone opens; the ticking clock is labelled, not live', async () => {
    const view = await render(bar(take({ phase: 'starting' })));
    expect(announce.mock.calls).toEqual([['Recording']]);
    announce.mockClear();
    await view.rerender(bar(take({ elapsedMs: 100 })));
    for (const ms of [1000, 2000, 3000]) await view.rerender(bar(take({ elapsedMs: ms })));
    expect(liveRegions()).toEqual([]);
    expect(screen.getByTestId('recording-clock').props.accessibilityLabel).toBe('Recording, 0:03');
    expect(announce).not.toHaveBeenCalled();
  });

  test('nothing is said while recording: not a lock, not the last 30 seconds (they buzz once instead)', async () => {
    const view = await render(bar(take({ locked: false, elapsedMs: 500 })));
    await view.rerender(bar(take({ locked: true, elapsedMs: 900 })));
    await view.rerender(bar(take({ elapsedMs: 269_000 })));
    expect(buzz).not.toHaveBeenCalled();
    for (const ms of [270_000, 271_000, 285_000, 299_000]) {
      await act(async () => view.rerender(bar(take({ elapsedMs: ms }))));
    }
    expect(announce).not.toHaveBeenCalled();
    expect(buzz).toHaveBeenCalledTimes(1);
    expect(liveRegions()).toEqual([]);
  });
});
