/**
 * SegmentedControl: the web's Tabs - a muted track with the chosen segment raised on a card
 * fill - for page tabs (Friends: Online / All / Pending / Blocked) and in-sheet sub-tabs.
 *
 * Segments share the width by default; `scrollable` lets a long set scroll sideways instead
 * of squeezing (and claims horizontal drags from the shell's swipe). Announced as a tab list
 * with the selected tab; a selection tick on change.
 */
import { ScrollView, View, type StyleProp, type ViewStyle } from 'react-native';
import { HorizontalGestureOwner } from '@/shell/SwipeShell';
import { useTheme } from '@/theme';
import { Badge } from './Badge';
import { withAlpha } from './color';
import { haptics } from './haptics';
import { Icon } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

export interface SegmentItem<T extends string> {
  id: T;
  label: string;
  icon?: string;
  disabled?: boolean;
  /** Count shown in the segment (pending requests). */
  badge?: number;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (next: T) => void;
  items: readonly SegmentItem<T>[];
  size?: 'sm' | 'md';
  scrollable?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onChange,
  items,
  size = 'md',
  scrollable,
  accessibilityLabel,
  style,
  testID,
}: SegmentedControlProps<T>) {
  const theme = useTheme();
  const height = size === 'sm' ? 32 : 36;

  const segments = items.map((item) => {
    const selected = item.id === value;
    return (
      <Touchable
        key={item.id}
        testID={testID ? `${testID}-${item.id}` : undefined}
        disabled={item.disabled}
        feedback="opacity"
        onPress={() => {
          if (selected) return;
          haptics.selection();
          onChange(item.id);
        }}
        accessibilityRole="tab"
        accessibilityLabel={item.badge ? `${item.label}, ${item.badge}` : item.label}
        accessibilityState={{ selected, disabled: !!item.disabled }}
        hitSlop={{ top: (44 - height) / 2, bottom: (44 - height) / 2 }}
        style={[
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            height,
            paddingHorizontal: size === 'sm' ? 10 : 14,
            borderRadius: Math.max(4, theme.radii.md - 2),
            opacity: item.disabled ? 0.4 : 1,
          },
          scrollable ? null : { flex: 1 },
          selected
            ? {
                backgroundColor: theme.colors.card,
                shadowColor: '#000',
                shadowOpacity: 0.12,
                shadowRadius: 2,
                shadowOffset: { width: 0, height: 1 },
                elevation: 1,
              }
            : null,
        ]}
      >
        {item.icon ? <Icon name={item.icon} size={size === 'sm' ? 12 : 13} tone={selected ? 'default' : 'muted'} /> : null}
        <Text variant={size === 'sm' ? 'caption' : 'label'} weight="medium" tone={selected ? 'default' : 'muted'} numberOfLines={1}>
          {item.label}
        </Text>
        {item.badge ? <Badge count={item.badge} /> : null}
      </Touchable>
    );
  });

  const track: ViewStyle = {
    flexDirection: 'row',
    gap: 2,
    padding: 2,
    borderRadius: theme.radii.md,
    backgroundColor: withAlpha(theme.colors.muted, 0.4),
  };

  if (scrollable) {
    return (
      <HorizontalGestureOwner>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="tablist"
          accessibilityLabel={accessibilityLabel}
          style={style}
          contentContainerStyle={track}
        >
          {segments}
        </ScrollView>
      </HorizontalGestureOwner>
    );
  }
  return (
    <View accessibilityRole="tablist" accessibilityLabel={accessibilityLabel} style={[track, style]}>
      {segments}
    </View>
  );
}
