/**
 * EmptyState: the one "nothing here" block - no friends, no pins, no results - as the web's.
 * `page` fills a screen (big icon in a soft circle, heading, body, action); `inline` (default)
 * is the compact dashed frame for a list section.
 */
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { withAlpha } from './color';
import { Icon } from './Icon';
import { Text } from './Text';

export interface EmptyStateProps {
  /** Font Awesome, e.g. `fa-solid fa-user-group`. */
  icon: string;
  title?: string;
  body?: string;
  /** A Button, usually. */
  action?: ReactNode;
  size?: 'page' | 'inline';
  style?: StyleProp<ViewStyle>;
}

export function EmptyState({ icon, title, body, action, size = 'inline', style }: EmptyStateProps) {
  const theme = useTheme();
  if (size === 'page') {
    return (
      <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 8 }, style]}>
        <View
          style={{
            width: 80,
            height: 80,
            borderRadius: 40,
            marginBottom: 12,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: withAlpha(theme.colors.muted, 0.4),
          }}
        >
          <Icon name={icon} size={30} color={withAlpha(theme.colors.mutedForeground, 0.7)} />
        </View>
        {title ? (
          <Text variant="title" align="center" accessibilityRole="header" style={{ fontSize: theme.font(20) }}>
            {title}
          </Text>
        ) : null}
        {body ? (
          <Text variant="body" tone="muted" align="center" style={{ maxWidth: 420 }}>
            {body}
          </Text>
        ) : null}
        {action ? <View style={{ marginTop: 16 }}>{action}</View> : null}
      </View>
    );
  }
  return (
    <View
      style={[
        {
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 28,
          borderRadius: theme.radii.lg,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      <Icon name={icon} size={22} color={withAlpha(theme.colors.mutedForeground, 0.6)} />
      {title ? (
        <Text variant="label" align="center">
          {title}
        </Text>
      ) : null}
      {body ? (
        <Text variant="caption" align="center">
          {body}
        </Text>
      ) : null}
      {action}
    </View>
  );
}
