/**
 * Text: the one way to put words on screen.
 *
 * Variants carry the web's type scale (text-xl title, text-base heading, text-sm body,
 * text-xs caption, the 11 px uppercase section label) at phone-friendly sizes, multiplied by
 * the Appearance font scale (`theme.font`). The system's own text size applies on top - RN's
 * `allowFontScaling` stays on - so Dynamic Type / Android font size both work; dense chrome
 * (tags, badges) caps the system multiplier itself rather than turning it off.
 *
 * Colour is a `tone` from the theme, or an explicit `color` for data colours (a role colour on
 * a name). Never a literal.
 */
import { Platform, Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useTheme, type Theme } from '@/theme';

export type TextVariant = 'title' | 'heading' | 'body' | 'label' | 'caption' | 'overline' | 'mono';

export type TextTone =
  | 'default'
  | 'muted'
  | 'primary'
  | 'danger'
  | 'success'
  | 'warning'
  | 'link'
  | 'onPrimary'
  | 'onDanger'
  | 'inherit';

export type TextWeight = 'regular' | 'medium' | 'semibold' | 'bold';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** Explicit colour (role colours and other data); wins over `tone`. */
  color?: string;
  weight?: TextWeight;
  align?: TextStyle['textAlign'];
}

interface VariantSpec {
  size: number;
  lineHeight: number;
  weight: TextWeight;
  tone: TextTone;
  uppercase?: boolean;
  letterSpacing?: number;
  mono?: boolean;
}

const VARIANTS: Record<TextVariant, VariantSpec> = {
  title: { size: 22, lineHeight: 28, weight: 'bold', tone: 'default' },
  heading: { size: 17, lineHeight: 22, weight: 'semibold', tone: 'default' },
  body: { size: 15, lineHeight: 20, weight: 'regular', tone: 'default' },
  label: { size: 14, lineHeight: 18, weight: 'medium', tone: 'default' },
  caption: { size: 12, lineHeight: 16, weight: 'regular', tone: 'muted' },
  overline: { size: 12, lineHeight: 16, weight: 'semibold', tone: 'muted', uppercase: true, letterSpacing: 0.6 },
  mono: { size: 13, lineHeight: 18, weight: 'regular', tone: 'default', mono: true },
};

const WEIGHTS: Record<TextWeight, TextStyle['fontWeight']> = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

export const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

/** The colour a tone resolves to in `theme` (undefined for `inherit`). */
export function toneColor(theme: Theme, tone: TextTone): string | undefined {
  const c = theme.colors;
  switch (tone) {
    case 'default':
      return c.foreground;
    case 'muted':
      return c.mutedForeground;
    case 'primary':
      return c.primary;
    case 'danger':
      return c.destructive;
    case 'success':
      return c.success;
    case 'warning':
      return c.warning;
    case 'link':
      return c.link;
    case 'onPrimary':
      return c.primaryForeground;
    case 'onDanger':
      return c.destructiveForeground;
    case 'inherit':
      return undefined;
  }
}

/** The resolved style of a variant, for components that style a TextInput or similar alike. */
export function textStyle(theme: Theme, variant: TextVariant = 'body', weight?: TextWeight): TextStyle {
  const v = VARIANTS[variant];
  return {
    fontSize: theme.font(v.size),
    lineHeight: theme.font(v.lineHeight),
    fontWeight: WEIGHTS[weight ?? v.weight],
    ...(v.mono ? { fontFamily: MONO_FONT } : null),
    ...(v.uppercase ? { textTransform: 'uppercase' as const } : null),
    ...(v.letterSpacing ? { letterSpacing: v.letterSpacing } : null),
  };
}

export function Text({ variant = 'body', tone, color, weight, align, style, ...rest }: TextProps) {
  const theme = useTheme();
  const v = VARIANTS[variant];
  const resolved = color ?? toneColor(theme, tone ?? v.tone);
  return (
    <RNText
      {...rest}
      style={[textStyle(theme, variant, weight), resolved ? { color: resolved } : null, align ? { textAlign: align } : null, style]}
    />
  );
}
