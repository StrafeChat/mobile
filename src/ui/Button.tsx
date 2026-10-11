/**
 * Button: the web's Button (primary / secondary / outline / ghost / destructive) at touch
 * sizes, plus `link` for inline text actions.
 *
 * `loading` keeps the button's size (the label stays, a spinner joins it), disables presses
 * and tells screen readers it is busy - a double tap on "Send" while the request runs is the
 * bug it exists to prevent. `danger` is the mobile name for the web's `destructive`; both are
 * accepted.
 *
 * Every size is at least 44 pt tall to the finger: `sm` draws at 36 and extends its hit area.
 */
import { View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme, type Theme } from '@/theme';
import { withAlpha } from './color';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import { Text } from './Text';
import { Touchable } from './Touchable';
import { hitSlopFor } from './tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'destructive' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  /** The label. Required: it is also the accessible name. */
  title: string;
  onPress?: (e: GestureResponderEvent) => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /** Leading icon (`fa-solid fa-plus` / `plus`). */
  icon?: string;
  /** Trailing icon. */
  iconRight?: string;
  /** Stretch to the container's width. */
  fullWidth?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const HEIGHT: Record<ButtonSize, number> = { sm: 36, md: 44, lg: 50 };
const PAD_X: Record<ButtonSize, number> = { sm: 12, md: 16, lg: 22 };
const FONT: Record<ButtonSize, number> = { sm: 14, md: 15, lg: 16 };

interface Palette {
  bg: string;
  fg: string;
  pressed: string;
  border?: string;
}

function palette(theme: Theme, variant: ButtonVariant): Palette {
  const c = theme.colors;
  switch (variant) {
    case 'primary':
      return { bg: c.primary, fg: c.primaryForeground, pressed: c.primaryHover };
    case 'secondary':
      return { bg: c.secondary, fg: c.secondaryForeground, pressed: withAlpha(c.secondary, 0.8) };
    case 'outline':
      return { bg: withAlpha(c.card, 0.55), fg: c.foreground, pressed: c.accent, border: c.border };
    case 'ghost':
      return { bg: 'transparent', fg: c.foreground, pressed: c.accent };
    case 'danger':
    case 'destructive':
      return { bg: c.destructive, fg: c.destructiveForeground, pressed: withAlpha(c.destructive, 0.85) };
    case 'link':
      return { bg: 'transparent', fg: c.link, pressed: 'transparent' };
  }
}

export function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  iconRight,
  fullWidth,
  accessibilityLabel,
  accessibilityHint,
  style,
  testID,
}: ButtonProps) {
  const theme = useTheme();
  const p = palette(theme, variant);
  const inert = disabled || loading;
  const isLink = variant === 'link';
  const height = isLink ? undefined : HEIGHT[size];
  const fontSize = FONT[size];

  return (
    <Touchable
      testID={testID}
      onPress={inert ? undefined : onPress}
      disabled={inert}
      feedback={isLink ? 'opacity' : 'highlight'}
      pressedColor={p.pressed}
      hitSlop={hitSlopFor(isLink ? 0 : 44, height ?? 20)}
      accessibilityRole={isLink ? 'link' : 'button'}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inert, busy: loading }}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          borderRadius: theme.radii.md,
          backgroundColor: p.bg,
          opacity: disabled ? 0.5 : 1,
        },
        isLink ? { paddingVertical: 2 } : { minHeight: height, paddingHorizontal: PAD_X[size] },
        p.border ? { borderWidth: 1, borderColor: p.border } : null,
        fullWidth ? { alignSelf: 'stretch' } : { alignSelf: 'flex-start' },
        style,
      ]}
    >
      {loading ? <Spinner size="small" color={p.fg} decorative /> : icon ? <Icon name={icon} size={fontSize} color={p.fg} /> : null}
      <View style={{ flexShrink: 1 }}>
        <Text
          variant="label"
          weight={isLink ? 'medium' : 'semibold'}
          color={p.fg}
          numberOfLines={1}
          maxFontSizeMultiplier={1.6}
          style={[{ fontSize: theme.font(fontSize) }, isLink ? { textDecorationLine: 'underline' } : null]}
        >
          {title}
        </Text>
      </View>
      {iconRight && !loading ? <Icon name={iconRight} size={fontSize - 2} color={p.fg} /> : null}
    </Touchable>
  );
}
