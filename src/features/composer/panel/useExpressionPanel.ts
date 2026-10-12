/**
 * The expression panel's place under the composer, Discord's way: the emoji / GIF panel takes
 * the keyboard's place instead of covering the conversation.
 *
 * One space under the input row is shared by the keyboard and the panel: its height is
 * max(keyboard, panel, home indicator), driven frame by frame by react-native-keyboard-
 * controller on the UI thread. So:
 * - keyboard up -> emoji: the panel takes the keyboard's current height and the keyboard is put
 *   away with the field still focused; the space never changes, the input row doesn't move;
 * - keyboard down -> emoji: the panel opens at the last keyboard height of this orientation
 *   (keyboardMemory.ts) and the composer rises once, as it would for the keyboard;
 * - panel -> keyboard (the keyboard button, or a tap on the field): the keyboard rises over the
 *   panel and the panel goes once it has fully arrived - again no jump, and a keyboard of a
 *   different height just settles to its own size;
 * - the handle drags the panel taller (towards the header) or down to close; focusing the
 *   panel's own search field expands it and keeps its content above the keyboard;
 * - Android back closes it first; leaving the conversation (the rails, the member drawer, a
 *   screen pushed over it) closes it, and so does unmounting with the room.
 * With reduced motion the panel appears and goes without animating.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { BackHandler, useWindowDimensions, type TextInput } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { KeyboardController, useKeyboardHandler } from 'react-native-keyboard-controller';
import { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSolid } from '@/bridge/solid';
import { shell } from '@/shell/state';
import { HEADER_HEIGHT, WIDE_BREAKPOINT, useReduceMotion } from '@/ui';
import { clampPanelHeight, rememberKeyboardHeight, rememberedKeyboardHeight } from './keyboardMemory';

export type ExpressionTab = 'emoji' | 'gif';

/** Close to the system keyboard's own slide. */
const SLIDE = { duration: 250, easing: Easing.out(Easing.cubic) };
/** A drag that ends this fast (pt/s) flings the panel open or shut. */
const FLING = 900;
/** If the keyboard hasn't started rising this long after asking for it, close the panel anyway
 * (a hardware keyboard, or an IME that refused). */
const KEYBOARD_FALLBACK_MS = 700;
/** Without the conversation's measured height: room for a typing row and a banner or two. */
const ESTIMATE_RESERVE = 72;

/** What useAnimatedStyle(() => ({ height })) gives. */
type HeightStyle = ReturnType<typeof useAnimatedStyle<{ height: number }>>;

export interface ExpressionPanelOptions {
  inputRef: RefObject<TextInput | null>;
  /** The composer's height above the keyboard's space: the expanded panel leaves it in view. */
  aboveHeight: number;
  /** The most height the whole composer may take; estimated from the window when unknown. */
  maxHeight?: number;
}

export interface ExpressionPanel {
  open: boolean;
  tab: ExpressionTab;
  expanded: boolean;
  setTab: (tab: ExpressionTab) => void;
  openPanel: (tab: ExpressionTab) => void;
  /** Slide it away. */
  close: () => void;
  /** Back to the keyboard, in the panel's place. */
  showKeyboard: () => void;
  /** Call from the composer field's onFocus. */
  onInputFocus: () => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  toggleExpanded: () => void;
  handleGesture: ReturnType<typeof Gesture.Pan>;
  /** The space under the input row (keyboard / panel / home indicator). */
  spacerStyle: HeightStyle;
  /** The panel itself, pinned to the bottom of that space. */
  panelStyle: HeightStyle;
  /** The panel's content, top-anchored inside it. */
  contentStyle: HeightStyle;
  /** Inside the panel, under its content: the keyboard while its search is typing, else the
   * home indicator. */
  bottomPadStyle: HeightStyle;
}

/**
 * Whether this conversation's screen is the one in front (expo-router's useIsFocused), required
 * lazily as SwipeShell does so the router stays out of modules that never render a screen.
 */
function useScreenFocused(): boolean {
  const { useIsFocused } = require('expo-router') as typeof import('expo-router');
  return useIsFocused();
}

export function useExpressionPanel({ inputRef, aboveHeight, maxHeight }: ExpressionPanelOptions): ExpressionPanel {
  const window = useWindowDimensions();
  const focused = useScreenFocused();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ExpressionTab>('emoji');
  const [expanded, setExpanded] = useState(false);

  const kb = useSharedValue(0);
  const kbTarget = useSharedValue(0);
  const base = useSharedValue(0);
  /** The height the panel is opening to / resting at (base animates towards it). */
  const rest = useSharedValue(0);
  const extra = useSharedValue(0);
  const dragStart = useSharedValue(0);
  const searching = useSharedValue(0);
  /** Open as far as the JS side's decisions go (the state lags a render behind). */
  const openRef = useRef(false);
  const bottomInset = useSharedValue(insets.bottom);
  const maxTotal = useSharedValue(0);
  const fallback = useRef<ReturnType<typeof setTimeout> | null>(null);

  const windowRef = useRef(window);
  windowRef.current = window;
  useEffect(() => {
    bottomInset.value = insets.bottom;
    // The tallest the panel gets: all the composer may take, less the input row above it.
    // (The estimate stops under a room header and a typing row.)
    const most = maxHeight ?? window.height - insets.top - HEADER_HEIGHT - ESTIMATE_RESERVE;
    maxTotal.value = Math.max(0, most - aboveHeight);
  }, [bottomInset, maxTotal, insets.bottom, insets.top, window.height, aboveHeight, maxHeight]);

  const clearFallback = () => {
    if (fallback.current) clearTimeout(fallback.current);
    fallback.current = null;
  };

  const finishClose = useCallback(() => {
    openRef.current = false;
    searching.value = 0;
    setOpen(false);
    setExpanded(false);
  }, [searching]);

  /** Gone at once: the keyboard already covers its space (or nothing should animate). */
  const closeNow = useCallback(() => {
    clearFallback();
    base.value = 0;
    extra.value = 0;
    finishClose();
  }, [base, extra, finishClose]);

  const close = useCallback(() => {
    clearFallback();
    if (!openRef.current) return;
    if (reduceMotion) {
      closeNow();
      return;
    }
    extra.value = withTiming(0, SLIDE);
    base.value = withTiming(0, SLIDE, (done) => {
      if (done) runOnJS(finishClose)();
    });
  }, [reduceMotion, closeNow, extra, base, finishClose]);

  const onKeyboardShown = useCallback(
    (height: number) => {
      rememberKeyboardHeight(height, windowRef.current);
      // The keyboard has arrived in the panel's space: the panel underneath can go. Not while
      // the keyboard is typing into the panel's own search. A keyboard shorter than the panel
      // (the first time, before its height was known) lets the space settle instead of jump.
      if (!openRef.current || searching.value) return;
      if (base.value + extra.value > height + 1) close();
      else closeNow();
    },
    [searching, base, extra, close, closeNow],
  );

  useKeyboardHandler(
    {
      onStart: (e) => {
        'worklet';
        kbTarget.value = e.height;
      },
      onMove: (e) => {
        'worklet';
        kb.value = e.height;
      },
      onInteractive: (e) => {
        'worklet';
        kb.value = e.height;
      },
      onEnd: (e) => {
        'worklet';
        kb.value = e.height;
        if (e.height > 0) runOnJS(onKeyboardShown)(e.height);
      },
    },
    [onKeyboardShown],
  );

  const openPanel = useCallback(
    (next: ExpressionTab) => {
      clearFallback();
      setTab(next);
      setExpanded(false);
      searching.value = 0;
      extra.value = 0;
      const keyboardUp = kbTarget.value > 0 && kb.value > 0;
      if (openRef.current && !keyboardUp) return;
      openRef.current = true;
      setOpen(true);
      if (keyboardUp) {
        // Exactly the keyboard's space, then the keyboard goes: nothing above it moves. The field
        // stays focused so the caret (where an emoji lands) stays visible.
        // (Through a local: a shared value written from JS can still read back its old value.)
        const height = clampPanelHeight(kbTarget.value, windowRef.current.height);
        rest.value = height;
        base.value = height;
        void KeyboardController.dismiss({ keepFocus: true });
        return;
      }
      const target = rememberedKeyboardHeight(windowRef.current);
      rest.value = target;
      base.value = reduceMotion ? target : withTiming(target, SLIDE);
    },
    [searching, extra, kbTarget, kb, base, rest, reduceMotion],
  );

  const showKeyboard = useCallback(() => {
    clearFallback();
    searching.value = 0;
    if (extra.value !== 0) extra.value = reduceMotion ? 0 : withTiming(0, SLIDE);
    setExpanded(false);
    // The field usually still has focus (the keyboard was put away with keepFocus), and
    // TextInput.focus() is a no-op on the focused field - so drop focus and take it again,
    // which raises the keyboard.
    const input = inputRef.current;
    if (input?.isFocused()) {
      input.blur();
      requestAnimationFrame(() => inputRef.current?.focus());
    } else {
      input?.focus();
    }
    fallback.current = setTimeout(() => {
      fallback.current = null;
      if (kbTarget.value <= 0) close();
    }, KEYBOARD_FALLBACK_MS);
  }, [searching, extra, reduceMotion, inputRef, kbTarget, close]);

  const onInputFocus = useCallback(() => {
    if (!openRef.current) return;
    // From the panel's search to the field: the keyboard is already up and stays, so nothing
    // will announce it - close now and let the space settle to the keyboard.
    if (kb.value > 0 && kbTarget.value > 0) {
      searching.value = 0;
      close();
    }
  }, [kb, kbTarget, searching, close]);

  const expandTo = useCallback(
    (on: boolean) => {
      // From the resting height, not base: base may still be sliding in.
      const to = on ? Math.max(0, maxTotal.value - rest.value) : 0;
      extra.value = reduceMotion ? to : withTiming(to, SLIDE);
      setExpanded(on);
    },
    [maxTotal, rest, extra, reduceMotion],
  );

  const onSearchFocus = useCallback(() => {
    searching.value = 1;
    // Discord grows the panel so the search results fit above the keyboard.
    expandTo(true);
  }, [searching, expandTo]);

  const onSearchBlur = useCallback(() => {
    searching.value = 0;
  }, [searching]);

  const toggleExpanded = useCallback(() => expandTo(!expanded), [expandTo, expanded]);

  // Android back: the panel first (listeners run newest-first, and this one is added on open).
  useEffect(() => {
    if (!open) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [open, close]);

  // Leaving the conversation (swiping to the rails, opening the member drawer) closes it. Only
  // the move counts: a thread screen pushed over the rails is not "covered" by them.
  const wide = window.width >= WIDE_BREAKPOINT;
  const covered = useSolid(() => !wide && (shell.panel() !== 'content' || shell.membersOpen()), [wide]);
  const wasCovered = useRef(covered);
  useEffect(() => {
    if (covered && !wasCovered.current && openRef.current) closeNow();
    wasCovered.current = covered;
  }, [covered, closeNow]);

  // A screen pushed over the conversation (a profile, a thread) closes it - otherwise the
  // hidden panel's back listener would answer that screen's first back.
  useEffect(() => {
    if (!focused && openRef.current) closeNow();
  }, [focused, closeNow]);

  useEffect(() => () => clearFallback(), []);

  // Turning the device: an open panel over no keyboard takes this orientation's height.
  const turned = useRef(window.width > window.height);
  useEffect(() => {
    const landscape = window.width > window.height;
    if (landscape === turned.current) return;
    turned.current = landscape;
    if (!openRef.current || kb.value > 0) return;
    const height = rememberedKeyboardHeight(windowRef.current);
    rest.value = height;
    base.value = height;
    extra.value = 0;
    setExpanded(false);
  }, [window.width, window.height, kb, rest, base, extra]);

  const handleGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-6, 6])
        .failOffsetX([-24, 24])
        .onStart(() => {
          'worklet';
          dragStart.value = extra.value;
        })
        .onUpdate((e) => {
          'worklet';
          const maxExtra = Math.max(0, maxTotal.value - base.value);
          extra.value = Math.min(maxExtra, Math.max(-base.value, dragStart.value - e.translationY));
        })
        .onEnd((e) => {
          'worklet';
          // Down past a third of the resting height (or flung down) closes; up past 40 % of
          // the way (or flung up) expands; anything else settles back.
          const maxExtra = Math.max(0, maxTotal.value - base.value);
          const v = e.velocityY;
          if (extra.value < -base.value * 0.35 || (v > FLING && extra.value <= 0)) {
            runOnJS(close)();
          } else if (v < -FLING || (v <= FLING && extra.value > maxExtra * 0.4)) {
            extra.value = withTiming(maxExtra, SLIDE);
            runOnJS(setExpanded)(true);
          } else {
            extra.value = withTiming(0, SLIDE);
            runOnJS(setExpanded)(false);
          }
        }),
    [dragStart, extra, base, maxTotal, close],
  );

  const spacerStyle = useAnimatedStyle(() => ({
    height: Math.max(kb.value, base.value + extra.value, bottomInset.value),
  }));
  const panelStyle = useAnimatedStyle(() => ({ height: Math.max(0, base.value + extra.value) }));
  // The content keeps its resting size while the panel slides in or out (the panel clips it),
  // so it moves like a keyboard instead of re-laying out the grid every frame; it only grows
  // when the panel is dragged taller.
  const contentStyle = useAnimatedStyle(() => ({ height: Math.max(rest.value, base.value + extra.value) }));
  const bottomPadStyle = useAnimatedStyle(() => ({
    height: searching.value ? Math.max(kb.value, bottomInset.value) : bottomInset.value,
  }));

  return {
    open,
    tab,
    expanded,
    setTab,
    openPanel,
    close,
    showKeyboard,
    onInputFocus,
    onSearchFocus,
    onSearchBlur,
    toggleExpanded,
    handleGesture,
    spacerStyle,
    panelStyle,
    contentStyle,
    bottomPadStyle,
  };
}
