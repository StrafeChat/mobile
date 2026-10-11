/**
 * Skeleton: placeholder shapes while content loads, pulsing like the web's animate-pulse
 * MessageSkeleton. Under reduced motion (app or OS) they hold still - a pulse is exactly the
 * kind of decoration that setting exists to stop.
 *
 * Hidden from screen readers; whatever is loading should say so once (a Spinner label, or a
 * header that reads "Loading…").
 */
import { useEffect } from 'react';
import { View, type DimensionValue, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/theme';
import { withAlpha } from './color';
import { useReduceMotion } from './motion';

export interface SkeletonProps {
  width?: DimensionValue;
  height?: number;
  /** Corner radius; `circle` overrides it. */
  radius?: number;
  circle?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Skeleton({ width = '100%', height = 14, radius, circle, style }: SkeletonProps) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (reduce) {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(withTiming(0.45, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
    return () => cancelAnimation(pulse);
  }, [reduce, pulse]);
  const animated = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const size = circle ? { width: height, height, borderRadius: height / 2 } : { width, height, borderRadius: radius ?? theme.radii.sm };
  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[{ backgroundColor: withAlpha(theme.colors.muted, 0.8) }, size, animated, style]}
    />
  );
}

/** Lines of text: full width, the last one shorter. */
export function SkeletonText({ lines = 2, lastLineWidth = '60%', lineHeight = 12, gap = 8, style }: { lines?: number; lastLineWidth?: DimensionValue; lineHeight?: number; gap?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ gap }, style]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height={lineHeight} width={i === lines - 1 && lines > 1 ? lastLineWidth : '100%'} />
      ))}
    </View>
  );
}

/** A list row placeholder: avatar + two lines (members, PMs, search results). */
export function SkeletonRow({ avatar = 40, style }: { avatar?: number; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 }, style]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Skeleton circle height={avatar} />
      <SkeletonText lines={2} style={{ flex: 1 }} lastLineWidth="45%" />
    </View>
  );
}
