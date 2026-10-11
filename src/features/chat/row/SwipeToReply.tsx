/**
 * Swipe a message to reply (Discord's mobile gesture). The row follows the finger leftwards,
 * a reply arrow fades in at its trailing edge, a tick of haptics marks the point of no return,
 * and letting go past it starts the reply in the composer.
 *
 * Leftwards, as Discord does, and not rightwards: a rightward swipe anywhere on the
 * conversation is the shell's way back to the room list, and messages fill the screen. The
 * gesture claims only leftward drags (it fails at once on a rightward one, so the shell gets
 * those) and blocks the shell while it runs; vertical movement fails it so the list scrolls.
 */
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useShellGesture } from '@/shell/SwipeShell';
import { useTheme } from '@/theme';
import { haptics, Icon, withAlpha } from '@/ui';

/** How far to pull before letting go replies. */
export const REPLY_THRESHOLD = 56;
const MAX_PULL = 80;

export function SwipeToReply({ enabled, onReply, children }: { enabled: boolean; onReply: () => void; children: ReactNode }) {
  const theme = useTheme();
  const { pan: shellPan } = useShellGesture();
  const x = useSharedValue(0);
  const armed = useSharedValue(0);

  const gesture = useMemo(() => {
    const tick = () => haptics.selection();
    const g = Gesture.Pan()
      .enabled(enabled)
      .activeOffsetX(-14)
      .failOffsetX(10)
      .failOffsetY([-12, 12])
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
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  icon: { position: 'absolute', top: 0, bottom: 0, right: 16, justifyContent: 'center' },
  bubble: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
