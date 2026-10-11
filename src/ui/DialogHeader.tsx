/**
 * The header shared by sheets and dialogs - the web ResponsiveDialog's: an optional icon chip
 * tinted by tone (default brand, warning amber, danger red), the title, and a muted
 * description. `centered` stacks it (icon above title), as the web's confirm prompts are.
 */
import { View } from 'react-native';
import { useTheme, type Theme } from '@/theme';
import { withAlpha } from './color';
import { Icon } from './Icon';
import { Text } from './Text';
import type { DialogTone } from './presenter';

export function toneAccent(theme: Theme, tone: DialogTone = 'default'): string {
  if (tone === 'danger') return theme.colors.destructive;
  if (tone === 'warning') return theme.colors.warning;
  return theme.colors.primary;
}

export interface DialogHeaderProps {
  title?: string;
  description?: string;
  icon?: string;
  tone?: DialogTone;
  centered?: boolean;
  /** Room on the trailing side for a close button. */
  endInset?: number;
}

export function DialogHeader({ title, description, icon, tone = 'default', centered, endInset = 0 }: DialogHeaderProps) {
  const theme = useTheme();
  if (!title && !description && !icon) return null;
  const accent = toneAccent(theme, tone);
  const chip = centered ? 48 : 40;
  return (
    <View
      style={[
        { marginBottom: 16, paddingEnd: endInset },
        centered ? { alignItems: 'center' } : { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
      ]}
    >
      {icon ? (
        <View
          style={{
            width: chip,
            height: chip,
            borderRadius: chip / 2,
            backgroundColor: withAlpha(accent, 0.15),
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: centered ? 12 : 0,
          }}
        >
          <Icon name={icon} size={centered ? 20 : 16} color={accent} />
        </View>
      ) : null}
      <View style={[{ flexShrink: 1, gap: 4 }, centered ? { alignItems: 'center' } : { flex: 1 }]}>
        {title ? (
          <Text variant="heading" accessibilityRole="header" align={centered ? 'center' : undefined} style={{ fontSize: theme.font(18), lineHeight: theme.font(24) }}>
            {title}
          </Text>
        ) : null}
        {description ? (
          <Text variant="body" tone="muted" align={centered ? 'center' : undefined} style={{ fontSize: theme.font(14) }}>
            {description}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
