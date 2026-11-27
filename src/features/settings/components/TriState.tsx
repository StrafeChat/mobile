/**
 * Discord-style permission override switch: deny / inherit / allow, as three adjacent
 * buttons (the web's TriStateToggle). Red cross, neutral slash, green check; the chosen one
 * is filled. A radio group for screen readers.
 */
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { hasPerm, togglePerm, type PermInput } from '@web/lib/permBits';
import { useTheme } from '@/theme';
import { Icon, Touchable, haptics, withAlpha } from '@/ui';

export type TriState = 'deny' | 'neutral' | 'allow';

/** The state of one permission bit in an override's allow/deny masks (deny wins, as on the
 * web). Through permBits: bits 31 and up (Manage Webhooks, Masquerade) need BigInt maths. */
export function overrideState(allow: PermInput, deny: PermInput, bit: number): TriState {
  if (hasPerm(deny, bit)) return 'deny';
  if (hasPerm(allow, bit)) return 'allow';
  return 'neutral';
}

/** The masks after setting one bit to a state. Never negative, whatever the bit. */
export function applyOverrideState(masks: { allow: PermInput; deny: PermInput }, bit: number, state: TriState): { allow: number; deny: number } {
  return {
    allow: togglePerm(masks.allow, bit, state === 'allow'),
    deny: togglePerm(masks.deny, bit, state === 'deny'),
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
