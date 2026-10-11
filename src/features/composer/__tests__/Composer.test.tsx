/**
 * The composer against the real web stores: autocomplete insertion and wire serialization on
 * send, typing announcements, the reply strip, edit mode (readable mentions in, wire syntax
 * out), a failed send coming back with its reason, slowmode, and the closed states (official
 * account, no encryption engine).
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { TextInput } from 'react-native';
import { setSpellcheck } from '@web/stores/settings';
import { setRooms } from '@web/stores/rooms';
import { setMessages } from '@web/stores/messages';
import { startSlowmode, clearSlowmode } from '@web/stores/slowmode';
import { ME, message, pm, resetStores, user } from '@/data/testing/fixtures';
import { Composer } from '../Composer';
import { FOCUS_REQUEST_TTL_MS, composerFor, forgetComposer, requestComposerFocus, startEdit, startReply } from '../state';
import { discardAttachmentQueue } from '../attachmentQueues';

jest.mock('react-native-keyboard-controller', () => require('react-native-keyboard-controller/jest'));

jest.mock('expo-audio', () => ({
  useAudioPlayer: () => ({ playing: false, play: () => undefined, pause: () => undefined, seekTo: async () => undefined }),
  useAudioPlayerStatus: () => ({ playing: false, currentTime: 0, duration: 0, didJustFinish: false }),
}));

jest.mock('expo-image', () => {
  const React = require('react');
  const RN = require('react-native');
  return { Image: (p: { testID?: string }) => React.createElement(RN.View, { testID: p.testID }) };
});

jest.mock('@web/api/rooms', () => ({ ...jest.requireActual<object>('@web/api/rooms'), sendTyping: (...a: unknown[]) => mockSendTyping(...a) }));

jest.mock('@web/stores/externalLink', () => ({ requestOpenExternalLink: () => undefined }));

/** The expression sheet's latest props (the GIF picker itself is pickers.test.tsx's). */
let mockSheet: { onPickGif?: (gif: { id: string; url: string }) => void } = {};
jest.mock('../components/ExpressionSheet', () => ({
  ExpressionSheet: (p: typeof mockSheet) => {
    mockSheet = p;
    return null;
  },
}));

jest.mock('@/shell/SwipeShell', () => ({
  HorizontalGestureOwner: ({ children }: { children: unknown }) => children,
  useShellGesture: () => ({ pan: null, progress: null }),
}));

jest.mock('@/platform/crypto/host', () => {
  let state = 'ready';
  const listeners = new Set<Function>();
  return {
    cryptoHost: {
      get state() {
        return state;
      },
      onStateChange(l: Function) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      mockSet(next: string) {
        state = next;
        listeners.forEach((l) => l(next));
      },
    },
  };
});

type MockItem = { localId: string; file: { uri: string; name: string; type: string; size: number }; previewUrl?: string };

jest.mock('@/platform/media', () => {
  const { createSignal } = require('solid-js');
  let n = 0;
  function createAttachmentDraft() {
    const [items, setItems] = createSignal([] as MockItem[]);
    const [error, setError] = createSignal('');
    return {
      items,
      error,
      setError,
      addFiles: async (files: MockItem['file'][]) => {
        setItems((prev: MockItem[]) => [...prev, ...[...files].map((f) => ({ localId: `l${++n}`, file: f, previewUrl: f.uri }))]);
      },
      remove: (id: string) => setItems((prev: MockItem[]) => prev.filter((x) => x.localId !== id)),
      take: () => {
        const list = items();
        setItems([]);
        return list;
      },
      restore: (list: MockItem[]) => setItems((prev: MockItem[]) => [...list, ...prev]),
      clear: () => setItems([]),
    };
  }
  class VoiceRecorderError extends Error {
    reason: string;
    constructor(reason: string) {
      super(reason);
      this.reason = reason;
    }
  }
  return {
    createAttachmentDraft,
    asWebPendingAttachments: (l: unknown) => l,
    isVoiceRecordingSupported: () => true,
    recoverPendingPick: async () => null,
    startVoiceRecording: async () => {
      throw new VoiceRecorderError('denied');
    },
    VOICE_MESSAGE_MAX_MS: 300000,
    VoiceRecorderError,
    playExclusive: async () => undefined,
    useExclusivePlayback: () => undefined,
    pickFromLibrary: async () => ({ status: 'cancelled' }),
    takePhoto: async () => ({ status: 'cancelled' }),
    recordVideo: async () => ({ status: 'cancelled' }),
    pickDocuments: async () => ({ status: 'cancelled' }),
  };
});

const sendMessage = jest.fn(async (..._args: unknown[]) => ({ id: 'sent' }) as unknown);
const editMessage = jest.fn(async (..._args: unknown[]) => ({ id: 'edited' }) as unknown);
const mockSendTyping = jest.fn(async (..._a: unknown[]) => undefined);
const sendTyping = mockSendTyping;

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  Object.assign(jest.requireMock<object>('@web/stores/messages'), { sendMessage, editMessage, jumpToMessage: jest.fn(async () => undefined) });
  sendMessage.mockClear();
  editMessage.mockClear();
  sendTyping.mockClear();
  setRooms({
    rooms: [
      pm('r', user('1', { username: 'alice', display_name: 'Alice' })),
      pm('o', user('9', { username: 'strafe', display_name: 'Strafe', system: true })),
    ],
  });
  setMessages('byRoom', 'r', [message('r', '5', ME, { plaintext: 'hey <@1>' }), message('r', '6', '1', { plaintext: 'hello there' })]);
});

afterEach(() => {
  for (const id of ['r', 'o']) {
    forgetComposer(id);
    discardAttachmentQueue(id);
  }
  clearSlowmode('r');
  setSpellcheck(true);
  jest.clearAllTimers();
  jest.useRealTimers();
});

const input = () => screen.getByTestId('composer-input');
/** The TextInput mock's focus(), shared by every instance. */
const focusSpy = (TextInput.prototype as unknown as { focus: jest.Mock }).focus;

async function type(text: string) {
  await fireEvent(input(), 'focus');
  await fireEvent.changeText(input(), text);
  await fireEvent(input(), 'selectionChange', { nativeEvent: { selection: { start: text.length, end: text.length } } });
}

describe('Composer', () => {
  test('autocomplete inserts @username, and send serializes it to the wire', async () => {
    await render(<Composer roomId="r" spaceId={null} />);
    expect(input().props.placeholder).toBe('Message @Alice');
    await type('hi @al');
    await fireEvent.press(screen.getByTestId('completion-user:1'));
    expect(input().props.value).toBe('hi @alice ');
    expect(sendTyping).toHaveBeenCalledTimes(1);

    await fireEvent.press(screen.getByTestId('composer-send'));
    expect(sendMessage).toHaveBeenCalledWith('r', 'hi <@1>', undefined, []);
    expect(input().props.value).toBe('');
    expect(composerFor('r').draft).toBe('');
  });

  test('a reply shows its strip and goes out with the message', async () => {
    await render(<Composer roomId="r" spaceId={null} />);
    await act(async () => startReply('r', '6'));
    expect(screen.getByTestId('composer-reply-strip')).toBeTruthy();
    expect(screen.getByText('hello there')).toBeTruthy();
    await type('sure');
    await fireEvent.press(screen.getByTestId('composer-send'));
    expect(sendMessage).toHaveBeenCalledWith('r', 'sure', '6', []);
    expect(screen.queryByTestId('composer-reply-strip')).toBeNull();
  });

  test('edit mode shows mentions as @names, saves wire syntax, and gives the draft back', async () => {
    await render(<Composer roomId="r" spaceId={null} />);
    await type('my draft');
    await act(async () => startEdit('r', '5'));
    expect(screen.getByTestId('composer-edit-strip')).toBeTruthy();
    expect(input().props.value).toBe('hey @alice');
    await fireEvent.changeText(input(), 'hey @alice!');
    await fireEvent.press(screen.getByTestId('composer-send'));
    expect(editMessage).toHaveBeenCalledWith('r', '5', 'hey <@1>!');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByTestId('composer-edit-strip')).toBeNull();
    expect(input().props.value).toBe('my draft');
  });

  test('saving an emptied edit cancels instead of deleting', async () => {
    await render(<Composer roomId="r" spaceId={null} />);
    await act(async () => startEdit('r', '5'));
    await fireEvent.changeText(input(), '   ');
    await fireEvent.press(screen.getByTestId('composer-send'));
    expect(editMessage).not.toHaveBeenCalled();
    expect(composerFor('r').editing).toBeNull();
  });

  test('a failed send restores the text and reply and says why', async () => {
    jest.spyOn(console, 'warn').mockImplementationOnce(() => undefined);
    sendMessage.mockImplementationOnce(async () => {
      throw new Error('Too many requests');
    });
    await render(<Composer roomId="r" spaceId={null} />);
    await act(async () => startReply('r', '6'));
    await type('hello');
    await fireEvent.press(screen.getByTestId('composer-send'));
    expect(screen.getByTestId('composer-error')).toBeTruthy();
    expect(input().props.value).toBe('hello');
    expect(composerFor('r').replyTo).toBe('6');
    expect(screen.getByText('Retry')).toBeTruthy();
  });

  test('slowmode shows the countdown and holds the send', async () => {
    await render(<Composer roomId="r" spaceId={null} />);
    await act(async () => startSlowmode('r', 30));
    await type('wait for it');
    expect(screen.getByTestId('composer-slowmode')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('composer-send'));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  test("the official account's PM is read-only", async () => {
    await render(<Composer roomId="o" spaceId={null} />);
    expect(screen.getByTestId('composer-locked')).toBeTruthy();
    expect(screen.getByText("You can't reply to official messages.")).toBeTruthy();
    expect(screen.queryByTestId('composer-input')).toBeNull();
  });

  test('an encrypted room closes when the encryption engine has failed', async () => {
    const { cryptoHost } = jest.requireMock<{ cryptoHost: { mockSet(s: string): void } }>('@/platform/crypto/host');
    await render(<Composer roomId="r" spaceId={null} />);
    await act(async () => cryptoHost.mockSet('failed'));
    expect(screen.getByTestId('composer-locked')).toBeTruthy();
    expect(screen.queryByTestId('composer-input')).toBeNull();
    await act(async () => cryptoHost.mockSet('ready'));
    expect(screen.getByTestId('composer-input')).toBeTruthy();
  });

  test('the draft stays with its room', async () => {
    const view = await render(<Composer roomId="r" spaceId={null} />);
    await type('half written');
    await view.rerender(<Composer roomId="o" spaceId={null} />);
    await view.rerender(<Composer roomId="r" spaceId={null} />);
    expect(input().props.value).toBe('half written');
  });

  test('the microphone shows on an empty composer; a denied microphone explains itself', async () => {
    await render(<Composer roomId="r" spaceId={null} />);
    expect(screen.getByTestId('composer-mic')).toBeTruthy();
    await act(async () => {
      fireEvent(screen.getByTestId('composer-mic'), 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
      await Promise.resolve();
    });
    expect(screen.getByText('Microphone access is off. Turn it on in Settings to record voice messages.')).toBeTruthy();
  });

  test('the spellcheck setting drives the keyboard spellcheck and autocorrect', async () => {
    await render(<Composer roomId="r" spaceId={null} />);
    expect(input().props.spellCheck).toBe(true);
    expect(input().props.autoCorrect).toBe(true);
    await act(async () => setSpellcheck(false));
    expect(input().props.spellCheck).toBe(false);
    expect(input().props.autoCorrect).toBe(false);
  });

  test('opening a room never focuses the composer; a reply does', async () => {
    focusSpy.mockClear();
    await render(<Composer roomId="r" spaceId={null} />);
    expect(focusSpy).not.toHaveBeenCalled();
    await act(async () => startReply('r', '6'));
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  test("a focus request made while the room is still opening is honoured once it mounts (a push's Reply)", async () => {
    focusSpy.mockClear();
    requestComposerFocus('r');
    const view = await render(<Composer roomId="r" spaceId={null} />);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    // Not replayed when the room is opened again later.
    await view.rerender(<Composer roomId="o" spaceId={null} />);
    await view.rerender(<Composer roomId="r" spaceId={null} />);
    expect(focusSpy).toHaveBeenCalledTimes(1);
  });

  test('a stale focus request does not pop the keyboard on entering the room', async () => {
    focusSpy.mockClear();
    requestComposerFocus('r');
    jest.advanceTimersByTime(FOCUS_REQUEST_TTL_MS + 1);
    jest.setSystemTime(Date.now() + FOCUS_REQUEST_TTL_MS + 1);
    await render(<Composer roomId="r" spaceId={null} />);
    expect(focusSpy).not.toHaveBeenCalled();
  });

  test('a send the store refuses outright says so in words and keeps the text', async () => {
    jest.spyOn(console, 'warn').mockImplementationOnce(() => undefined);
    sendMessage.mockImplementationOnce(async () => null);
    await render(<Composer roomId="r" spaceId={null} />);
    await type('hello');
    await fireEvent.press(screen.getByTestId('composer-send'));
    expect(screen.getByText('Failed to send')).toBeTruthy();
    expect(screen.queryByText('not sent')).toBeNull();
    expect(input().props.value).toBe('hello');
  });

  test('a failed GIF shows why without a Retry that would send the draft instead', async () => {
    jest.spyOn(console, 'warn').mockImplementationOnce(() => undefined);
    sendMessage.mockImplementationOnce(async () => {
      throw new Error('Too many requests');
    });
    await render(<Composer roomId="r" spaceId={null} />);
    await type('unrelated draft');
    await act(async () => {
      mockSheet.onPickGif?.({ id: 'g', url: 'https://media.example/x.gif' });
    });
    expect(sendMessage).toHaveBeenCalledWith('r', 'https://media.example/x.gif');
    expect(screen.getByTestId('composer-error')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
    expect(input().props.value).toBe('unrelated draft');
  });
});
