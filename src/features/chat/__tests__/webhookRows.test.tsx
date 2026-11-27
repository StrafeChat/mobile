/**
 * Webhook and bridged messages in the list (spec 6): the posted-as name with its WEBHOOK or
 * platform tag, grouping by the identity (one webhook as two names, two bridged people through
 * one bot), its card instead of a profile, no person actions in its menus, the bridged-room
 * notice with "Learn more", and the bridged person's card (the bot behind it, "Not the Strafe
 * account", the moderator's block).
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { setRooms } from '@web/stores/rooms';
import { setMessages, type DecryptedMessage } from '@web/stores/messages';
import { setSpaces } from '@web/stores/spaces';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { orPerms } from '@web/lib/permBits';
import { PermManageMessages, PermSendMessages, PermViewChannel } from '@web/lib/spacePermissions';
import { actionSheetStore, isActionItem } from '@/ui';
import { ME, member, message, pm, resetStores, role, space, sroom, user } from '@/data/testing/fixtures';
import { forgetComposer } from '@/features/composer/state';
import { dismissWebhookCard, presentWebhookCard, webhookCardStore } from '@/features/room/webhookCard';

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
const { MessageList } = require('../list/MessageList') as typeof import('../list/MessageList');
const { WebhookCardSheetHost } = require('@/features/room/profile/WebhookCardSheet') as typeof import('@/features/room/profile/WebhookCardSheet');

const HOOK = '900';
const BOT = '800';

function webhookMessage(id: string, name: string): DecryptedMessage {
  return message('r', id, HOOK, {
    webhook_id: HOOK,
    masquerade: { kind: 'webhook', name },
    author: { id: HOOK, username: name, display_name: name, bot: true } as DecryptedMessage['author'],
  });
}

function bridged(id: string, puppet: string, name: string): DecryptedMessage {
  return message('r', id, BOT, {
    webhook_id: HOOK,
    masquerade: {
      kind: 'bridge',
      name,
      bridge: { id: HOOK, name: 'Discord #general', platform: 'discord', puppet_id: puppet },
      via: { id: BOT, username: 'strife', display_name: 'Strife', bot: true },
    },
    author: { id: puppet, username: name, display_name: name, bot: true } as DecryptedMessage['author'],
  });
}

async function renderList(list: DecryptedMessage[]) {
  setMessages('byRoom', 'r', list);
  setMessages('hasMoreOlder', 'r', false);
  await render(<MessageList roomId="r" spaceId={null} />);
  await act(async () => {
    jest.advanceTimersByTime(10);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  setRooms({ rooms: [pm('r', user('a'), { last_message_id: '9' })] });
});

afterEach(async () => {
  await act(async () => {
    actionSheetStore.set(null);
    dismissWebhookCard();
  });
  forgetComposer('r');
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('webhook messages in the list', () => {
  test('the posted-as name and the WEBHOOK tag; one webhook as two names is two authors', async () => {
    await renderList([webhookMessage('1', 'CI'), webhookMessage('2', 'CI'), webhookMessage('3', 'Deploy')]);
    expect(screen.getAllByText('CI')).toHaveLength(1);
    expect(screen.getAllByText('Deploy')).toHaveLength(1);
    expect(screen.getAllByTestId('webhook-tag')).toHaveLength(2);
    expect(screen.queryByTestId('bot-tag')).toBeNull();
    // Read with what it is, never as a member's name.
    expect(screen.getAllByLabelText(/^CI \(webhook\), /).length).toBeGreaterThan(0);
  });

  test('tapping the name opens its card, never a profile', async () => {
    await renderList([webhookMessage('1', 'CI')]);
    await fireEvent.press(screen.getByText('CI'));
    expect(webhookCardStore.get()).toMatchObject({ webhookId: HOOK, name: 'CI' });
  });

  test('its sheet has no Edit; its author menu only copies its id', async () => {
    await renderList([webhookMessage('1', 'CI')]);
    await fireEvent(screen.getAllByLabelText(/^CI \(webhook\), /)[0]!, 'longPress');
    const labels = (actionSheetStore.get()?.entries ?? []).filter(isActionItem).map((i) => i.label);
    expect(labels).not.toContain('Edit message');
    expect(labels).toContain('Report message');
    await act(async () => {
      actionSheetStore.set(null);
    });
    await fireEvent(screen.getByText('CI'), 'longPress');
    expect((actionSheetStore.get()?.entries ?? []).filter(isActionItem).map((i) => i.label)).toEqual(['Copy webhook ID']);
  });

  test("a bridged person's author menu: the bot behind it, nothing a person's menu has", async () => {
    await renderList([bridged('1', 'p1', 'Alice')]);
    await fireEvent(screen.getByText('Alice'), 'longPress');
    const labels = (actionSheetStore.get()?.entries ?? []).filter(isActionItem).map((i) => i.label);
    expect(labels).toEqual(['View the bridge bot']);
  });
});

describe('bridged messages in the list', () => {
  test('platform tag with who bridged it; two people through one bot never merge', async () => {
    await renderList([bridged('1', 'p1', 'Alice'), bridged('2', 'p1', 'Alice'), bridged('3', 'p2', 'Bob')]);
    expect(screen.getAllByText('Alice')).toHaveLength(1);
    expect(screen.getAllByText('Bob')).toHaveLength(1);
    expect(screen.getAllByLabelText('Bridged from Discord by Strife')).toHaveLength(2);
    expect(screen.getAllByText('Discord').length).toBeGreaterThan(0);
  });

  test('the bridged-room notice links to Learn more', async () => {
    await renderList([
      message('r', '1', BOT, {
        system_type: 'bridge_created',
        system_payload: JSON.stringify({ actor_id: 'a', platform: 'discord', remote_name: '#general', driver_id: BOT, driver_name: 'Strife' }),
      } as never),
    ]);
    expect(screen.getByText(/bridged this room with Discord \(#general\) through Strife/)).toBeTruthy();
    expect(screen.getByTestId('bridge-learn-more')).toBeTruthy();
  });
});

describe('the bridged person\'s card', () => {
  function seedSpace(perms: number) {
    setSpaces('spaces', [space('s1', [role('ev', 0, perms, { name: '@everyone' })])]);
    setSpaces('spaceRoomsBySpaceId', { s1: [sroom('r1', 3, { name: 'general' })] });
    setSpaceMembers('bySpaceId', 's1', [member(ME), member('alice', [], { username: 'alice', display_name: 'Alice' })]);
  }

  test('the bot behind it, "Not the Strafe account @alice", no block for a member', async () => {
    seedSpace(orPerms(PermViewChannel, PermSendMessages));
    await render(<WebhookCardSheetHost />);
    await act(async () => {
      presentWebhookCard({
        webhookId: HOOK,
        name: 'Alice',
        spaceId: 's1',
        roomId: 'r1',
        puppetId: 'p1',
        bridge: { bridgeId: HOOK, platform: 'discord', bridgeName: 'Discord #general', via: { id: BOT, name: 'Strife' } },
      });
    });
    expect(screen.getByText('Alice on Discord, posting here through a bridge.')).toBeTruthy();
    expect(screen.getByText('Strife')).toBeTruthy();
    expect(screen.getByText('Not the Strafe account')).toBeTruthy();
    expect(screen.getByText('@alice')).toBeTruthy();
    expect(screen.queryByTestId('bridged-card-block')).toBeNull();
  });

  test('a moderator gets "Block from this bridge"; a webhook\'s card says it is not an account', async () => {
    seedSpace(orPerms(PermViewChannel, PermSendMessages, PermManageMessages));
    await render(<WebhookCardSheetHost />);
    await act(async () => {
      presentWebhookCard({ webhookId: HOOK, name: 'Alice', spaceId: 's1', roomId: 'r1', puppetId: 'p1', bridge: { bridgeId: HOOK, platform: 'discord' } });
    });
    expect(screen.getByTestId('bridged-card-block')).toBeTruthy();
    await act(async () => {
      presentWebhookCard({ webhookId: HOOK, name: 'CI', spaceId: 's1', roomId: 'r1' });
    });
    expect(screen.getByText('Webhook in #general')).toBeTruthy();
    expect(screen.getByText(/isn't an account/)).toBeTruthy();
  });
});
