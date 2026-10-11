/**
 * Icon: Font Awesome 6 (the web's icon set), from the native font in @expo/vector-icons.
 *
 * `name` takes what the web stores and libs hand around - `fa-solid fa-gear`, `fa-crown`,
 * `fa-regular fa-copy` - or a bare FA6 name (`gear`); see icons.ts. Decorative by default
 * (hidden from screen readers): the control around it carries the label. Give it an
 * `accessibilityLabel` when the icon itself is the information.
 *
 * Size is in points at the default font scale and follows the Appearance font scale. The
 * system text size is opt-in (`scaleWithText`): an icon inside a fixed-size button must not
 * outgrow it, an icon inline with a sentence should grow with it.
 */
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { useEffect, type ReactNode } from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '@/theme';
import { parseIcon, type IconStyle } from './icons';
import { toneColor, type TextTone } from './Text';
import { useReduceMotion } from './motion';

export interface IconProps {
  /** `fa-solid fa-gear`, `fa-gear` or `gear`. */
  name: string;
  /** Points at the default font scale. */
  size?: number;
  color?: string;
  tone?: TextTone;
  /** Force a style (otherwise from the string; bare names are solid). */
  iconStyle?: IconStyle;
  /** Spin (also enabled by `fa-spin` in the name). Stays still under reduced motion. */
  spin?: boolean;
  /** Grow with the system text size (inline icons). Off for icons in fixed-size controls. */
  scaleWithText?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<TextStyle>;
  testID?: string;
}

const FALLBACK_GLYPH = 'circle-question';
let glyphs: Record<string, number> | null = null;

/** Whether FA6 Free has this glyph (after parsing and aliasing). */
export function hasIcon(spec: string): boolean {
  glyphs ??= (FontAwesome6.getRawGlyphMap?.() as Record<string, number> | undefined) ?? null;
  if (!glyphs) return true;
  return parseIcon(spec).name in glyphs;
}

export function Icon({
  name,
  size = 16,
  color,
  tone = 'default',
  iconStyle,
  spin,
  scaleWithText = false,
  accessibilityLabel,
  style,
  testID,
}: IconProps) {
  const theme = useTheme();
  const parsed = parseIcon(name);
  const known = hasIcon(parsed.name);
  if (!known && __DEV__) console.warn(`[ui/Icon] unknown Font Awesome glyph "${name}"`);
  const glyph = known ? parsed.name : FALLBACK_GLYPH;
  const st = iconStyle ?? parsed.style;
  const fill = color ?? toneColor(theme, tone) ?? theme.colors.foreground;
  const px = theme.font(size);
  const a11y = accessibilityLabel
    ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel }
    : { accessible: false, importantForAccessibility: 'no' as const, accessibilityElementsHidden: true };

  const icon = (
    <FontAwesome6
      name={glyph}
      size={px}
      color={fill}
      solid={st === 'solid'}
      brand={st === 'brand'}
      allowFontScaling={scaleWithText}
      maxFontSizeMultiplier={scaleWithText ? 1.6 : undefined}
      style={style}
      testID={testID}
      {...a11y}
    />
  );
  if (spin || parsed.spin) return <Spinning>{icon}</Spinning>;
  return icon;
}

function Spinning({ children }: { children: ReactNode }) {
  const reduce = useReduceMotion();
  const rot = useSharedValue(0);
  useEffect(() => {
    if (reduce) {
      cancelAnimation(rot);
      rot.value = 0;
      return;
    }
    rot.value = 0;
    rot.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false);
    return () => cancelAnimation(rot);
  }, [reduce, rot]);
  const animated = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  return <Animated.View style={animated}>{children}</Animated.View>;
}
