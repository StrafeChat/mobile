/**
 * Checkbox: a brand-tinted box with an optional label and description beside it, the whole
 * line tappable - the web's Checkbox. For a single on/off setting prefer Toggle; a checkbox is
 * for choosing several things from a list (permissions, people to add).
 */
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { withAlpha } from './color';
import { haptics } from './haptics';
import { Icon } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

export interface CheckboxProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  /** Accessible name when there is no visible label. */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const BOX = 20;

export function Checkbox({ checked, onChange, label, description, disabled, accessibilityLabel, style, testID }: CheckboxProps) {
  const theme = useTheme();
  return (
    <Touchable
      testID={testID}
      feedback="opacity"
      disabled={disabled}
      onPress={() => {
        haptics.selection();
        onChange(!checked);
      }}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? (description ? `${label}, ${description}` : label)}
      accessibilityState={{ checked, disabled: !!disabled }}
      hitSlop={label ? 6 : 12}
      style={[{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, minHeight: label ? 44 : BOX, paddingVertical: label ? 10 : 0, opacity: disabled ? 0.6 : 1 }, style]}
    >
      <View
        style={{
          width: BOX,
          height: BOX,
          borderRadius: Math.min(theme.radii.sm, 6) - 1,
          borderWidth: checked ? 0 : 1.5,
          // Darker than the web's input border: an unchecked box needs 3:1 against the surface.
          borderColor: withAlpha(theme.colors.mutedForeground, 0.7),
          backgroundColor: checked ? theme.colors.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <Icon name="check" size={12} color={theme.colors.primaryForeground} /> : null}
      </View>
      {label ? (
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="body">{label}</Text>
          {description ? <Text variant="caption">{description}</Text> : null}
        </View>
      ) : null}
    </Touchable>
  );
}
