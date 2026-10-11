/**
 * The chat area's components against the web stores: the message body's node rules (pills,
 * spoilers, code, links through the guard), the list (rows, dividers, system lines, landing,
 * the ack, the long-press sheet with the web's gates, reaction pills), and the typing row.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { setRooms } from '@web/stores/rooms';
import { setMessages } from '@web/stores/messages';
import { setReadState } from '@web/stores/readState';
import { addTyping } from '@web/stores/typing';
import { actionSheetStore, isActionItem } from '@/ui';
import { ME, message, pm, resetStores, user } from '@/data/testing/fixtures';
import { composerFor, forgetComposer } from '@/features/composer/state';

 
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
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, canDismiss: () => false }, Stack: { Screen: () => null } }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true), getStringAsync: jest.fn(async () => '') }));
jest.mock('@web/stores/externalLink', () => ({ isExternalLink: () => true, requestOpenExternalLink: jest.fn() }));
jest.mock('@/features/composer', () => ({ EmojiPickerSheet: () => null }));
const mockListReactors = jest.fn(async () => []);
jest.mock('@web/api/messages', () => ({
  ...jest.requireActual<Record<string, unknown>>('@web/api/messages'),
  listReactors: (...args: unknown[]) => mockListReactors(...(args as [])),
}));
jest.mock('@web/api/unfurl', () => ({ fetchUnfurl: async (url: string) => ({ url, title: 'Example page', description: 'About it' }) }));
jest.mock('@/platform/media', () => ({
  useAttachmentSource: () => ({ status: 'loading', progress: null }),
  attachmentSourceSync: () => null,
  saveAttachmentToDevice: jest.fn(),
  shareAttachment: jest.fn(),
  playExclusive: jest.fn(),
  useExclusivePlayback: () => undefined,
}));
const mockLeave = jest.fn();
jest.mock('@/platform/rooms', () => ({
  enterRoom: () => ({ roomId: 'r', spaceId: () => null, leave: mockLeave }),
  spaceIdOfRoom: () => null,
}));
const mockAck = { setBottomVisibleMessageId: jest.fn(), dispose: jest.fn() };
jest.mock('@/platform/overrides/lib/viewportAck', () => ({ createRoomViewportAck: () => mockAck }));

// A FlashList stand-in: every row rendered, the ref methods the list calls, onLoad after mount
// and every row reported visible (so the ack has something to publish). It reports a 600 px
// viewport over 5000 px of content, scrolled to `mockList.offset`.
const mockList = { offset: 0, scrollToIndex: jest.fn(async (_p: { index: number; viewPosition?: number }) => undefined) };
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
        onScroll?: (e: unknown) => void;
        ListHeaderComponent?: unknown;
        ListFooterComponent?: unknown;
      },
      ref: unknown,
    ) => {
      React.useImperativeHandle(ref, () => ({
        scrollToEnd: jest.fn(),
        scrollToIndex: mockList.scrollToIndex,
        getAbsoluteLastScrollOffset: () => mockList.offset,
        getLayout: () => ({ x: 0, y: 0, width: 0, height: 0 }),
        getFirstItemOffset: () => 0,
        recomputeViewableItems: () => p.onViewableItemsChanged?.({ viewableItems: p.data.map((item, index) => ({ item, index, isViewable: true })) }),
      }));
      React.useEffect(() => {
        p.onScroll?.({ nativeEvent: { contentOffset: { y: mockList.offset }, contentSize: { height: 5000 }, layoutMeasurement: { height: 600 } } });
        p.onLoad?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount, as FlashList does
      }, []);
      return React.createElement(
        RN.View,
        { testID: 'message-list' },
        p.ListHeaderComponent ?? null,
        p.data.map((item: unknown, index: number) => React.createElement(React.Fragment, { key: p.keyExtractor(item) }, p.renderItem({ item, index }))),
        p.ListFooterComponent ?? null,
      );
    },
  );
  return { FlashList };
});
 

const storeMock = jest.requireMock<Record<string, unknown>>('@web/stores/messages');
const toggleReaction = jest.fn(async () => undefined);
Object.assign(storeMock, {
  toggleReaction,
  loadOlderMessages: jest.fn(async () => false),
  loadNewerMessages: jest.fn(async () => false),
  jumpToPresent: jest.fn(async () => undefined),
  jumpToMessage: jest.fn(async () => undefined),
});

// After the mocks.
 
const { MessageBody } = require('../body/MessageBody') as typeof import('../body/MessageBody');
const { MessageList } = require('../list/MessageList') as typeof import('../list/MessageList');
const { TypingIndicator } = require('../TypingIndicator') as typeof import('../TypingIndicator');
const Clipboard = require('expo-clipboard') as { setStringAsync: jest.Mock };
const externalLink = require('@web/stores/externalLink') as { requestOpenExternalLink: jest.Mock };
 

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  setRooms({ rooms: [pm('r', user('a'), { last_message_id: '3' })] });
  toggleReaction.mockClear();
  mockList.offset = 0;
  mockList.scrollToIndex.mockClear();
  (storeMock.loadOlderMessages as jest.Mock).mockClear();
  mockAck.setBottomVisibleMessageId.mockClear();
  mockLeave.mockClear();
});

afterEach(async () => {
  await act(async () => {
    actionSheetStore.set(null);
  });
  forgetComposer('r');
  jest.clearAllTimers();
  jest.useRealTimers();
});

function body(text: string) {
  return render(<MessageBody text={text} roomId="r" spaceId={null} allowLinkPreviews={false} />);
}

describe('message body', () => {
  test('styling nests and mentions show the person by name', async () => {
    await body('**bold _both_** and <@100>');
    expect(screen.getByText('both')).toBeTruthy();
    expect(screen.getByLabelText('@Me')).toBeTruthy();
  });

  test('a spoiler hides its text until tapped', async () => {
    await body('||the secret||');
    const hidden = screen.getByLabelText('Spoiler, click to reveal');
    await fireEvent.press(hidden);
    expect(screen.queryByLabelText('Spoiler, click to reveal')).toBeNull();
    expect(screen.getByText('the secret')).toBeTruthy();
  });

  test('links open through the external-link guard', async () => {
    await body('see https://example.com/page');
    await fireEvent.press(screen.getByText('https://example.com/page'));
    expect(externalLink.requestOpenExternalLink).toHaveBeenCalledWith('https://example.com/page');
  });

  test('preview titles are underlined when the reader asks for underlined links', async () => {
    const { setAccessibility } = require('@web/stores/accessibility') as typeof import('@web/stores/accessibility');
    await render(<MessageBody text="see https://preview.example/page" roomId="r" spaceId={null} allowLinkPreviews />);
    await act(async () => {
      await Promise.resolve();
    });
    const title = () => StyleSheet.flatten(screen.getByText('Example page').props.style) as { textDecorationLine?: string };
    expect(title().textDecorationLine).toBeUndefined();
    await act(async () => {
      setAccessibility({ underlineLinks: true });
    });
    expect(title().textDecorationLine).toBe('underline');
    await act(async () => {
      setAccessibility({ underlineLinks: false });
    });
  });

  test('a code block shows its language and copies its source', async () => {
    await body('```js\nconst a = 1;\n```');
    expect(screen.getByText('javascript')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByLabelText('Copy'));
    });
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith('const a = 1;');
    expect(screen.getByLabelText('Copied')).toBeTruthy();
  });

  test('unknown rooms and roles degrade as on the web', async () => {
    await body('<#999> <@&5>');
    expect(screen.getByText(/#unknown/)).toBeTruthy();
    expect(screen.getByText(/<@&5>/)).toBeTruthy();
  });

  test('timestamps render in the reader\'s locale', async () => {
    await body('<t:0:D>');
    expect(screen.getByText(/1970|1969/)).toBeTruthy();
  });

  test('emoji-only messages render jumbo images', async () => {
    await body('😀😀');
    expect(screen.getAllByLabelText('😀')).toHaveLength(2);
  });
});

describe('message list', () => {
  function seed() {
    setReadState('byRoom', 'r', { lastReadMessageId: '1', mentionCount: 0 });
    setMessages('byRoom', 'r', [
      message('r', '1', 'a'),
      message('r', '2', 'a', { reactions: [{ emoji: '👍', count: 2, me: false }] }),
      message('r', '3', ME, { reply_to_id: '1' }),
      message('r', '4', 'a', { system_type: 'member_left', system_payload: JSON.stringify({ user_id: 'a' }) } as never),
    ]);
    setMessages('hasMoreOlder', 'r', false);
  }

  test('rows, the intro, the NEW divider and system lines render; the room is entered and left', async () => {
    seed();
    const view = await render(<MessageList roomId="r" spaceId={null} />);
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    // Message 1 also appears as the preview on the reply to it.
    expect(screen.getAllByText('message 1')).toHaveLength(2);
    expect(screen.getByText('message 3')).toBeTruthy();
    // Unread from someone else after the cursor: the NEW divider above message 2.
    expect(screen.getAllByText(/New messages/).length).toBeGreaterThan(0);
    expect(screen.getByText('User a left the group')).toBeTruthy();
    // The reply line names the original author.
    expect(screen.getAllByText('User a').length).toBeGreaterThan(0);
    await act(async () => view.unmount());
    expect(mockLeave).toHaveBeenCalled();
  });

  test('the read cursor follows the bottom-most visible message (debounced)', async () => {
    seed();
    await render(<MessageList roomId="r" spaceId={null} />);
    await act(async () => {
      jest.advanceTimersByTime(600);
    });
    expect(mockAck.setBottomVisibleMessageId).toHaveBeenCalledWith('4');
  });

  test('long-press opens the message sheet with the web\'s actions in order', async () => {
    seed();
    await render(<MessageList roomId="r" spaceId={null} />);
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    const row = screen.getAllByLabelText(/^User a, /)[0]!;
    await fireEvent(row, 'longPress');
    const req = actionSheetStore.get();
    expect(req).toBeTruthy();
    const labels = (req?.entries ?? []).filter(isActionItem).map((i) => i.label);
    expect(labels).toEqual(['Add reaction', 'Copy text', 'Copy message ID', 'Reply', 'Pin message', 'Report message']);
  });

  test('your own message offers edit and delete; Reply goes to the composer', async () => {
    seed();
    await render(<MessageList roomId="r" spaceId={null} />);
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    const mine = screen.getAllByLabelText(/^Me, /)[0]!;
    await fireEvent(mine, 'longPress');
    const items = (actionSheetStore.get()?.entries ?? []).filter(isActionItem);
    expect(items.map((i) => i.label)).toEqual(['Add reaction', 'Copy text', 'Copy message ID', 'Reply', 'Pin message', 'Edit message', 'Delete message']);
    await act(async () => {
      await items.find((i) => i.label === 'Reply')!.onSelect!();
    });
    expect(composerFor('r').replyTo).toBe('3');
  });

  test('screen readers get the sheet and the swipe-to-reply as row actions', async () => {
    seed();
    await render(<MessageList roomId="r" spaceId={null} />);
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    const row = screen.getAllByLabelText(/^User a, /)[0]!;
    expect((row.props.accessibilityActions as { name: string }[]).map((a) => a.name)).toEqual(['longpress', 'reply']);
    await act(async () => {
      fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'reply' } });
    });
    expect(composerFor('r').replyTo).toBe('1');
    await act(async () => {
      fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
    });
    expect(actionSheetStore.get()).toBeTruthy();
  });

  test('"Create thread" opens the room area\'s form for the message', async () => {
    const { messageActionItems } = require('../actions/messageActions') as typeof import('../actions/messageActions');
    const { createThreadStore } = require('@/features/room/presenters') as typeof import('@/features/room/presenters');
    const gates = { canReact: false, canReply: true, canPin: false, canDeleteOthers: false, canOfferCreateThread: true } as never;
    const items = messageActionItems(message('c1', '42', 'a'), { roomId: 'c1', spaceId: 's1' }, gates);
    const create = items.find((i) => i.key === 'createThread');
    expect(create?.label).toBe('Create thread');
    await act(async () => {
      await create!.onSelect!();
    });
    expect(createThreadStore.get()).toEqual(expect.objectContaining({ spaceId: 's1', roomId: 'c1', starterMessageId: '42' }));
    createThreadStore.set(null);
  });

  test('a pill the viewer cannot join stays inert but still shows who reacted', async () => {
    seed();
    const { MessageReactionsRow } = require('../reactions/Reactions') as typeof import('../reactions/Reactions');
    await render(<MessageReactionsRow roomId="r" messageId="2" canJoin={false} canAdd={false} />);
    const pill = screen.getByLabelText('👍 2');
    expect(pill.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(pill);
    expect(toggleReaction).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent(pill, 'longPress');
    });
    expect(mockListReactors).toHaveBeenCalledWith('r', '2', '👍');
  });

  test('a reaction pill toggles the reaction', async () => {
    seed();
    await render(<MessageList roomId="r" spaceId={null} />);
    await act(async () => {
      jest.advanceTimersByTime(10);
    });
    await fireEvent.press(screen.getByLabelText('👍 2'));
    expect(toggleReaction).toHaveBeenCalledWith('r', '2', '👍', false);
  });

  test('regression: a page arriving while the list reads "at the top" does not page again by itself', async () => {
    // #files-test: after each prepend the list did not keep its place, so it still read as
    // near the top, and every arriving page loaded the next - back to the first message.
    const page = (from: number) => Array.from({ length: 50 }, (_, i) => message('r', String(from + i), 'a'));
    setMessages('byRoom', 'r', page(1000));
    setMessages('hasMoreOlder', 'r', true);
    let next = 900;
    const loadOlder = storeMock.loadOlderMessages as jest.Mock<(roomId: string) => Promise<boolean>>;
    loadOlder.mockImplementation(async () => {
      setMessages('loadingOlder', 'r', true);
      await Promise.resolve();
      setMessages('byRoom', 'r', (prev) => [...page(next), ...(prev ?? [])]);
      setMessages('loadingOlder', 'r', false);
      next -= 100;
      return true;
    });
    mockList.offset = 120;
    const view = await render(<MessageList roomId="r" spaceId={null} />);
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
    }
    // One page for the landing near the top; nothing after it without the reader scrolling.
    expect(loadOlder).toHaveBeenCalledTimes(1);
    await act(async () => view.unmount());
    loadOlder.mockReset();
    loadOlder.mockImplementation(async () => false);
  });

  test('a jump requested before the list mounted lands on its message, even after a slow first load', async () => {
    seed();
    setMessages('loading', 'r', true);
    const saved = (storeMock.messages as { byRoom: Record<string, unknown> }).byRoom.r;
    setMessages('byRoom', 'r', undefined as never);
    const view = await render(<MessageList roomId="r" spaceId={null} />);
    // The window takes longer than the reveal fallback to arrive.
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.queryByTestId('message-list')).toBeNull();
    await act(async () => {
      setMessages('byRoom', 'r', saved as never);
      setMessages('jumpTarget', 'r', { id: '2', nonce: 1, smooth: false });
      setMessages('loading', 'r', false);
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    const call = mockList.scrollToIndex.mock.calls.at(-1)?.[0];
    expect(call?.viewPosition).toBe(0.5);
    // Rows: intro, 1, 2 (NEW divider folded into it), 3, 4.
    expect(call?.index).toBe(2);
    await act(async () => view.unmount());
  });

  test('a first page slower than the reveal fallback still lands on the first unread', async () => {
    seed();
    const saved = (storeMock.messages as { byRoom: Record<string, unknown> }).byRoom.r;
    // A fresh room id: its first view has not happened this session.
    setReadState('byRoom', 'slow', { lastReadMessageId: '1', mentionCount: 0 });
    setMessages('loading', 'slow', true);
    const view2 = await render(<MessageList roomId="slow" spaceId={null} />);
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    await act(async () => {
      setMessages('byRoom', 'slow', (saved as { id: string }[]).map((m) => ({ ...m, room_id: 'slow' })) as never);
      setMessages('hasMoreOlder', 'slow', false);
      setMessages('loading', 'slow', false);
    });
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    expect(mockList.scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 2, viewOffset: -96 }));
    await act(async () => view2.unmount());
  });

  test('a first load that fails offers a retry instead of an endless skeleton', async () => {
    const load = storeMock.loadMessages as jest.Mock<(roomId: string) => Promise<void>>;
    load.mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await render(<MessageList roomId="fails" spaceId={null} />);
    await act(async () => {
      await Promise.resolve();
    });
    const retry = screen.getByRole('button', { name: 'Retry' });
    await act(async () => {
      await fireEvent.press(retry);
    });
    expect(load).toHaveBeenLastCalledWith('fails');
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    warn.mockRestore();
  });

  test('the whole-room skeleton shows while the first page loads', async () => {
    setMessages('loading', 'r', true);
    await render(<MessageList roomId="r" spaceId={null} />);
    expect(screen.queryByTestId('message-list')).toBeNull();
  });
});

describe('typing indicator', () => {
  test('names who is typing, and keeps its height when nobody is', async () => {
    const view = await render(<TypingIndicator roomId="r" />);
    expect(screen.queryByText(/typing/)).toBeNull();
    await act(async () => {
      addTyping('r', 'a');
    });
    expect(screen.getByText('User a is typing…')).toBeTruthy();
    await act(async () => view.unmount());
  });
});

describe('media viewer', () => {
  test('shows the item, its position and facts; zooms in steps; closing clears the store', async () => {
     
    const { MediaViewerScreen } = require('../viewer/MediaViewerScreen') as typeof import('../viewer/MediaViewerScreen');
    const viewer = require('@web/stores/mediaViewer') as typeof import('@web/stores/mediaViewer');
     
    viewer.openMediaViewer(
      [
        { url: 'https://cdn.example/a.png', filename: 'a.png', size: 2048, width: 800, height: 600 },
        { url: 'file:///cache/b.jpg', filename: 'b.jpg' },
      ],
      0,
    );
    const view = await render(<MediaViewerScreen />);
    expect(screen.getByText('a.png')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();
    expect(screen.getByText('2.0 KB · 800×600')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Zoom in'));
    expect(screen.getByText('150%')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'b.jpg' }));
    expect(viewer.mediaViewer.index).toBe(1);
    await fireEvent.press(screen.getByLabelText('Close'));
    expect(viewer.mediaViewer.open).toBe(false);
    await act(async () => view.unmount());
  });
});
