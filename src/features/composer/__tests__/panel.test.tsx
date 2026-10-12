/**
 * The expression panel in the keyboard's place: it opens at exactly the keyboard's height when
 * the keyboard is up (so the input row stays put) and at the remembered height when it is
 * down; a keyboard that arrives over it closes it, unless it is typing into the panel's own
 * search; Android back and leaving the conversation close it. Plus the remembered heights and
 * the panel's backspace key.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { createRef, useRef } from 'react';
import { BackHandler, TextInput } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { appStorage } from '@/platform/storage';
import { openContent, openNav } from '@/shell/state';
import { deleteBackward, deleteStart } from '../logic/backspace';
import { MIN_PANEL_HEIGHT, orientationOf, rememberKeyboardHeight, rememberedKeyboardHeight } from '../panel/keyboardMemory';
import { useExpressionPanel } from '../panel/useExpressionPanel';

type Handler = (e: { height: number; progress: number; duration: number; target: number }) => void;
let mockKeyboard: { onStart?: Handler; onMove?: Handler; onEnd?: Handler } = {};
jest.mock('react-native-keyboard-controller', () => ({
  ...jest.requireActual<object>('react-native-keyboard-controller/jest'),
  useKeyboardHandler: (h: typeof mockKeyboard) => {
    mockKeyboard = h;
  },
}));

let mockFocused = true;
jest.mock('expo-router', () => ({ useIsFocused: () => mockFocused }));

jest.mock('@/shell/SwipeShell', () => ({
  HorizontalGestureOwner: ({ children }: { children: unknown }) => children,
  useShellGesture: () => ({ pan: null, progress: null }),
}));

// The Reanimated mock makes a new shared value on every render; the panel's state lives in
// shared values, so keep one per hook call site here as the real hook does.
const reanimated = jest.requireMock<{ useSharedValue: (init: unknown) => unknown }>('react-native-reanimated');
const freshSharedValue = reanimated.useSharedValue;
Object.assign(reanimated, {
  useSharedValue: (init: unknown) => {
    const ref = useRef<unknown>(null);
    if (ref.current === null) ref.current = freshSharedValue(init);
    return ref.current;
  },
});

type BackListener = () => boolean | null | undefined;
let backListeners: BackListener[] = [];

const WINDOW = { width: 750, height: 1334 };

beforeEach(() => {
  jest.useFakeTimers();
  appStorage.clearAll();
  openContent();
  mockFocused = true;
  backListeners = [];
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_type, fn) => {
    backListeners.push(fn as BackListener);
    return { remove: () => void (backListeners = backListeners.filter((l) => l !== fn)) };
  });
  (KeyboardController.dismiss as jest.Mock).mockClear();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/** The keyboard arriving at (or leaving to) `height`, as the controller reports it. */
async function keyboard(height: number) {
  const e = { height, progress: height > 0 ? 1 : 0, duration: 250, target: 1 };
  await act(async () => {
    mockKeyboard.onStart?.(e);
    mockKeyboard.onMove?.(e);
    mockKeyboard.onEnd?.(e);
  });
}

const heightOf = (style: unknown) => (style as { height: number }).height;

function setup() {
  const inputRef = createRef<TextInput>();
  return renderHook(() => useExpressionPanel({ inputRef, aboveHeight: 60, maxHeight: 1000 }));
}

describe('useExpressionPanel', () => {
  test('keyboard up: the panel takes exactly its height and the keyboard goes, focus kept', async () => {
    const { result, rerender } = await setup();
    await keyboard(320);
    // Shared values don't re-render under the mock; styles are read on the next render.
    await rerender({});
    const before = heightOf(result.current.spacerStyle);
    expect(before).toBe(320);
    await act(async () => result.current.openPanel('emoji'));
    expect(result.current.open).toBe(true);
    expect(heightOf(result.current.panelStyle)).toBe(320);
    expect(KeyboardController.dismiss).toHaveBeenCalledWith({ keepFocus: true });
    await keyboard(0);
    await rerender({});
    // The space under the input row never changed: the input row did not move.
    expect(heightOf(result.current.spacerStyle)).toBe(before);
    expect(result.current.open).toBe(true);
  });

  test('keyboard down: opens at the last keyboard height of this orientation', async () => {
    rememberKeyboardHeight(300, WINDOW);
    const { result } = await setup();
    await act(async () => result.current.openPanel('gif'));
    expect(result.current.tab).toBe('gif');
    expect(heightOf(result.current.panelStyle)).toBe(300);
    expect(heightOf(result.current.spacerStyle)).toBe(300);
    expect(KeyboardController.dismiss).not.toHaveBeenCalled();
  });

  test('the keyboard arriving over the panel closes it and is remembered', async () => {
    const { result } = await setup();
    await act(async () => result.current.openPanel('emoji'));
    await keyboard(310);
    expect(result.current.open).toBe(false);
    expect(heightOf(result.current.spacerStyle)).toBe(310);
    expect(rememberedKeyboardHeight(WINDOW)).toBe(310);
  });

  test('typing into the panel’s search keeps it open, expanded, above the keyboard', async () => {
    const { result, rerender } = await setup();
    await act(async () => result.current.openPanel('emoji'));
    await act(async () => result.current.onSearchFocus());
    expect(result.current.expanded).toBe(true);
    // maxHeight 1000 less the 60 above the keyboard's space.
    expect(heightOf(result.current.panelStyle)).toBe(940);
    await keyboard(300);
    await rerender({});
    expect(result.current.open).toBe(true);
    expect(heightOf(result.current.bottomPadStyle)).toBe(300);
    // Back to the message field: the keyboard stays, the panel goes.
    await act(async () => result.current.onInputFocus());
    expect(result.current.open).toBe(false);
  });

  test('the keyboard button closes the panel if no keyboard comes (a hardware keyboard)', async () => {
    const { result } = await setup();
    await act(async () => result.current.openPanel('emoji'));
    await act(async () => result.current.showKeyboard());
    expect(result.current.open).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(800);
    });
    expect(result.current.open).toBe(false);
  });

  test('Android back closes it first, and only while it is open', async () => {
    const { result } = await setup();
    expect(backListeners).toHaveLength(0);
    await act(async () => result.current.openPanel('emoji'));
    expect(backListeners).toHaveLength(1);
    let handled: boolean | null | undefined = false;
    await act(async () => {
      handled = backListeners[backListeners.length - 1]!();
    });
    expect(handled).toBe(true);
    expect(result.current.open).toBe(false);
    expect(backListeners).toHaveLength(0);
  });

  test('a screen pushed over the conversation closes it', async () => {
    const { result, rerender } = await setup();
    await act(async () => result.current.openPanel('emoji'));
    mockFocused = false;
    await rerender({});
    expect(result.current.open).toBe(false);
    expect(backListeners).toHaveLength(0);
  });

  test('swiping to the rails closes it', async () => {
    const { result } = await setup();
    await act(async () => result.current.openPanel('emoji'));
    await act(async () => openNav());
    expect(result.current.open).toBe(false);
  });

  test('the handle toggles between resting and expanded', async () => {
    rememberKeyboardHeight(300, WINDOW);
    const { result } = await setup();
    await act(async () => result.current.openPanel('emoji'));
    await act(async () => result.current.toggleExpanded());
    expect(result.current.expanded).toBe(true);
    expect(heightOf(result.current.panelStyle)).toBe(940);
    // The input row stays above it.
    expect(heightOf(result.current.spacerStyle)).toBe(940);
    await act(async () => result.current.toggleExpanded());
    expect(heightOf(result.current.panelStyle)).toBe(300);
  });
});

describe('keyboardMemory', () => {
  test('defaults to 40 % of the window, then remembers per orientation', () => {
    expect(rememberedKeyboardHeight(WINDOW)).toBe(Math.round(1334 * 0.4));
    rememberKeyboardHeight(280, WINDOW);
    expect(rememberedKeyboardHeight(WINDOW)).toBe(280);
    const landscape = { width: 1334, height: 750 };
    expect(orientationOf(landscape)).toBe('landscape');
    expect(rememberedKeyboardHeight(landscape)).toBe(300);
  });

  test('ignores a hardware keyboard’s bar and clamps odd heights', () => {
    rememberKeyboardHeight(48, WINDOW);
    expect(rememberedKeyboardHeight(WINDOW)).toBe(Math.round(1334 * 0.4));
    rememberKeyboardHeight(1300, WINDOW);
    expect(rememberedKeyboardHeight(WINDOW)).toBe(Math.round(1334 * 0.7));
    rememberKeyboardHeight(130, WINDOW);
    expect(rememberedKeyboardHeight(WINDOW)).toBe(MIN_PANEL_HEIGHT);
  });
});

describe('backspace', () => {
  const at = (text: string) => deleteBackward(text, { start: text.length, end: text.length });

  test('removes a whole emoji, however many code points', () => {
    expect(at('hi 👍🏽')).toEqual({ text: 'hi ', caret: 3 });
    expect(at('a👨‍👩‍👧‍👦')).toEqual({ text: 'a', caret: 1 });
    expect(at('🇨🇦🇫🇷')).toEqual({ text: '🇨🇦', caret: 4 });
    expect(at('#️⃣')).toEqual({ text: '', caret: 0 });
    expect(at('❤️')).toEqual({ text: '', caret: 0 });
  });

  test('removes one character, a surrogate pair or an accent with its letter', () => {
    expect(at('abc')).toEqual({ text: 'ab', caret: 2 });
    expect(at('x𝒳')).toEqual({ text: 'x', caret: 1 });
    expect(at('café')).toEqual({ text: 'caf', caret: 3 });
    expect(at('')).toEqual({ text: '', caret: 0 });
  });

  test('deletes before the caret, or the selection', () => {
    expect(deleteBackward('a😀b', { start: 3, end: 3 })).toEqual({ text: 'ab', caret: 1 });
    expect(deleteBackward('hello', { start: 1, end: 4 })).toEqual({ text: 'ho', caret: 1 });
  });

  test('a custom emoji’s :name: goes whole only when it is a known custom emoji', () => {
    const known = (n: string) => n === 'blobwave';
    expect(deleteStart('hey :blobwave:', 14, known)).toBe(4);
    expect(deleteStart('ratio 1:2:', 10, known)).toBe(9);
  });
});
