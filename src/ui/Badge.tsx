/**
 * Badge: counts and dots, with the web's semantics.
 *
 * - `danger` (the default) is the mention / request badge: a red pill with the count, capped
 *   at 99+ - the web's SpaceBar corner badge and the tab bar's notification count.
 * - `primary` / `muted` are neutral counts (a member total, a filter count).
 * - `dot` with tone `foreground` is the plain unread marker (Discord's white pill on the
 *   rail): "something new", no number.
 *
 * `ringColor` draws a ring in the surface colour so a badge overlapping an avatar or icon
 * reads as cut out of it, as the web's `ring-2 ring-background`.
 *
 * A count of 0 renders nothing, so a badge can be placed unconditionally.
 */
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, type Theme } from '@/theme';
import { Text } from './Text';

export type BadgeTone = 'danger' | 'primary' | 'muted' | 'foreground';

export interface BadgeProps {
  count?: number;
  /** Show a dot instead of a number (a count is then ignored). */
  dot?: boolean;
  tone?: BadgeTone;
  /** Highest number shown before "N+". */
  max?: number;
  /** Surface colour behind the badge, drawn as a ring. */
  ringColor?: string;
  size?: 'sm' | 'md';
  /** What the badge means, for screen readers ("3 mentions"). Defaults to the number. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** `5` -> "5", `150` -> "99+" (with max 99). Negative and fractional counts are clamped. */
export function formatBadgeCount(count: number, max = 99): string {
  const n = Math.max(0, Math.floor(count));
  return n > max ? `${max}+` : String(n);
}

function colours(theme: Theme, tone: BadgeTone): { bg: string; fg: string } {
  const c = theme.colors;
  switch (tone) {
    case 'danger':
      return { bg: c.destructive, fg: c.destructiveForeground };
    case 'primary':
      return { bg: c.primary, fg: c.primaryForeground };
    case 'muted':
      return { bg: c.muted, fg: c.mutedForeground };
    case 'foreground':
      return { bg: c.foreground, fg: c.background };
  }
}

export function Badge({
  count = 0,
  dot = false,
  tone = 'danger',
  max = 99,
  ringColor,
  size = 'sm',
  accessibilityLabel,
  style,
  testID,
}: BadgeProps) {
  const theme = useTheme();
  if (!dot && !(count > 0)) return null;
  const { bg, fg } = colours(theme, tone);
  const ring = ringColor ? { borderWidth: 2, borderColor: ringColor } : null;
  const ringPad = ringColor ? 4 : 0;

  if (dot) {
    const d = (size === 'sm' ? 8 : 10) + ringPad;
    return (
      <View
        testID={testID}
        accessible={!!accessibilityLabel}
        accessibilityLabel={accessibilityLabel}
        style={[{ width: d, height: d, borderRadius: d / 2, backgroundColor: bg }, ring, style]}
      />
    );
  }

  const text = formatBadgeCount(count, max);
  const h = (size === 'sm' ? 16 : 20) + ringPad;
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={accessibilityLabel ?? text}
      style={[
        {
          minWidth: h,
          height: h,
          paddingHorizontal: size === 'sm' ? 4 : 6,
          borderRadius: h / 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        ring,
        style,
      ]}
    >
      <Text
        variant="caption"
        weight="bold"
        color={fg}
        allowFontScaling={false}
        style={{ fontSize: size === 'sm' ? 10 : 12, lineHeight: size === 'sm' ? 12 : 15, fontVariant: ['tabular-nums'] }}
      >
        {text}
      </Text>
    </View>
  );
}
