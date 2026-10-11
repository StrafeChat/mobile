/**
 * Touchable: Pressable with the app's press feedback, for any custom tappable surface the
 * other primitives do not cover (a message row, a tile, a space icon).
 *
 * Feedback is a fill while the finger is down - the web's hover fill (`accent`) is the
 * nearest thing a touch screen has - or a dim for things that sit on imagery. One look on
 * both platforms; no Android ripple, which would double up with the fill and ignores radii.
 *
 * Accessibility defaults: role `button`, and a disabled state that screen readers announce.
 * The caller still supplies the label.
 */
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';

export type PressFeedback = 'highlight' | 'opacity' | 'none';

export interface TouchableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle> | ((state: { pressed: boolean }) => StyleProp<ViewStyle>);
  feedback?: PressFeedback;
  /** Colour of the pressed fill (`highlight`); defaults to the theme's accent. */
  pressedColor?: string;
}

export function Touchable({
  style,
  feedback = 'highlight',
  pressedColor,
  accessibilityRole = 'button',
  accessibilityState,
  disabled,
  ...rest
}: TouchableProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
      disabled={disabled}
      style={(state) => {
        const base = typeof style === 'function' ? style(state) : style;
        if (!state.pressed || feedback === 'none') return base;
        if (feedback === 'opacity') return [base, { opacity: 0.6 }];
        return [base, { backgroundColor: pressedColor ?? theme.colors.accent }];
      }}
      {...rest}
    />
  );
}
