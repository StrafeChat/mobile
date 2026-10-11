/**
 * Spinner: the platform activity indicator in the theme's colours. Announced as "Loading…"
 * (the web's common.loading) unless a more specific label is given; pass `decorative` when a
 * surrounding control already says it is busy (a loading Button).
 */
import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';

export interface SpinnerProps {
  size?: 'small' | 'large';
  color?: string;
  label?: string;
  decorative?: boolean;
  /** Centre in the available space (a loading screen or list footer). */
  fill?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Spinner({ size = 'small', color, label, decorative, fill, style, testID }: SpinnerProps) {
  const theme = useTheme();
  const indicator = (
    <ActivityIndicator
      size={size}
      color={color ?? theme.colors.primary}
      testID={testID}
      {...(decorative
        ? { accessible: false, importantForAccessibility: 'no' as const }
        : { accessible: true, accessibilityRole: 'progressbar' as const, accessibilityLabel: label ?? t('common.loading') })}
    />
  );
  if (!fill) return style ? <View style={style}>{indicator}</View> : indicator;
  return <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }, style]}>{indicator}</View>;
}
