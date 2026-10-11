/**
 * Discord-style permission override switch: deny / inherit / allow, as three adjacent
 * buttons (the web's TriStateToggle). Red cross, neutral slash, green check; the chosen one
 * is filled. A radio group for screen readers.
 */
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Icon, Touchable, haptics, withAlpha } from '@/ui';

export type TriState = 'deny' | 'neutral' | 'allow';

/** The state of one permission bit in an override's allow/deny masks (deny wins, as on the web). */
export function overrideState(allow: number, deny: number, bit: number): TriState {
  if ((deny & bit) === bit) return 'deny';
  if ((allow & bit) === bit) return 'allow';
  return 'neutral';
}

/** The masks after setting one bit to a state. */
export function applyOverrideState(masks: { allow: number; deny: number }, bit: number, state: TriState): { allow: number; deny: number } {
  return {
    allow: state === 'allow' ? masks.allow | bit : masks.allow & ~bit,
    deny: state === 'deny' ? masks.deny | bit : masks.deny & ~bit,
  };
}

export interface TriStateControlProps {
  value: TriState;
  onChange: (next: TriState) => void;
  disabled?: boolean;
  /** The permission's name, for the accessible labels. */
  name: string;
  testID?: string;
}

export function TriStateControl({ value, onChange, disabled, name, testID }: TriStateControlProps) {
  const theme = useTheme();
  const c = theme.colors;
  const options: { id: TriState; icon: string; color: string; label: string }[] = [
    { id: 'deny', icon: 'xmark', color: c.destructive, label: t('mobile.settings.overrideDeny') },
    { id: 'neutral', icon: 'slash', color: c.mutedForeground, label: t('mobile.settings.overrideInherit') },
    { id: 'allow', icon: 'check', color: c.success, label: t('mobile.settings.overrideAllow') },
  ];
  return (
    <View
      testID={testID}
      accessibilityRole="radiogroup"
      accessibilityLabel={name}
      style={{
        flexDirection: 'row',
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderColor: c.border,
        overflow: 'hidden',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {options.map((o, i) => {
        const on = value === o.id;
        return (
          <Touchable
            key={o.id}
            testID={testID ? `${testID}-${o.id}` : undefined}
            feedback="opacity"
            disabled={disabled}
            onPress={() => {
              if (on) return;
              haptics.selection();
              onChange(o.id);
            }}
            accessibilityRole="radio"
            accessibilityLabel={`${o.label}, ${name}`}
            accessibilityState={{ checked: on, disabled: !!disabled }}
            style={{
              width: 40,
              height: 34,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: on ? (o.id === 'neutral' ? c.muted : withAlpha(o.color, 0.9)) : 'transparent',
              borderStartWidth: i > 0 ? 1 : 0,
              borderStartColor: c.border,
            }}
            hitSlop={{ top: 5, bottom: 5 }}
          >
            <Icon name={o.icon} size={13} color={on && o.id !== 'neutral' ? c.destructiveForeground : o.color} />
          </Touchable>
        );
      })}
    </View>
  );
}
