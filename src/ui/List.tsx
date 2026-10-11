/**
 * List primitives - every settings page, room list, member list and picker is built from
 * these, so rows share one height rhythm, press fill and selected state.
 *
 * - `ListRow`: icon/avatar, title, subtitle, and a trailing value, badge, chevron or custom
 *   node. Vertical padding follows the Appearance UI density (`theme.rowPadding`), like the
 *   web's --density-row-py; never shorter than 44 pt. `selected` is the web's active row
 *   (brand tint + ring), `destructive` paints it red.
 * - `ToggleRow`: a ListRow whose trailing control is a switch and whose whole row toggles - one
 *   focus stop, announced as a switch.
 * - `ListHeader`: the web's small uppercase section label (appSectionLabel), optionally
 *   collapsible (room-list Sections) and with an action button (the "+" beside "Private
 *   Messages").
 * - `ListSection`: header + rows grouped on a card with hairlines between them + footer note.
 *
 * Long-press menus: spread `useLongPressActions(...)` onto a ListRow.
 */
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { I18nManager, View, type AccessibilityActionEvent, type AccessibilityActionInfo, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/theme';
import { Badge } from './Badge';
import { withAlpha } from './color';
import { Divider } from './Divider';
import { haptics } from './haptics';
import { Icon } from './Icon';
import { IconButton } from './IconButton';
import { Text } from './Text';
import { ToggleVisual } from './Toggle';
import { Touchable } from './Touchable';

export interface ListRowProps {
  title: string;
  subtitle?: string;
  /** Font Awesome icon at the start. */
  icon?: string;
  iconColor?: string;
  /** Replaces the icon: an avatar, a space icon, a colour swatch. */
  leading?: ReactNode;
  /** Muted text at the end (the current value of a setting). */
  value?: string;
  /** Count badge at the end (mention style). */
  badge?: number;
  /** Anything else at the end (a toggle, a button). */
  trailing?: ReactNode;
  /** Navigation chevron at the end. */
  chevron?: boolean;
  selected?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  /** Bold title (an unread room). */
  emphasized?: boolean;
  /** Checked state, announced for switch / checkbox / radio rows. */
  checked?: boolean | 'mixed';
  titleColor?: string;
  titleNumberOfLines?: number;
  /** Slot beside the title (BotTag, OfficialTag, a lock icon). */
  titleAccessory?: ReactNode;
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  delayLongPress?: number;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: 'button' | 'link' | 'switch' | 'checkbox' | 'radio' | 'menuitem' | 'tab' | 'none';
  /** Rounded inset row (lists on the rails) instead of edge-to-edge (inside a ListSection). */
  inset?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ListRow({
  title,
  subtitle,
  icon,
  iconColor,
  leading,
  value,
  badge,
  trailing,
  chevron,
  selected,
  destructive,
  disabled,
  emphasized,
  checked,
  titleColor,
  titleNumberOfLines = 1,
  titleAccessory,
  onPress,
  onLongPress,
  delayLongPress,
  accessibilityActions,
  onAccessibilityAction,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole,
  inset,
  style,
  testID,
}: ListRowProps) {
  const theme = useTheme();
  const c = theme.colors;
  const fg = titleColor ?? (destructive ? c.destructive : c.foreground);
  const interactive = !!(onPress || onLongPress);
  const label = accessibilityLabel ?? [title, subtitle, value].filter(Boolean).join(', ');

  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      disabled={disabled}
      feedback={interactive ? 'highlight' : 'none'}
      pressedColor={destructive ? withAlpha(c.destructive, 0.1) : c.accent}
      accessibilityRole={accessibilityRole ?? (interactive ? 'button' : 'none')}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        disabled: !!disabled,
        ...(selected !== undefined ? { selected } : null),
        ...(checked !== undefined ? { checked } : null),
      }}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 44,
          paddingVertical: theme.rowPadding + 2,
          paddingHorizontal: inset ? 10 : 16,
          opacity: disabled ? 0.5 : 1,
        },
        inset ? { borderRadius: theme.radii.md } : null,
        selected
          ? { backgroundColor: withAlpha(c.primary, 0.15), borderWidth: 1, borderColor: withAlpha(c.primary, 0.2) }
          : inset
            ? { borderWidth: 1, borderColor: 'transparent' }
            : null,
        style,
      ]}
    >
      {leading ? (
        <View>{leading}</View>
      ) : icon ? (
        <View style={{ width: 24, alignItems: 'center' }}>
          <Icon name={icon} size={17} color={iconColor ?? (destructive ? c.destructive : c.mutedForeground)} />
        </View>
      ) : null}
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
          <Text
            variant="body"
            weight={emphasized || selected ? 'semibold' : 'medium'}
            color={fg}
            numberOfLines={titleNumberOfLines}
            style={{ flexShrink: 1 }}
          >
            {title}
          </Text>
          {titleAccessory}
        </View>
        {subtitle ? (
          <Text variant="caption" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="body" tone="muted" numberOfLines={1} style={{ maxWidth: '45%' }}>
          {value}
        </Text>
      ) : null}
      {badge ? <Badge count={badge} /> : null}
      {trailing}
      {chevron ? <Icon name={I18nManager.isRTL ? 'chevron-left' : 'chevron-right'} size={13} tone="muted" /> : null}
    </Touchable>
  );
}

export interface ToggleRowProps extends Omit<ListRowProps, 'trailing' | 'chevron' | 'onPress' | 'value' | 'accessibilityRole' | 'checked'> {
  value: boolean;
  onValueChange: (next: boolean) => void;
}

export function ToggleRow({ value, onValueChange, disabled, ...rest }: ToggleRowProps) {
  return (
    <ListRow
      {...rest}
      disabled={disabled}
      accessibilityRole="switch"
      onPress={() => {
        haptics.toggle(!value);
        onValueChange(!value);
      }}
      checked={value}
      trailing={<ToggleVisual value={value} disabled={disabled} />}
    />
  );
}

export interface ListHeaderProps {
  title: string;
  /** A trailing icon action ("+" to create). */
  action?: { icon: string; label: string; onPress: () => void };
  /** Anything else at the end. */
  trailing?: ReactNode;
  /** Collapsible section: tapping the header toggles it. */
  collapsed?: boolean;
  onToggle?: () => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (e: AccessibilityActionEvent) => void;
  style?: StyleProp<ViewStyle>;
}

export function ListHeader({ title, action, trailing, collapsed, onToggle, onLongPress, accessibilityActions, onAccessibilityAction, style }: ListHeaderProps) {
  const collapsible = !!onToggle;
  const label = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
      {collapsible ? (
        <Icon
          name="chevron-down"
          size={9}
          tone="muted"
          style={{ transform: [{ rotate: collapsed ? (I18nManager.isRTL ? '90deg' : '-90deg') : '0deg' }] }}
        />
      ) : null}
      <Text variant="overline" numberOfLines={1} style={{ flexShrink: 1 }}>
        {title}
      </Text>
    </View>
  );
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', minHeight: 36, paddingStart: 16, paddingEnd: action ? 6 : 16, paddingTop: 8 }, style]}>
      {collapsible || onLongPress ? (
        <Touchable
          feedback="opacity"
          onPress={onToggle}
          onLongPress={onLongPress}
          accessibilityRole="button"
          accessibilityLabel={title}
          accessibilityState={collapsible ? { expanded: !collapsed } : undefined}
          accessibilityActions={accessibilityActions}
          onAccessibilityAction={onAccessibilityAction}
          hitSlop={{ top: 6, bottom: 6 }}
          style={{ flex: 1, minHeight: 32, justifyContent: 'center' }}
        >
          {label}
        </Touchable>
      ) : (
        <View accessible accessibilityRole="header" style={{ flex: 1 }}>
          {label}
        </View>
      )}
      {trailing}
      {action ? <IconButton icon={action.icon} label={action.label} onPress={action.onPress} size="sm" tone="subtle" /> : null}
    </View>
  );
}

export interface ListSectionProps {
  title?: string;
  footer?: string;
  /** Header action ("+"). */
  action?: ListHeaderProps['action'];
  /** Group the rows on a card (default). Off for a plain list under a header. */
  card?: boolean;
  /** Hairline indent between rows (aligns with titles after icons). */
  dividerInset?: number;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function ListSection({ title, footer, action, card = true, dividerInset = 0, children, style }: ListSectionProps) {
  const theme = useTheme();
  const rows = flatten(children);
  return (
    <View style={[{ marginBottom: 16 }, style]}>
      {title ? <ListHeader title={title} action={action} style={{ paddingBottom: 6 }} /> : null}
      <View
        style={
          card
            ? {
                marginHorizontal: 12,
                backgroundColor: theme.colors.card,
                borderRadius: theme.radii.lg,
                borderWidth: 1,
                borderColor: theme.colors.border,
                overflow: 'hidden',
              }
            : undefined
        }
      >
        {rows.map((row, i) => (
          <Fragment key={isValidElement(row) && row.key != null ? row.key : i}>
            {i > 0 && card ? <Divider inset={dividerInset} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
      {footer ? (
        <Text variant="caption" style={{ paddingHorizontal: 24, paddingTop: 6 }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

/** Children as a flat list, fragments opened and empty slots dropped (`cond && <Row/>`). */
function flatten(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  Children.forEach(children, (child) => {
    if (child === null || child === undefined || typeof child === 'boolean') return;
    if (isValidElement(child) && child.type === Fragment) {
      out.push(...flatten((child.props as { children?: ReactNode }).children));
      return;
    }
    out.push(child);
  });
  return out;
}
