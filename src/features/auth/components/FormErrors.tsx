/**
 * One or more error lines under a form (the web's FormApiErrors): a red-tinted box, an icon
 * per line, announced to screen readers when it appears.
 */
import { useEffect } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { useTheme } from '@/theme';
import { Icon, Text, withAlpha } from '@/ui';

export function FormErrors({ lines, testID }: { lines: readonly string[]; testID?: string }) {
  const theme = useTheme();
  const shown = lines.filter(Boolean);
  const joined = shown.join('\n');
  useEffect(() => {
    if (joined) AccessibilityInfo.announceForAccessibility?.(joined);
  }, [joined]);
  if (!shown.length) return null;
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: withAlpha(theme.colors.destructive, 0.45),
        backgroundColor: withAlpha(theme.colors.destructive, 0.1),
      }}
    >
      {shown.map((line, i) => (
        <View key={`${i}:${line}`} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
          <Icon name="circle-exclamation" size={13} tone="danger" style={{ marginTop: 3 }} />
          <Text variant="body" tone="danger" style={{ flex: 1, fontSize: theme.font(14) }}>
            {line}
          </Text>
        </View>
      ))}
    </View>
  );
}
