/**
 * The app shell: rails, conversation and member list, moved between by swiping.
 *
 * Phone widths are a pager like Discord's app. The nav panel (space rail + rooms) and the
 * conversation sit side by side, each a screen wide; dragging anywhere moves them with the
 * finger, and releasing commits when the drag went far enough or was a flick. From the
 * conversation, dragging left pulls the member list in from the right edge, over the chat.
 *
 * Gesture arbitration: the pan only activates on clearly horizontal movement (12 px sideways
 * before 12 px vertical), so the message list and room list keep their vertical scrolling.
 * Something that owns horizontal drags itself (a code block, a media scrubber, an image
 * carousel) wraps itself in <HorizontalGestureOwner>, which stops the shell from taking them.
 * Messages own leftward drags (swipe to reply), so the conversation's rightmost strip is the
 * shell's: a leftward drag that starts there always opens the member list (gestures.ts).
 *
 * Wide screens (tablets, unfolded foldables) show rails and conversation together and the
 * member list as a column; there is nothing to swipe. Both layouts are one tree with the
 * panels at the same places in it, so rotating or unfolding across the breakpoint restyles the
 * panels instead of remounting them (the conversation keeps its scroll position and focus).
 *
 * Android back: members -> conversation -> rails -> leave the app, and only while the shell
 * is the screen on top - a screen pushed over it handles its own back.
 *
 * Touches: whatever is on top takes them, and nothing under it reacts. Android dispatches a
 * touch to the sibling with the highest elevation first (whatever the order it draws them in),
 * so the conversation's shadow elevation must never exceed what is laid over it - otherwise
 * the drawer's list is drawn on top but the conversation's list under it scrolls. A panel
 * that is covered is also out of touch entirely (pointerEvents), so it cannot start a scroll
 * or a long-press behind the one in front.
 *
 * The keyboard goes down whenever the shell moves away from the conversation (state.ts) and
 * when another screen is pushed over the shell, so that screen does not open under it and,
 * coming back, Android finds no focused field to bring the keyboard back for.
 *
 * The thresholds are the web client's (src/lib/mobileSwipe.ts) so the two feel the same.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BackHandler,
  I18nManager,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { claimScreenRoom, openContent, openNav, setMembersOpen, setShellFocused, setShellWide, shell } from './state';
import { useTheme } from '@/theme';
import { dismissKeyboard } from '@/ui/keyboard';
import {
  DECIDE_PX,
  EDGE_ACTIVATE_PX,
  dragPosition,
  edgeZoneAccepts,
  releasePlan,
  type ReleaseAction,
} from './gestures';

const SETTLE_MS = 240;
/** Width at which rails and conversation fit side by side. */
export const WIDE_BREAKPOINT = 768;
const MEMBERS_MAX_WIDTH = 360;
/**
 * Android elevations of the phone layout. Android hands a touch to the highest-elevated
 * sibling first, so what is laid over the conversation (the scrim, then the drawer) sits above
 * the conversation's shadow, in the same order as it is drawn.
 */
export const SHELL_ELEVATION = { content: 12, scrim: 13, drawer: 14 } as const;

const settle = { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) };

interface ShellGestureContextValue {
  /** The shell's pan, for children that must win against it. */
  pan: GestureType | null;
  /**
   * The right-edge drag that opens the member list. A child gesture that claims leftward
   * drags should `requireExternalGestureToFail(edge)`, so the edge strip stays the shell's
   * (it fails as the finger comes down anywhere else, so nothing waits on it there).
   */
  edge: GestureType | null;
  /** 0 = rails in front, 1 = conversation in front. */
  progress: SharedValue<number> | null;
}

const ShellGestureContext = createContext<ShellGestureContextValue>({ pan: null, edge: null, progress: null });

/** For a child gesture that should take priority over the shell's swipe. */
export function useShellGesture(): ShellGestureContextValue {
  return useContext(ShellGestureContext);
}

/**
 * Wrap a horizontally scrolling or dragging child (code block, scrubber, carousel) so its
 * own horizontal movement is not taken for a panel swipe.
 */
export function HorizontalGestureOwner({ children }: { children: ReactNode }) {
  const { pan } = useShellGesture();
  const native = useMemo(() => {
    const g = Gesture.Native().disallowInterruption(true);
    if (pan) g.blocksExternalGesture(pan);
    return g;
  }, [pan]);
  return <GestureDetector gesture={native}>{children}</GestureDetector>;
}

export interface SwipeShellProps {
  nav: ReactNode;
  content: ReactNode;
  members?: ReactNode;
}

/**
 * Where the phone's member drawer is pinned: always the physical right edge (gestures.ts) -
 * `end` in a left-to-right layout, `start` in a right-to-left one (where `right` would be
 * swapped to the left as well), with its border on the inner, physically left side.
 */
export function drawerEdgeStyle(rtl: boolean) {
  return rtl ? styles.drawerRtl : styles.drawerLtr;
}

/**
 * Whether the shell's screen is the one in front (expo-router's useIsFocused). Required
 * lazily: the design system imports this file for HorizontalGestureOwner, and a static import
 * would load the router into everything that does (and into their tests).
 */
function useScreenFocused(): boolean {
  const { useIsFocused } = require('expo-router') as typeof import('expo-router');
  return useIsFocused();
}

/**
 * Renders nothing. Put on a screen pushed over the shell that shows a conversation (a thread)
 * or keeps one in view (the media viewer): while that screen is the one in front, its room is
 * the conversation on screen (state.ts roomOnScreen) - read as it arrives, never notified. A
 * component rather than a hook so that only such a screen follows its own navigation focus;
 * the shell's is followed once, by SwipeShell.
 */
export function ScreenRoomClaim({ roomId, spaceId }: { roomId: string; spaceId: string | null }): null {
  const focused = useScreenFocused();
  useEffect(() => (focused ? claimScreenRoom(roomId, spaceId) : undefined), [focused, roomId, spaceId]);
  return null;
}

/** Moves the shell to where a finished drag landed (runs on the JS thread). */
function commitRelease(action: ReleaseAction): void {
  if (action === 'nav') openNav();
  else if (action === 'content') openContent();
  else if (action === 'membersOpen') setMembersOpen(true);
  else if (action === 'membersClosed') setMembersOpen(false);
}

/**
 * Android back while the shell is the screen in front: members -> conversation -> rails ->
 * leave the app (false lets the system handle it). Exported for tests.
 */
export function handleShellBack(): boolean {
  if (shell.membersOpen()) {
    setMembersOpen(false);
    return true;
  }
  if (shell.panel() === 'content') {
    openNav();
    return true;
  }
  return false;
}

export function SwipeShell({ nav, content, members }: SwipeShellProps) {
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  // Side by side or not is the window's call, as everywhere else in the app (useIsWide).
  const wide = windowWidth >= WIDE_BREAKPOINT;
  // But the pager is the shell's own width: in landscape the route group pads the screen by the
  // left and right insets (src/ui/safeArea), so the shell is narrower than the window by both.
  // A drag moves the panels by this much, and the right-edge strip is at the shell's own right
  // edge, not under a side navigation bar. The window's width stands in until the first layout.
  const [measuredWidth, setMeasuredWidth] = useState<number | null>(null);
  const width = measuredWidth ?? windowWidth;
  const onLayout = useCallback((e: LayoutChangeEvent) => setMeasuredWidth(e.nativeEvent.layout.width), []);
  const focused = useScreenFocused();
  const panel = useSolid(() => shell.panel());
  const membersOpen = useSolid(() => shell.membersOpen());
  const membersAvailable = useSolid(() => shell.membersAvailable()) && !!members;

  const drawerWidth = Math.min(Math.round(width * 0.86), MEMBERS_MAX_WIDTH);
  const progress = useSharedValue(panel === 'content' ? 1 : 0);
  const drawer = useSharedValue(membersOpen ? 1 : 0);
  const startProgress = useSharedValue(0);
  const startDrawer = useSharedValue(0);
  const canMembers = useSharedValue(membersAvailable ? 1 : 0);
  const dragging = useSharedValue(0);

  // Store -> animation: any change of panel made outside a drag (a tap, a notification, the
  // back button) animates there.
  useEffect(() => {
    if (!dragging.value) progress.value = withTiming(panel === 'content' ? 1 : 0, settle);
  }, [panel, progress, dragging]);
  useEffect(() => {
    if (!dragging.value) drawer.value = withTiming(membersOpen ? 1 : 0, settle);
  }, [membersOpen, drawer, dragging]);
  useEffect(() => {
    canMembers.value = membersAvailable ? 1 : 0;
    // A phone's drawer closes with its conversation. A tablet's column is a standing choice:
    // it stays open across the moment between two rooms when neither has a member list.
    if (!wide && !membersAvailable && membersOpen) setMembersOpen(false);
  }, [wide, membersAvailable, membersOpen, canMembers]);

  // A screen pushed over the shell (a thread, a profile, settings, the call) takes the
  // keyboard down as it opens. Clearing the composer's focus here also keeps Android from
  // focusing it again - keyboard and all - when the shell comes back to the front. Nothing
  // is done on the way back: the composer only takes focus when something asks it to.
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (!focused && wasFocused.current) dismissKeyboard();
    wasFocused.current = focused;
  }, [focused]);

  // Whether the conversation is on screen (state.ts roomOnScreen) depends on both: a screen
  // over the shell hides it, and on a tablet it shows beside the rails. Kept from here, the
  // one place that lays the shell out and is navigated over; no shell, no conversation.
  useEffect(() => {
    setShellFocused(focused);
    setShellWide(wide);
  }, [focused, wide]);
  useEffect(
    () => () => {
      setShellFocused(false);
    },
    [],
  );

  // Android back, only while this screen is the one in front: listeners run newest-first, so
  // a shell that registered once would answer before the navigator and swallow the back of
  // every screen pushed over it.
  useEffect(() => {
    if (wide || !focused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', handleShellBack);
    return () => sub.remove();
  }, [wide, focused]);

  const gestures = useMemo(() => {
    const geo = { width, drawerWidth };
    const onStart = () => {
      'worklet';
      dragging.value = 1;
      startProgress.value = progress.value;
      startDrawer.value = drawer.value;
    };
    const onUpdate = (e: { translationX: number }) => {
      'worklet';
      const start = { progress: startProgress.value, drawer: startDrawer.value, canMembers: canMembers.value === 1 };
      const at = dragPosition(start, e.translationX, geo);
      progress.value = at.progress;
      drawer.value = at.drawer;
    };
    const onEnd = (e: { translationX: number; velocityX: number }) => {
      'worklet';
      dragging.value = 0;
      const start = { progress: startProgress.value, drawer: startDrawer.value, canMembers: canMembers.value === 1 };
      const plan = releasePlan(start, e.translationX, e.velocityX, geo);
      progress.value = withTiming(plan.progress, settle);
      drawer.value = withTiming(plan.drawer, settle);
      if (plan.action) runOnJS(commitRelease)(plan.action);
    };
    const onFinalize = () => {
      'worklet';
      dragging.value = 0;
    };

    const pan = Gesture.Pan()
      .enabled(!wide)
      .activeOffsetX([-DECIDE_PX, DECIDE_PX])
      .failOffsetY([-DECIDE_PX, DECIDE_PX])
      .onStart(onStart)
      .onUpdate(onUpdate)
      .onEnd(onEnd)
      .onFinalize(onFinalize);

    // The right-edge strip: a leftward drag from there opens the member list even over a
    // message (whose swipe-to-reply blocks `pan`). Anywhere else it fails on touch-down.
    const edge = Gesture.Pan()
      .enabled(!wide)
      .activeOffsetX(-EDGE_ACTIVATE_PX)
      .failOffsetX(DECIDE_PX)
      .failOffsetY([-DECIDE_PX, DECIDE_PX])
      .onTouchesDown((e, manager) => {
        'worklet';
        const touch = e.changedTouches[0];
        const start = { progress: progress.value, drawer: drawer.value, canMembers: canMembers.value === 1 };
        // x, not absoluteX: x is from the left edge of the view the gesture is attached to (the
        // shell's root, the one measured for `width`), absoluteX from the window's.
        if (!touch || !edgeZoneAccepts(touch.x, width, start)) manager.fail();
      })
      .onStart(onStart)
      .onUpdate(onUpdate)
      .onEnd(onEnd)
      .onFinalize(onFinalize);

    return { pan, edge, root: Gesture.Race(edge, pan) };
  }, [wide, width, drawerWidth, progress, drawer, startProgress, startDrawer, canMembers, dragging]);

  // On a wide screen everything sits still (identity transforms); the same styles drive both
  // layouts so the panels never change places in the tree.
  const navStyle = useAnimatedStyle(() => ({
    // The rails slide a little as the conversation covers them, rather than sitting still.
    transform: [{ translateX: wide ? 0 : interpolate(progress.value, [0, 1], [0, -width * 0.25]) }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: wide ? 0 : interpolate(progress.value, [0, 1], [width, 0]) }],
    shadowOpacity: wide ? 0 : interpolate(progress.value, [0, 1], [0.35, 0]),
  }));
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: wide ? 0 : interpolate(drawer.value, [0, 1], [drawerWidth, 0]) }],
    // A tablet's column is there only while open (kept mounted, so it reopens as it was).
    display: wide && !membersOpen ? 'none' : 'flex',
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: wide ? 0 : drawer.value * 0.5,
    // The scrim only catches taps once the drawer is properly out.
    display: !wide && drawer.value > 0.02 ? 'flex' : 'none',
  }));

  const ctx = useMemo(() => ({ pan: gestures.pan, edge: gestures.edge, progress }), [gestures, progress]);

  // Pager only: the panels out of sight are out of the accessibility tree too, and out of
  // touch - a covered panel must not scroll or long-press behind the one in front. (A drag
  // between panels is the shell's own pan, which sits above all of them.)
  const navA11y = wide || panel === 'nav';
  const contentA11y = wide || (panel === 'content' && !membersOpen);

  return (
    <ShellGestureContext.Provider value={ctx}>
      <GestureDetector gesture={gestures.root}>
        <View testID="shell" onLayout={onLayout} style={[wide ? styles.row : styles.fill, { backgroundColor: theme.colors.background }]}>
          <Animated.View
            testID="shell-nav"
            style={[wide ? [styles.wideNav, { borderEndColor: theme.colors.border }] : styles.panel, navStyle]}
            pointerEvents={navA11y ? 'auto' : 'none'}
            importantForAccessibility={navA11y ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={!navA11y}
          >
            {nav}
          </Animated.View>
          <Animated.View
            testID="shell-content"
            style={[
              wide ? styles.flex : [styles.panel, styles.contentShadow],
              { backgroundColor: theme.colors.background },
              contentStyle,
            ]}
            pointerEvents={contentA11y ? 'auto' : 'none'}
            importantForAccessibility={contentA11y ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={!contentA11y}
          >
            {content}
          </Animated.View>
          {members && membersAvailable ? (
            <>
              <Animated.View testID="shell-scrim" style={[StyleSheet.absoluteFill, styles.scrim, !wide && styles.scrimElevation, scrimStyle]}>
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={() => setMembersOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel={t('room.hideMembers')}
                />
              </Animated.View>
              <Animated.View
                testID="shell-members"
                style={[
                  wide
                    ? [styles.wideMembers, { borderStartColor: theme.colors.border }]
                    : [
                        styles.drawer,
                        styles.drawerElevation,
                        drawerEdgeStyle(I18nManager.isRTL),
                        { width: drawerWidth, backgroundColor: theme.colors.card, borderColor: theme.colors.border },
                      ],
                  drawerStyle,
                ]}
                importantForAccessibility={membersOpen ? 'auto' : 'no-hide-descendants'}
                accessibilityElementsHidden={!membersOpen}
                accessibilityViewIsModal={!wide && membersOpen}
              >
                {members}
              </Animated.View>
            </>
          ) : null}
        </View>
      </GestureDetector>
    </ShellGestureContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, overflow: 'hidden' },
  flex: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  panel: { ...StyleSheet.absoluteFill },
  contentShadow: {
    shadowColor: '#000',
    shadowOffset: { width: -6, height: 0 },
    shadowRadius: 16,
    elevation: SHELL_ELEVATION.content,
  },
  scrim: { backgroundColor: '#000' },
  scrimElevation: { elevation: SHELL_ELEVATION.scrim },
  drawerElevation: { elevation: SHELL_ELEVATION.drawer },
  drawer: { position: 'absolute', top: 0, bottom: 0 },
  /** The border on the drawer's inner (physically left) side. */
  drawerLtr: { end: 0, borderStartWidth: StyleSheet.hairlineWidth },
  drawerRtl: { start: 0, borderEndWidth: StyleSheet.hairlineWidth },
  wideNav: { width: 340, borderEndWidth: StyleSheet.hairlineWidth },
  wideMembers: { width: 280, borderStartWidth: StyleSheet.hairlineWidth },
});

export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT;
}

/** Re-export so screens can drive the shell without importing state.ts directly. */
export { openContent, openNav, setMembersOpen };
