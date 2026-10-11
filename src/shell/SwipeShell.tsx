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
 * The thresholds are the web client's (src/lib/mobileSwipe.ts) so the two feel the same.
 */
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { BackHandler, I18nManager, Keyboard, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
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
import { openContent, openNav, setMembersOpen, shell } from './state';
import { useTheme } from '@/theme';
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
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
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

  // Leaving the conversation (for the rails, or under the member list) puts the keyboard
  // away: it would otherwise stay up over a panel with nothing to type into.
  const covered = !wide && (panel === 'nav' || membersOpen);
  const wasCovered = useRef(covered);
  useEffect(() => {
    if (covered && !wasCovered.current) Keyboard.dismiss();
    wasCovered.current = covered;
  }, [covered]);

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

  // Pager only: the panels out of sight are out of the accessibility tree too.
  const navA11y = wide || panel === 'nav';
  const contentA11y = wide || (panel === 'content' && !membersOpen);

  return (
    <ShellGestureContext.Provider value={ctx}>
      <GestureDetector gesture={gestures.root}>
        <View style={[wide ? styles.row : styles.fill, { backgroundColor: theme.colors.background }]}>
          <Animated.View
            testID="shell-nav"
            style={[wide ? [styles.wideNav, { borderEndColor: theme.colors.border }] : styles.panel, navStyle]}
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
            importantForAccessibility={contentA11y ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={!contentA11y}
          >
            {content}
          </Animated.View>
          {members && membersAvailable ? (
            <>
              <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
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
    elevation: 12,
  },
  scrim: { backgroundColor: '#000' },
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
