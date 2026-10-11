/**
 * Settings rows - the web's settingsRowShell (icon chip, title, description, control) as
 * grouped-list rows, iOS Settings / Android preferences style.
 *
 * The design system's ListRow clips its subtitle to two lines, which is right for a room list
 * and wrong for settings, whose descriptions are the documentation ("Generating a preview
 * sends the link to the server..."). These rows show the whole description and otherwise
 * follow ListRow's metrics (44 pt minimum, density-driven padding, press fill).
 */
import type { ReactNode } from 'react';
import { I18nManager, View, type AccessibilityActionEvent, type AccessibilityActionInfo, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { Icon, Spinner, Text, ToggleVisual, Touchable, haptics, withAlpha } from '@/ui';

export interface SettingItemProps {
  title: string;
  description?: string | null;
  /** Red description (an inline error under the row). */
  error?: string | null;
  icon?: string;
  iconColor?: string;
  leading?: ReactNode;
  /** Current value, muted, at the end. */
  value?: string;
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  destructive?: boolean;
  selected?: boolean;
  checked?: boolean;
  busy?: boolean;
  titleAccessory?: ReactNode;
  accessibilityRole?: 'button' | 'link' | 'switch' | 'radio' | 'checkbox' | 'none';
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** Extra screen-reader actions - how a tappable row exposes a trailing button's action. */
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SettingItem({
  title,
  description,
  error,
  icon,
  iconColor,
  leading,
  value,
  trailing,
  chevron,
  onPress,
  onLongPress,
  disabled,
  destructive,
  selected,
  checked,
  busy,
  titleAccessory,
  accessibilityRole,
  accessibilityLabel,
  accessibilityHint,
  accessibilityActions,
  onAccessibilityAction,
  style,
  testID,
}: SettingItemProps) {
  const theme = useTheme();
  const c = theme.colors;
  const interactive = !!(onPress || onLongPress);
  const fg = destructive ? c.destructive : c.foreground;
  const label = accessibilityLabel ?? [title, value, description, error].filter(Boolean).join(', ');
  const rowStyle: StyleProp<ViewStyle> = [
    {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      minHeight: 48,
      paddingVertical: theme.rowPadding + 4,
      paddingHorizontal: 16,
      opacity: disabled ? 0.5 : 1,
    },
    selected ? { backgroundColor: withAlpha(c.primary, 0.1) } : null,
    style,
  ];
  const content = (
    <>
      {leading ? (
        <View>{leading}</View>
      ) : icon ? (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: theme.radii.md,
            backgroundColor: destructive ? withAlpha(c.destructive, 0.12) : withAlpha(c.muted, 0.9),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={icon} size={14} color={iconColor ?? (destructive ? c.destructive : c.mutedForeground)} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <Text variant="body" weight="medium" color={fg} style={{ flexShrink: 1 }}>
            {title}
          </Text>
          {titleAccessory}
        </View>
        {description ? <Text variant="caption">{description}</Text> : null}
        {error ? (
          <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="body" tone="muted" numberOfLines={1} style={{ maxWidth: '45%' }}>
          {value}
        </Text>
      ) : null}
      {busy ? <Spinner size="small" decorative /> : trailing}
      {selected ? <Icon name="circle-check" size={18} tone="primary" /> : null}
      {chevron ? <Icon name={I18nManager.isRTL ? 'chevron-left' : 'chevron-right'} size={13} tone="muted" /> : null}
    </>
  );

  // A row that is not itself a control: one element for screen readers when it only shows
  // text, or a plain container when it holds its own buttons, so each stays reachable.
  if (!interactive) {
    const grouped = !trailing || busy;
    return (
      <View
        testID={testID}
        accessible={grouped}
        accessibilityLabel={grouped ? label : undefined}
        accessibilityState={grouped ? { disabled: !!disabled, busy: !!busy } : undefined}
        style={rowStyle}
      >
        {content}
      </View>
    );
  }

  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled || busy}
      feedback="highlight"
      pressedColor={destructive ? withAlpha(c.destructive, 0.1) : c.accent}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      accessibilityState={{
        disabled: !!(disabled || busy),
        busy: !!busy,
        ...(selected !== undefined ? { selected } : null),
        ...(checked !== undefined ? { checked } : null),
      }}
      style={rowStyle}
    >
      {content}
    </Touchable>
  );
}

export interface SettingToggleProps extends Omit<SettingItemProps, 'trailing' | 'onPress' | 'chevron' | 'checked' | 'value' | 'accessibilityRole'> {
  value: boolean;
  onValueChange: (next: boolean) => void;
}

/** A row that is one switch: tapping anywhere flips it; announced as a switch. */
export function SettingToggle({ value, onValueChange, disabled, busy, ...rest }: SettingToggleProps) {
  return (
    <SettingItem
      {...rest}
      disabled={disabled}
      busy={busy}
      accessibilityRole="switch"
      checked={value}
      onPress={() => {
        haptics.toggle(!value);
        onValueChange(!value);
      }}
      trailing={<ToggleVisual value={value} disabled={disabled} />}
    />
  );
}

export interface ChoiceOption<T extends string | number> {
  value: T;
  title: string;
  description?: string;
  icon?: string;
  /** Leading node instead of an icon (a flag, a swatch). */
  leading?: ReactNode;
  disabled?: boolean;
}

/**
 * A radio group as rows (the web's radio cards): the chosen one carries a check. Use inside a
 * ListSection; each option is its own row.
 */
export function choiceRows<T extends string | number>(opts: {
  options: readonly ChoiceOption<T>[];
  value: T | null | undefined;
  onChange: (value: T) => void;
  disabled?: boolean;
  testIDPrefix?: string;
}): ReactNode[] {
  return opts.options.map((o) => (
    <SettingItem
      key={String(o.value)}
      testID={opts.testIDPrefix ? `${opts.testIDPrefix}-${o.value}` : undefined}
      title={o.title}
      description={o.description}
      icon={o.icon}
      leading={o.leading}
      selected={o.value === opts.value}
      checked={o.value === opts.value}
      accessibilityRole="radio"
      disabled={opts.disabled || o.disabled}
      onPress={() => {
        if (o.value === opts.value) return;
        haptics.selection();
        opts.onChange(o.value);
      }}
    />
  ));
}

/** A padded card for form fields (inputs, sliders, buttons) inside a section. */
export function FormCard({ children, style, gap = 14 }: { children?: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  const theme = useTheme();
  return (
    <View
      style={[
        {
          marginHorizontal: 12,
          padding: 16,
          gap,
          backgroundColor: theme.colors.card,
          borderRadius: theme.radii.lg,
          borderWidth: 1,
          borderColor: theme.colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** A small section title outside a card (the web's settingsSectionTitle). */
export function SectionTitle({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, minHeight: 36 }}>
      <Text variant="overline" accessibilityRole="header" style={{ flex: 1 }}>
        {title}
      </Text>
      {right}
    </View>
  );
}

/** Explanatory text between sections. */
export function Note({ children, tone = 'muted', style }: { children: ReactNode; tone?: 'muted' | 'danger' | 'warning' | 'default'; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ paddingHorizontal: 20, paddingBottom: 12 }, style]}>
      <Text variant="caption" tone={tone}>
        {children}
      </Text>
    </View>
  );
}

export type PillTone = 'success' | 'warning' | 'danger' | 'primary' | 'muted';

/** A status chip ("Verified", "This device", "Banned"). */
export function StatusPill({ label, tone = 'muted', icon }: { label: string; tone?: PillTone; icon?: string }) {
  const theme = useTheme();
  const c = theme.colors;
  const color = tone === 'success' ? c.success : tone === 'warning' ? c.warning : tone === 'danger' ? c.destructive : tone === 'primary' ? c.primary : c.mutedForeground;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        backgroundColor: withAlpha(color, 0.15),
        alignSelf: 'flex-start',
      }}
    >
      {icon ? <Icon name={icon} size={10} color={color} /> : null}
      <Text variant="caption" weight="semibold" color={color} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </View>
  );
}

/** Centred loading line for a section that is still fetching. */
export function LoadingRow({ label }: { label?: string }) {
  return (
    <View style={{ paddingVertical: 24, alignItems: 'center' }}>
      <Spinner label={label} />
    </View>
  );
}
