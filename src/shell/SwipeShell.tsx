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
 *
 * Wide screens (tablets, unfolded foldables) show rails and conversation together and the
 * member list as a column; there is nothing to swipe.
 *
 * The thresholds are the web client's (src/lib/mobileSwipe.ts) so the two feel the same.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { BackHandler, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
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
import { useSolid } from '@/bridge/solid';
import { openContent, openNav, setMembersOpen, shell } from './state';
import { useTheme } from '@/theme';

/** Movement before deciding a gesture is a horizontal swipe rather than a scroll. */
const DECIDE_PX = 12;
/** Fraction of a panel that has to be dragged for the swipe to commit on release. */
const COMMIT_FRACTION = 0.28;
const COMMIT_MAX_PX = 140;
/** A quick flick commits even when it did not travel far (px/s; the web's 0.45 px/ms). */
const FLICK_VELOCITY = 450;
const SETTLE_MS = 240;
/** Width at which rails and conversation fit side by side. */
export const WIDE_BREAKPOINT = 768;
const MEMBERS_MAX_WIDTH = 360;

const settle = { duration: SETTLE_MS, easing: Easing.out(Easing.cubic) };

interface ShellGestureContextValue {
  /** The shell's pan, for children that must win against it. */
  pan: GestureType | null;
  /** 0 = rails in front, 1 = conversation in front. */
  progress: SharedValue<number> | null;
}

const ShellGestureContext = createContext<ShellGestureContextValue>({ pan: null, progress: null });

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

export function SwipeShell(props: SwipeShellProps) {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_BREAKPOINT;
  return wide ? <WideShell {...props} /> : <PagerShell {...props} width={width} />;
}

function WideShell({ nav, content, members }: SwipeShellProps) {
  const theme = useTheme();
  const membersAvailable = useSolid(() => shell.membersAvailable());
  const membersOpen = useSolid(() => shell.membersOpen());
  return (
    <View style={[styles.row, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.wideNav, { borderRightColor: theme.colors.border }]}>{nav}</View>
      <View style={styles.flex}>{content}</View>
      {members && membersAvailable && membersOpen ? (
        <View style={[styles.wideMembers, { borderLeftColor: theme.colors.border }]}>{members}</View>
      ) : null}
    </View>
  );
}

function PagerShell({ nav, content, members, width }: SwipeShellProps & { width: number }) {
  const theme = useTheme();
  const panel = useSolid(() => shell.panel());
  const membersOpen = useSolid(() => shell.membersOpen());
  const membersAvailable = useSolid(() => shell.membersAvailable() && !!members);

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
    if (!membersAvailable && membersOpen) setMembersOpen(false);
  }, [membersAvailable, membersOpen, canMembers]);

  // Android back: members -> conversation -> rails -> leave the app.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (shell.membersOpen()) {
        setMembersOpen(false);
        return true;
      }
      if (shell.panel() === 'content') {
        openNav();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, []);

  const commitDistance = Math.min(width * COMMIT_FRACTION, COMMIT_MAX_PX);
  const drawerCommit = Math.min(drawerWidth * COMMIT_FRACTION, COMMIT_MAX_PX);

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-DECIDE_PX, DECIDE_PX])
        .failOffsetY([-DECIDE_PX, DECIDE_PX])
        .onStart(() => {
          dragging.value = 1;
          startProgress.value = progress.value;
          startDrawer.value = drawer.value;
        })
        .onUpdate((e) => {
          if (startDrawer.value > 0.5) {
            // Members open: dragging right closes it.
            drawer.value = Math.min(1, Math.max(0, 1 - e.translationX / drawerWidth));
            return;
          }
          if (startProgress.value > 0.5) {
            if (e.translationX < 0) {
              // Conversation in front, dragging left: pull the member list in.
              if (canMembers.value) drawer.value = Math.min(1, -e.translationX / drawerWidth);
              progress.value = 1;
            } else {
              drawer.value = 0;
              progress.value = Math.max(0, 1 - e.translationX / width);
            }
            return;
          }
          // Rails in front: dragging left brings the conversation over.
          progress.value = Math.min(1, Math.max(0, -e.translationX / width));
        })
        .onEnd((e) => {
          dragging.value = 0;
          const vx = e.velocityX;
          const dx = e.translationX;
          if (startDrawer.value > 0.5) {
            const close = dx > drawerCommit || vx > FLICK_VELOCITY;
            drawer.value = withTiming(close ? 0 : 1, settle);
            runOnJS(setMembersOpen)(!close);
            return;
          }
          if (startProgress.value > 0.5) {
            if (dx < 0 && canMembers.value) {
              const open = -dx > drawerCommit || vx < -FLICK_VELOCITY;
              drawer.value = withTiming(open ? 1 : 0, settle);
              progress.value = withTiming(1, settle);
              runOnJS(setMembersOpen)(open);
              return;
            }
            const toNav = dx > commitDistance || vx > FLICK_VELOCITY;
            progress.value = withTiming(toNav ? 0 : 1, settle);
            if (toNav) runOnJS(openNav)();
            return;
          }
          const toContent = -dx > commitDistance || vx < -FLICK_VELOCITY;
          progress.value = withTiming(toContent ? 1 : 0, settle);
          if (toContent) runOnJS(openContent)();
        })
        .onFinalize(() => {
          dragging.value = 0;
        }),
    [width, drawerWidth, commitDistance, drawerCommit, progress, drawer, startProgress, startDrawer, canMembers, dragging],
  );

  const navStyle = useAnimatedStyle(() => ({
    // The rails slide a little as the conversation covers them, rather than sitting still.
    transform: [{ translateX: interpolate(progress.value, [0, 1], [0, -width * 0.25]) }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.value, [0, 1], [width, 0]) }],
    shadowOpacity: interpolate(progress.value, [0, 1], [0.35, 0]),
  }));
  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(drawer.value, [0, 1], [drawerWidth, 0]) }],
  }));
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: drawer.value * 0.5,
  }));
  const scrimPointer = useAnimatedStyle(() => ({
    // The scrim only catches taps once the drawer is properly out.
    display: drawer.value > 0.02 ? 'flex' : 'none',
  }));

  const ctx = useMemo(() => ({ pan, progress }), [pan, progress]);

  return (
    <ShellGestureContext.Provider value={ctx}>
      <GestureDetector gesture={pan}>
        <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
          <Animated.View
            style={[styles.panel, navStyle]}
            importantForAccessibility={panel === 'nav' ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={panel !== 'nav'}
          >
            {nav}
          </Animated.View>
          <Animated.View
            style={[styles.panel, styles.contentShadow, { backgroundColor: theme.colors.background }, contentStyle]}
            importantForAccessibility={panel === 'content' && !membersOpen ? 'auto' : 'no-hide-descendants'}
            accessibilityElementsHidden={panel !== 'content' || membersOpen}
          >
            {content}
          </Animated.View>
          {members && membersAvailable ? (
            <>
              <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle, scrimPointer]}>
                <Pressable
                  style={StyleSheet.absoluteFill}
                  onPress={() => setMembersOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close member list"
                />
              </Animated.View>
              <Animated.View
                style={[
                  styles.drawer,
                  { width: drawerWidth, backgroundColor: theme.colors.card, borderLeftColor: theme.colors.border },
                  drawerStyle,
                ]}
                importantForAccessibility={membersOpen ? 'auto' : 'no-hide-descendants'}
                accessibilityElementsHidden={!membersOpen}
                accessibilityViewIsModal={membersOpen}
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
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    borderLeftWidth: StyleSheet.hairlineWidth,
  },
  wideNav: { width: 340, borderRightWidth: StyleSheet.hairlineWidth },
  wideMembers: { width: 280, borderLeftWidth: StyleSheet.hairlineWidth },
});

export function useIsWide(): boolean {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT;
}

/** Re-export so screens can drive the shell without importing state.ts directly. */
export { openContent, openNav, setMembersOpen };

