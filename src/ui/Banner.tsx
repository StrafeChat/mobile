/**
 * Banner: an inline notice inside a screen - "This room is end-to-end encrypted", "You're
 * offline", "Your key backup isn't set up" - tinted by tone, with an optional action and
 * dismiss. (Transient feedback is a toast; a decision is a Dialog.)
 */
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@web/i18n/t';
import { useTheme, type Theme } from '@/theme';
import { Button } from './Button';
import { withAlpha } from './color';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Text } from './Text';

export type BannerTone = 'info' | 'success' | 'warning' | 'error';

export interface BannerProps {
  tone?: BannerTone;
  title?: string;
  message: string;
  /** Font Awesome; defaults per tone. */
  icon?: string;
  action?: { label: string; onPress: () => void; loading?: boolean };
  onDismiss?: () => void;
  /** Extra content under the message. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function accentFor(theme: Theme, tone: BannerTone): string {
  switch (tone) {
    case 'info':
      return theme.colors.primary;
    case 'success':
      return theme.colors.success;
    case 'warning':
      return theme.colors.warning;
    case 'error':
      return theme.colors.destructive;
  }
}

const ICONS: Record<BannerTone, string> = {
  info: 'circle-info',
  success: 'circle-check',
  warning: 'triangle-exclamation',
  error: 'circle-exclamation',
};

export function Banner({ tone = 'info', title, message, icon, action, onDismiss, children, style, testID }: BannerProps) {
  const theme = useTheme();
  const accent = accentFor(theme, tone);
  return (
    <View
      testID={testID}
      accessibilityRole={tone === 'error' || tone === 'warning' ? 'alert' : 'summary'}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: 12,
          padding: 12,
          borderRadius: theme.radii.lg,
          borderWidth: 1,
          borderColor: withAlpha(accent, 0.35),
          backgroundColor: withAlpha(accent, 0.12),
        },
        style,
      ]}
    >
      <Icon name={icon ?? ICONS[tone]} size={16} color={accent} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 4 }}>
        {title ? <Text variant="label" weight="semibold">{title}</Text> : null}
        <Text variant="body" style={{ fontSize: theme.font(14) }}>
          {message}
        </Text>
        {children}
        {action ? (
          <Button title={action.label} onPress={action.onPress} loading={action.loading} size="sm" variant={tone === 'error' ? 'danger' : 'secondary'} style={{ marginTop: 6 }} />
        ) : null}
      </View>
      {onDismiss ? <IconButton icon="xmark" label={t('mobile.ui.dismiss')} onPress={onDismiss} size="sm" style={{ marginTop: -6, marginEnd: -6 }} /> : null}
    </View>
  );
}
