/**
 * The 0.1.1 crash on deleting a message ("index out of bounds, not enough layouts"), the
 * guarded FlashList calls that replaced the bare ones, and store calls from the list's taps
 * that fail (a rejection there is unhandled - and the tap silently does nothing - unless the
 * list catches it).
 *
 * The FlashList stand-in here keeps FlashList v2's timing, which is what the crash was about:
 * it trims its layouts to the new data while rendering, but refreshes the indices it last saw
 * on screen only in a follow-up commit that its own layout effect schedules. React flushes the
 * list owner's effects before that follow-up render, so recomputeViewableItems() from an
 * effect of the shrinking commit finds a stale index and throws, exactly as on the device.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { t } from '@web/i18n/t';
import { setRooms } from '@web/stores/rooms';
import { setMessages } from '@web/stores/messages';
import { setReadState } from '@web/stores/readState';
import { message, pm, resetStores, user } from '@/data/testing/fixtures';
import { roomOnScreen } from '@/shell/state';
import { toastStore } from '@/ui/toast';
import { safeRecomputeViewableItems, safeScrollToEnd, safeScrollToIndex } from '../safeList';

jest.mock('expo-image', () => {
  const React = require('react');
  const RN = require('react-native');
  const Image = (p: { accessibilityLabel?: string; testID?: string }) =>
    React.createElement(RN.View, { testID: p.testID ?? 'image', accessibilityLabel: p.accessibilityLabel });
  Image.prefetch = async () => true;
  return { Image };
});
jest.mock('expo-video', () => ({ useVideoPlayer: () => ({ addListener: () => ({ remove: () => undefined }) }), VideoView: () => null }));
jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ play: () => undefined, pause: () => undefined, seekTo: async () => undefined, setPlaybackRate: () => undefined }),
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0, didJustFinish: false, isBuffering: false, mute: false, playbackRate: 1, error: null }),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, canDismiss: () => false },
  Stack: { Screen: () => null },
  useIsFocused: () => true,
}));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true), getStringAsync: jest.fn(async () => '') }));
jest.mock('@web/stores/externalLink', () => ({ isExternalLink: () => true, requestOpenExternalLink: jest.fn() }));
jest.mock('@/features/composer', () => ({ EmojiPickerSheet: () => null }));
jest.mock('@web/api/unfurl', () => ({ fetchUnfurl: async (url: string) => ({ url }) }));
jest.mock('@/platform/media', () => ({
  useAttachmentSource: () => ({ status: 'loading', progress: null }),
  attachmentSourceSync: () => null,
  saveAttachmentToDevice: jest.fn(),
  shareAttachment: jest.fn(),
  playExclusive: jest.fn(),
  useExclusivePlayback: () => undefined,
}));
const mockEnter = jest.fn();
const mockLeave = jest.fn();
jest.mock('@/platform/rooms', () => ({
  enterRoom: (...args: unknown[]) => {
    mockEnter(...args);
    return { roomId: 'r', spaceId: () => null, leave: mockLeave };
  },
  spaceIdOfRoom: () => null,
}));
const mockAck = { setBottomVisibleMessageId: jest.fn(), dispose: jest.fn() };
jest.mock('@/platform/overrides/lib/viewportAck', () => ({ createRoomViewportAck: () => mockAck }));

/** What the stand-in's ref saw: every recompute, and the ones that would have thrown. */
const mockList = { recomputes: 0, outOfBounds: 0 };
jest.mock('@shopify/flash-list', () => {
  const React = require('react');
  const RN = require('react-native');
  // eslint-disable-next-line react/display-name -- a test stand-in
  const FlashList = React.forwardRef(
    (
      p: {
        data: unknown[];
        renderItem: (i: { item: unknown; index: number }) => unknown;
        keyExtractor: (i: unknown) => string;
        onLoad?: () => void;
        onViewableItemsChanged?: (info: { viewableItems: unknown[] }) => void;
      },
      ref: unknown,
    ) => {
      // processDataUpdate: the layouts follow the data while rendering.
      const layouts = React.useRef(0);
      layouts.current = p.data.length;
      // The indices last seen on screen: refreshed only after the follow-up commit.
      const onScreen = React.useRef([] as number[]);
      const [renderId, setRenderId] = React.useState(0);
      React.useLayoutEffect(() => {
        setRenderId((n: number) => n + 1);
      }, [p.data]);
      React.useEffect(() => {
        if (renderId > 0) onScreen.current = p.data.map((_: unknown, i: number) => i);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- on the follow-up commit, as FlashList's onCommitEffect
      }, [renderId]);
      React.useImperativeHandle(ref, () => ({
        scrollToEnd: jest.fn(),
        scrollToIndex: jest.fn(async () => undefined),
        getAbsoluteLastScrollOffset: () => 0,
        getLayout: () => undefined,
        getFirstItemOffset: () => 0,
        recomputeViewableItems: () => {
          mockList.recomputes += 1;
          if (onScreen.current.some((i: number) => i >= layouts.current)) {
            mockList.outOfBounds += 1;
            throw new Error('index out of bounds, not enough layouts');
          }
          p.onViewableItemsChanged?.({ viewableItems: onScreen.current.map((index: number) => ({ item: p.data[index], index, isViewable: true })) });
        },
      }));
      React.useEffect(() => {
        p.onLoad?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount, as FlashList does
      }, []);
      return React.createElement(
        RN.View,
        { testID: 'message-list' },
        p.data.map((item: unknown, index: number) => React.createElement(React.Fragment, { key: p.keyExtractor(item) }, p.renderItem({ item, index }))),
      );
    },
  );
  return { FlashList };
});

const storeMock = jest.requireMock<Record<string, unknown>>('@web/stores/messages');
Object.assign(storeMock, {
  loadOlderMessages: jest.fn(async () => false),
  loadNewerMessages: jest.fn(async () => false),
  jumpToPresent: jest.fn(async () => undefined),
  jumpToMessage: jest.fn(async () => undefined),
});

// After the mocks.
const { MessageList } = require('../MessageList') as typeof import('../MessageList');

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  setRooms({ rooms: [pm('r', user('a'), { last_message_id: '4' })] });
  setReadState('byRoom', 'r', { lastReadMessageId: '4', mentionCount: 0 });
  setMessages('byRoom', 'r', ['1', '2', '3', '4'].map((id) => message('r', id, 'a')));
  setMessages('hasMoreOlder', 'r', false);
  mockList.recomputes = 0;
  mockList.outOfBounds = 0;
  mockEnter.mockClear();
  mockLeave.mockClear();
  mockAck.setBottomVisibleMessageId.mockClear();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('message list: rows removed', () => {
  test('regression: deleting the bottom message recomputes viewability after FlashList caught up, not in that commit', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = await render(<MessageList roomId="r" spaceId={null} />);
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(mockAck.setBottomVisibleMessageId).toHaveBeenLastCalledWith('4');
    const before = mockList.recomputes;

    await act(async () => {
      setMessages('byRoom', 'r', (prev) => (prev ?? []).filter((m) => m.id !== '4'));
    });
    // Nothing called into the list in the shrinking commit...
    expect(mockList.recomputes).toBe(before);
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    // ...it re-measured a frame later, against layouts that match, and acked the new bottom.
    expect(mockList.recomputes).toBeGreaterThan(before);
    expect(mockList.outOfBounds).toBe(0);
    expect(mockAck.setBottomVisibleMessageId).toHaveBeenLastCalledWith('3');
    // No boundary had to step in: the list was never torn down and re-entered.
    expect(mockEnter).toHaveBeenCalledTimes(1);
    expect(mockLeave).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalledWith(expect.stringContaining('[message-list]'), expect.anything(), expect.anything());
    expect(screen.queryByText('message 4')).toBeNull();
    expect(screen.getByText('message 3')).toBeTruthy();
    await act(async () => view.unmount());
    errors.mockRestore();
  });

  test('removing several rows at once, repeatedly, never asks for a layout the list no longer has', async () => {
    const view = await render(<MessageList roomId="r" spaceId={null} />);
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    for (const keep of [['1', '2', '3'], ['1'], []]) {
      await act(async () => {
        setMessages('byRoom', 'r', (prev) => (prev ?? []).filter((m) => keep.includes(m.id)));
      });
      await act(async () => {
        jest.advanceTimersByTime(20);
      });
    }
    expect(mockList.outOfBounds).toBe(0);
    expect(mockLeave).not.toHaveBeenCalled();
    await act(async () => view.unmount());
  });
});

describe('guarded FlashList calls', () => {
  const warn = () => jest.spyOn(console, 'warn').mockImplementation(() => undefined);

  test('scrollToIndex is skipped for an index outside the data, and resolves either way', async () => {
    const list = { scrollToIndex: jest.fn(async () => undefined), scrollToEnd: jest.fn() };
    await expect(safeScrollToIndex(list, { index: 3 }, 3)).resolves.toBeUndefined();
    await expect(safeScrollToIndex(list, { index: -1 }, 3)).resolves.toBeUndefined();
    await expect(safeScrollToIndex(list, { index: Number.NaN }, 3)).resolves.toBeUndefined();
    expect(list.scrollToIndex).not.toHaveBeenCalled();
    await safeScrollToIndex(list, { index: 2, animated: false }, 3);
    expect(list.scrollToIndex).toHaveBeenCalledWith({ index: 2, animated: false });
    await expect(safeScrollToIndex(null, { index: 0 }, 3)).resolves.toBeUndefined();
  });

  test('a throw or a rejection inside the list is caught and logged, never propagated', async () => {
    const w = warn();
    const boom = (): never => {
      throw new Error('index out of bounds, not enough layouts');
    };
    const list = {
      scrollToIndex: jest.fn<(p: { index: number }) => Promise<void>>(boom),
      scrollToEnd: jest.fn((): Promise<void> => Promise.reject(new Error('gone'))),
      recomputeViewableItems: jest.fn(boom),
    };
    await expect(safeScrollToIndex(list, { index: 0 }, 1)).resolves.toBeUndefined();
    list.scrollToIndex.mockImplementation(() => Promise.reject(new Error('mid-scroll')));
    await expect(safeScrollToIndex(list, { index: 0 }, 1)).resolves.toBeUndefined();
    expect(() => safeScrollToEnd(list, { animated: false })).not.toThrow();
    expect(() => safeRecomputeViewableItems(list)).not.toThrow();
    // scrollToEnd's rejection is logged a few microtasks later.
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(w).toHaveBeenCalledTimes(4);
    expect(() => safeScrollToEnd(undefined)).not.toThrow();
    expect(() => safeRecomputeViewableItems({ scrollToIndex: jest.fn(), scrollToEnd: jest.fn() })).not.toThrow();
    w.mockRestore();
  });
});

describe('taps whose store call fails', () => {
  const offline = () => new TypeError('Network request failed');

  test('"Jump to present" that cannot fetch the present says so, and leaves the bar to try again', async () => {
    toastStore.set(null);
    const jump = storeMock.jumpToPresent as jest.Mock<(roomId: string) => Promise<void>>;
    jump.mockImplementationOnce(() => Promise.reject(offline()));
    setMessages('hasMoreNewer', 'r', true);
    const view = await render(<MessageList roomId="r" spaceId={null} />);
    await act(async () => {
      fireEvent.press(screen.getByText(t('messages.jumpToPresent')));
    });
    expect(jump).toHaveBeenCalledWith('r');
    expect(toastStore.get()?.tone).toBe('error');
    expect(screen.getByText(t('messages.jumpToPresent'))).toBeTruthy();
    await act(async () => view.unmount());
  });

  test('a reply whose original cannot be loaded says so', async () => {
    toastStore.set(null);
    const jump = storeMock.jumpToMessage as jest.Mock<(roomId: string, messageId: string) => Promise<void>>;
    jump.mockImplementationOnce(() => Promise.reject(offline()));
    setMessages('byRoom', 'r', [
      ...['2', '3'].map((id) => message('r', id, 'a')),
      message('r', '4', 'a', { reply_to_id: '1', referenced_message: message('r', '1', 'a') }),
    ]);
    const view = await render(<MessageList roomId="r" spaceId={null} />);
    await act(async () => {
      fireEvent.press(screen.getByHintText(t('messages.replyJump')));
    });
    expect(jump).toHaveBeenCalledWith('r', '1');
    expect(toastStore.get()?.tone).toBe('error');
    await act(async () => view.unmount());
  });
});

test("on a pushed screen (a thread) the list's room is the conversation on screen while that screen is in front", async () => {
  const view = await render(<MessageList roomId="r" spaceId={null} screen />);
  expect(roomOnScreen()).toEqual({ roomId: 'r', spaceId: null });
  await act(async () => view.unmount());
  expect(roomOnScreen()).toBeNull();
});
