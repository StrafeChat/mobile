/**
 * Toggle (also exported as Switch): the web's on/off switch - a rectangular track following
 * the corner style, not an iOS pill - so a setting looks the same on both clients.
 *
 * The thumb slides (instantly under reduced motion); flipping it plays the toggle haptic.
 * Announced as a switch with its checked state. 44 x 24 drawn, 44 x 44 to the finger.
 * In a settings list prefer `ToggleRow` (List.tsx): the whole row toggles and is one focus
 * stop for screen readers.
 */
import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/theme';
import { haptics } from './haptics';
import { useReduceMotion } from './motion';
import { Touchable } from './Touchable';
import { hitSlopFor } from './tokens';

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  /** Accessible name; omit only when a labelled row around it is the control. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const W = 44;
const H = 24;
const THUMB = 20;

/** The visual switch with no press handling, for rows that own the press. */
export function ToggleVisual({ value, disabled }: { value: boolean; disabled?: boolean }) {
  const theme = useTheme();
  const reduce = useReduceMotion();
  const p = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    p.value = reduce ? (value ? 1 : 0) : withTiming(value ? 1 : 0, { duration: 160 });
  }, [value, reduce, p]);

  const on = theme.colors.primary;
  const off = theme.colors.muted;
  const onBorder = theme.colors.primary;
  const offBorder = theme.colors.input;
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(p.value, [0, 1], [off, on]),
    borderColor: interpolateColor(p.value, [0, 1], [offBorder, onBorder]),
  }));
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: 1 + p.value * (W - THUMB - 4) }] }));
  const radius = Math.min(theme.radii.sm, 8);

  return (
    <Animated.View
      style={[
        { width: W, height: H, borderRadius: radius, borderWidth: 1, justifyContent: 'center', opacity: disabled ? 0.5 : 1 },
        track,
      ]}
    >
      <Animated.View
        style={[
          {
            width: THUMB,
            height: THUMB,
            borderRadius: Math.max(2, radius - 2),
            // The web's white thumb, from the theme: its lightest surface.
            backgroundColor: theme.dark ? theme.colors.foreground : theme.colors.card,
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 2,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
          },
          thumb,
        ]}
      />
    </Animated.View>
  );
}

export function Toggle({ value, onValueChange, disabled, accessibilityLabel, style, testID }: ToggleProps) {
  return (
    <Touchable
      testID={testID}
      feedback="none"
      disabled={disabled}
      onPress={() => {
        haptics.toggle(!value);
        onValueChange(!value);
      }}
      hitSlop={hitSlopFor(W, H)}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      style={style}
    >
      <ToggleVisual value={value} disabled={disabled} />
    </Touchable>
  );
}

export { Toggle as Switch };
