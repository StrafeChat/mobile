/**
 * Select: a field that shows the current choice and opens an action sheet of the options -
 * the mobile form of the web's dressed native <select>. Same field surface and label as Input.
 *
 * The picker is the shared ActionSheet (via the presenter), so options get the check mark,
 * descriptions, icons and disabled state for free, and only one overlay system exists.
 */
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { haptics } from './haptics';
import { Icon } from './Icon';
import { FieldError, FieldLabel, fieldBoxStyle } from './Input';
import { showActionSheet } from './presenter';
import { Text } from './Text';
import { Touchable } from './Touchable';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  icon?: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  value: T | null | undefined;
  options: readonly SelectOption<T>[];
  onValueChange: (value: T) => void;
  label?: string;
  /** Shown when nothing is chosen. */
  placeholder?: string;
  /** Heading of the picker sheet (defaults to the label). */
  sheetTitle?: string;
  error?: string | null;
  hint?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Select<T extends string = string>({
  value,
  options,
  onValueChange,
  label,
  placeholder,
  sheetTitle,
  error,
  hint,
  disabled,
  style,
  testID,
}: SelectProps<T>) {
  const theme = useTheme();
  const current = options.find((o) => o.value === value);
  const shown = current?.label ?? placeholder ?? t('mobile.ui.choose');

  const open = () => {
    haptics.selection();
    void showActionSheet(
      options.map((o) => ({
        key: o.value,
        label: o.label,
        description: o.description,
        icon: o.icon,
        disabled: o.disabled,
        selected: o.value === value,
        onSelect: () => {
          if (o.value !== value) onValueChange(o.value);
        },
      })),
      { title: sheetTitle ?? label },
    );
  };

  return (
    <View style={[{ gap: 6, alignSelf: 'stretch' }, style]}>
      {label ? <FieldLabel label={label} /> : null}
      <Touchable
        testID={testID}
        onPress={open}
        disabled={disabled}
        feedback="opacity"
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}, ${shown}` : shown}
        accessibilityHint={error ?? hint}
        style={[
          { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12 },
          fieldBoxStyle(theme, { error: !!error, disabled }),
        ]}
      >
        {current?.icon ? <Icon name={current.icon} size={14} tone="muted" /> : null}
        <Text variant="body" tone={current ? 'default' : 'muted'} numberOfLines={1} style={{ flex: 1 }}>
          {shown}
        </Text>
        <Icon name="chevron-down" size={11} tone="muted" />
      </Touchable>
      {error ? <FieldError message={error} /> : hint ? <Text variant="caption">{hint}</Text> : null}
    </View>
  );
}
