/**
 * A message row and screen readers: the header and text are one element with the row's
 * actions - the sheet, reply, the author's profile where no avatar offers it, and each link,
 * image, invite card, code block, mention and room in the text, no two labelled alike - and
 * nothing above it is an element, so VoiceOver still reaches the avatar, attachments, the
 * thread strip and the reaction pills on their own. A double-tap opens the sheet on both
 * platforms.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import i18next from 'i18next';
import { Platform } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';
import { setRooms } from '@web/stores/rooms';
import { setSpaces } from '@web/stores/spaces';
import { setMessages } from '@web/stores/messages';
import { actionSheetStore } from '@/ui';
import { message, pm, resetStores, space, sroom, user } from '@/data/testing/fixtures';
import chatEn from '@/i18n/areas/chat/en';
import { ListContext, type ListContextValue } from '../listContext';

// The app's window.location shim (the instance's web origin), which invite links are read against.
const g = globalThis as unknown as { window?: { location?: unknown } };
g.window = g.window ?? (globalThis as never);
if (!g.window!.location) g.window!.location = { origin: 'https://chat.example', pathname: '/', search: '', href: 'https://chat.example/' };

// The chat area's own strings, so assertions read as users hear them.
i18next.addResourceBundle('en', 'translation', { mobile: { chat: chatEn } }, true, true);

jest.mock('expo-image', () => {
  const React = require('react');
  const RN = require('react-native');
  return { Image: (p: { accessibilityLabel?: string }) => React.createElement(RN.View, { accessibilityLabel: p.accessibilityLabel }) };
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
jest.mock('@/platform/media', () => ({
  useAttachmentSource: () => ({ status: 'loading', progress: null }),
  attachmentSourceSync: () => null,
  saveAttachmentToDevice: jest.fn(),
  shareAttachment: jest.fn(),
  playExclusive: jest.fn(),
  useExclusivePlayback: () => undefined,
}));
jest.mock('@/platform/rooms', () => ({ spaceIdOfRoom: () => null }));
// An invite card stays a skeleton: its preview is not under test.
jest.mock('@web/api/spaces', () => ({
  ...jest.requireActual<object>('@web/api/spaces'),
  getInvitePreview: () => new Promise(() => undefined),
}));
const mockOpenRoom = jest.fn();
jest.mock('@/shell/state', () => ({
  ...jest.requireActual<object>('@/shell/state'),
  openRoom: (...a: unknown[]) => mockOpenRoom(...a),
}));

const { MessageRow } = require('../MessageRow') as typeof import('../MessageRow');
const externalLink = require('@web/stores/externalLink') as { requestOpenExternalLink: jest.Mock };
const { router } = require('expo-router') as { router: { push: jest.Mock } };
const Clipboard = require('expo-clipboard') as { setStringAsync: jest.Mock };

const CTX: ListContextValue = {
  roomId: 'r',
  spaceId: null,
  compact: false,
  allowLinkPreviews: false,
  canReply: true,
  canReact: true,
  canJoinReactions: true,
  groupSpacing: 16,
};

function item(id: string, showHeader: boolean) {
  return { kind: 'message' as const, key: id, id, senderId: '7', showHeader, groupStart: false, mentionsMe: false, system: false, pending: false };
}

async function row(id: string, showHeader = true, ctx: Partial<ListContextValue> = {}) {
  await render(
    <ListContext.Provider value={{ ...CTX, ...ctx }}>
      <MessageRow item={item(id, showHeader)} />
    </ListContext.Provider>,
  );
}

/** The message element (its label starts with the author). */
function messageElement(): TestInstance {
  return screen.getByLabelText(/^User 7, /);
}

function actionNames(el: TestInstance): string[] {
  return (el.props.accessibilityActions as { name: string }[]).map((a) => a.name);
}

function actionLabels(el: TestInstance): string[] {
  return (el.props.accessibilityActions as { label?: string }[]).map((a) => a.label ?? '');
}

/** On iOS an accessible ancestor makes everything under it one element VoiceOver cannot enter. */
function hasAccessibleAncestor(el: TestInstance): boolean {
  for (let n = el.parent; n; n = n.parent) if (n.props.accessible === true) return true;
  return false;
}

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  setRooms({ rooms: [pm('r', user('7')), pm('b', user('8'))] });
  setSpaces('spaceRoomsBySpaceId', { s1: [sroom('900', 3, { name: 'general' })] });
  externalLink.requestOpenExternalLink.mockClear();
  mockOpenRoom.mockClear();
  router.push.mockClear();
  Clipboard.setStringAsync.mockClear();
});

afterEach(async () => {
  await act(async () => {
    actionSheetStore.set(null);
  });
  jest.clearAllTimers();
  jest.useRealTimers();
});

describe('message row accessibility', () => {
  test('the header and text are one element; the row around it is not, so the rest stays reachable', async () => {
    setMessages('byRoom', 'r', [
      message('r', '1', '7', {
        reactions: [{ emoji: '👍', count: 2, me: false }],
        attachments: [{ id: 'f', url: 'https://cdn/f.pdf', filename: 'notes.pdf', contentType: 'application/pdf', size: 10 }],
      } as never),
    ]);
    await row('1');
    const el = messageElement();
    expect(el.props.accessible).toBe(true);
    expect(hasAccessibleAncestor(el)).toBe(false);
    expect(actionNames(el)).toEqual(['longpress', 'reply']);
    for (const label of ['👍 2', 'Add reaction', 'User 7', /^notes\.pdf, /]) {
      const other = screen.getAllByLabelText(label)[0]!;
      expect(hasAccessibleAncestor(other)).toBe(false);
    }
  });

  test('links, mentions and rooms in the text are actions that do what a tap does', async () => {
    setMessages('byRoom', 'r', [message('r', '1', '7', { plaintext: 'see https://example.com/a and <@8> in <#900>, again https://example.com/a', mention_users: [user('8')] } as never)]);
    await row('1');
    const el = messageElement();
    expect(actionLabels(el)).toEqual(['Show actions', 'Reply', 'Open link: https://example.com/a', 'Open profile: @User 8', 'Go to #general']);
    await act(async () => {
      fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName: 'body:0' } });
    });
    expect(externalLink.requestOpenExternalLink).toHaveBeenCalledWith('https://example.com/a');
    await act(async () => {
      fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName: 'body:2' } });
    });
    expect(mockOpenRoom).toHaveBeenCalledWith('900', 's1');
  });

  test('an image, an invite card and a code block in the text do what a tap on them does', async () => {
    const code = 'const a = 1;';
    setMessages('byRoom', 'r', [
      message('r', '1', '7', { plaintext: `look https://cdn.example/cat.png and https://other.example/invite/abc123\n\`\`\`\n${code}\n\`\`\`\n\`\`\`\nmore\n\`\`\`` }),
    ]);
    await row('1');
    const el = messageElement();
    expect(actionLabels(el)).toEqual(['Show actions', 'Reply', 'Open image: cat.png', 'Open invite page', 'Copy code', 'Copy code (2)']);
    const run = (actionName: string) => act(async () => fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName } }));
    // The viewer, as a tap on the picture - not the browser.
    await run('body:0');
    expect(router.push).toHaveBeenLastCalledWith('/media');
    // The invite page in the app (the card's Join), even for another instance's link.
    await run('body:1');
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/invite/[code]', params: { code: 'abc123' } });
    expect(externalLink.requestOpenExternalLink).not.toHaveBeenCalled();
    await run('body:2');
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(code);
  });

  test('no two actions read alike: VoiceOver would run the first of them for both', async () => {
    setSpaces('spaces', [space('s1', [], { name: 'Gaming' }), space('s2', [], { name: 'Work' })]);
    setSpaces('spaceRoomsBySpaceId', { s2: [sroom('901', 3, { name: 'general' })] });
    setMessages('byRoom', 'r', [
      message('r', '1', '7', {
        plaintext: '[docs](https://a.example/x) [docs](https://b.example/y) [docs](https://b.example/z) <@8> <@9> <#900> <#901>',
        mention_users: [user('8', { display_name: 'Alex' }), user('9', { display_name: 'Alex' })],
      } as never),
    ]);
    await row('1');
    const el = messageElement();
    const labels = actionLabels(el);
    expect(labels.slice(2)).toEqual([
      'Open link: docs (a.example)',
      'Open link: docs (https://b.example/y)',
      'Open link: docs (https://b.example/z)',
      'Open profile: @Alex (user8)',
      'Open profile: @Alex (user9)',
      'Go to #general (Gaming)',
      'Go to #general (Work)',
    ]);
    expect(new Set(labels).size).toBe(labels.length);
    await act(async () => {
      fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName: 'body:1' } });
    });
    expect(externalLink.requestOpenExternalLink).toHaveBeenCalledWith('https://b.example/y');
  });

  test("the author's profile is an action where no avatar offers it (a continuation, compact mode)", async () => {
    setMessages('byRoom', 'r', [message('r', '1', '7'), message('r', '2', '7')]);
    await row('2', false);
    expect(actionLabels(messageElement())).toEqual(['Show actions', 'Reply', 'Open profile: User 7']);
    await screen.unmount();
    await row('1', true, { compact: true });
    expect(actionNames(messageElement())).toContain('profile');
  });

  test("VoiceOver's double-tap opens the message sheet instead of tapping whatever is in the middle", async () => {
    setMessages('byRoom', 'r', [message('r', '1', '7', { plaintext: 'https://example.com/a' })]);
    await row('1');
    await act(async () => {
      fireEvent(messageElement(), 'accessibilityTap');
    });
    expect(actionSheetStore.get()).toBeTruthy();
    expect(externalLink.requestOpenExternalLink).not.toHaveBeenCalled();
  });

  test("TalkBack's double-tap (the 'activate' action, Android only) opens the message sheet too", async () => {
    const os = Platform.OS;
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    try {
      setMessages('byRoom', 'r', [message('r', '1', '7', { plaintext: 'https://example.com/a' })]);
      await row('1');
      const el = messageElement();
      expect(actionNames(el)).toEqual(['activate', 'longpress', 'reply', 'body:0']);
      await act(async () => {
        fireEvent(el, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
      });
      expect(actionSheetStore.get()).toBeTruthy();
      expect(externalLink.requestOpenExternalLink).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
    }
  });
});
