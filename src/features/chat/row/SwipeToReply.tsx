/**
 * Swipe a message to reply (Discord's mobile gesture). The row follows the finger leftwards,
 * a reply arrow fades in at its trailing edge, a tick of haptics marks the point of no return,
 * and letting go past it starts the reply in the composer.
 *
 * The horizontal gestures over a conversation, and who owns which (src/shell/SwipeShell):
 *  - rightward, anywhere: the shell's - back to the room list (or closing the member list).
 *    The reply pan fails at once on rightward movement, so the shell gets those;
 *  - leftward, starting within EDGE_ZONE_PX of the right edge: the shell's - it pulls the
 *    member list in from that edge. The reply pan cannot begin there at all (a negative
 *    hitSlop takes that strip out of the row);
 *  - leftward from anywhere else on a message, after deliberate travel (ACTIVATE_PX before
 *    VERTICAL_SLOP_PX of vertical movement): reply. It blocks the shell while it runs
 *    (blocksExternalGesture on the shell's pan, as HorizontalGestureOwner does), and
 *    vertical movement fails it so the list scrolls.
 * Off the messages (dividers, the intro, empty space) a leftward swipe is the shell's too.
 *  - inside a message, something that scrolls sideways itself (a code block, a provider
 *    player) wraps itself in <RowHorizontalOwner>, which holds off both the shell and this
 *    row's reply pan (the shell's HorizontalGestureOwner only knows the shell's).
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector, type GestureType } from 'react-native-gesture-handler';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useShellGesture } from '@/shell/SwipeShell';
import { useTheme } from '@/theme';
import { haptics, Icon, withAlpha } from '@/ui';

/** How far to pull before letting go replies. */
export const REPLY_THRESHOLD = 56;
const MAX_PULL = 80;
/** The right-edge strip where a leftward swipe opens the member list, not a reply. */
export const EDGE_ZONE_PX = 40;
/** Leftward travel before the reply takes the gesture, and the vertical slop that fails it. */
const ACTIVATE_PX = 16;
const VERTICAL_SLOP_PX = 12;
/** Taken out of the row where the reply pan may begin: the member list's edge strip. */
const REPLY_HIT_SLOP = { right: -EDGE_ZONE_PX };

/** The enclosing row's reply pan, for a child that must win against it. */
const ReplyPanContext = createContext<GestureType | null>(null);

/**
 * Wrap a horizontally scrolling child of a message (code block, provider player) so its own
 * sideways movement is neither a panel swipe nor a swipe to reply.
 */
export function RowHorizontalOwner({ children }: { children: ReactNode }) {
  const { pan: shellPan } = useShellGesture();
  const replyPan = useContext(ReplyPanContext);
  const native = useMemo(() => {
    const g = Gesture.Native().disallowInterruption(true);
    const owners = [shellPan, replyPan].filter((x): x is GestureType => x != null);
    if (owners.length > 0) g.blocksExternalGesture(...owners);
    return g;
  }, [shellPan, replyPan]);
  return <GestureDetector gesture={native}>{children}</GestureDetector>;
}

export function SwipeToReply({ enabled, onReply, children }: { enabled: boolean; onReply: () => void; children: ReactNode }) {
  const theme = useTheme();
  const { pan: shellPan } = useShellGesture();
  const x = useSharedValue(0);
  const armed = useSharedValue(0);

  const gesture = useMemo(() => {
    const tick = () => haptics.selection();
    const g = Gesture.Pan()
      .enabled(enabled)
      .hitSlop(REPLY_HIT_SLOP)
      .activeOffsetX(-ACTIVATE_PX)
      .failOffsetX(10)
      .failOffsetY([-VERTICAL_SLOP_PX, VERTICAL_SLOP_PX])
      .onUpdate((e) => {
        const pull = Math.max(-MAX_PULL, Math.min(0, e.translationX));
        x.value = pull;
        const past = pull <= -REPLY_THRESHOLD ? 1 : 0;
        if (past !== armed.value) {
          armed.value = past;
          if (past) runOnJS(tick)();
        }
      })
      .onEnd(() => {
        if (armed.value) runOnJS(onReply)();
      })
      .onFinalize(() => {
        armed.value = 0;
        x.value = withTiming(0, { duration: 180 });
      });
    if (shellPan) g.blocksExternalGesture(shellPan);
    return g;
  }, [enabled, onReply, shellPan, x, armed]);

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
  const iconStyle = useAnimatedStyle(() => ({
    opacity: interpolate(-x.value, [12, REPLY_THRESHOLD], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(-x.value, [12, REPLY_THRESHOLD], [0.6, 1], 'clamp') }],
  }));

  if (!enabled) return <>{children}</>;
  return (
    <GestureDetector gesture={gesture}>
      <View>
        <Animated.View pointerEvents="none" style={[styles.icon, iconStyle]}>
          <View style={[styles.bubble, { backgroundColor: withAlpha(theme.colors.primary, 0.18) }]}>
            <Icon name="reply" size={14} color={theme.colors.primary} />
          </View>
        </Animated.View>
        <Animated.View style={rowStyle}>
          <ReplyPanContext.Provider value={gesture}>{children}</ReplyPanContext.Provider>
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  icon: { position: 'absolute', top: 0, bottom: 0, right: 16, justifyContent: 'center' },
  bubble: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
