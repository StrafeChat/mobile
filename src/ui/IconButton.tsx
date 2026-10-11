/**
 * IconButton: the web's square icon-only button (toolbar, header and row actions) with the
 * same tones - default, subtle, danger, overlay (over imagery) - plus `primary` for a filled
 * accent action. `label` is required: an icon alone says nothing to a screen reader, and the
 * web's hover tooltip does not exist here.
 *
 * `active` is the toggle state (a mute button): rendered pressed and announced as selected.
 * Visual sizes are the web's (28 / 32 / 36) at phone scale; the touch area is always 44.
 */
import type { GestureResponderEvent, StyleProp, ViewStyle } from 'react-native';
import { View } from 'react-native';
import { useTheme, type Theme } from '@/theme';
import { onScrim, withAlpha } from './color';
import { Icon } from './Icon';
import { Touchable } from './Touchable';
import { hitSlopFor } from './tokens';
import { Badge } from './Badge';

export type IconButtonTone = 'default' | 'subtle' | 'danger' | 'overlay' | 'primary';
export type IconButtonSize = 'sm' | 'md' | 'lg';

export interface IconButtonProps {
  /** `fa-solid fa-gear` / `gear`. */
  icon: string;
  /** Accessible name. Required. */
  label: string;
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  size?: IconButtonSize;
  tone?: IconButtonTone;
  /** Toggle state (renders pressed, announced as selected). */
  active?: boolean;
  disabled?: boolean;
  /** Small count badge on the corner (unread, requests). */
  badge?: number;
  /** Override the icon colour. */
  color?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const BOX: Record<IconButtonSize, number> = { sm: 32, md: 36, lg: 44 };
const GLYPH: Record<IconButtonSize, number> = { sm: 14, md: 17, lg: 20 };

function colours(theme: Theme, tone: IconButtonTone, active: boolean) {
  const c = theme.colors;
  if (active) return { fg: c.accentForeground, bg: c.accent, pressed: withAlpha(c.accent, 0.7) };
  switch (tone) {
    case 'default':
      return { fg: c.mutedForeground, bg: 'transparent', pressed: c.accent };
    case 'subtle':
      return { fg: withAlpha(c.mutedForeground, 0.6), bg: 'transparent', pressed: c.accent };
    case 'danger':
      return { fg: c.destructive, bg: 'transparent', pressed: withAlpha(c.destructive, 0.12) };
    case 'primary':
      return { fg: c.primaryForeground, bg: c.primary, pressed: c.primaryHover };
    case 'overlay':
      // Over photos and banners: a dark disc, whatever the theme (as the web's bg-black/45).
      return { fg: onScrim(theme), bg: 'rgba(0,0,0,0.45)', pressed: 'rgba(0,0,0,0.65)' };
  }
}

export function IconButton({
  icon,
  label,
  onPress,
  onLongPress,
  size = 'md',
  tone = 'default',
  active,
  disabled,
  badge,
  color,
  accessibilityHint,
  style,
  testID,
}: IconButtonProps) {
  const theme = useTheme();
  const box = BOX[size];
  const col = colours(theme, tone, !!active);
  const round = tone === 'overlay' || tone === 'primary';
  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      pressedColor={col.pressed}
      hitSlop={hitSlopFor(box)}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={active !== undefined ? { selected: active, disabled: !!disabled } : { disabled: !!disabled }}
      style={[
        {
          width: box,
          height: box,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: round ? box / 2 : theme.radii.md,
          backgroundColor: col.bg,
          opacity: disabled ? 0.5 : 1,
        },
        style,
      ]}
    >
      <Icon name={icon} size={GLYPH[size]} color={color ?? col.fg} />
      {badge && badge > 0 ? (
        <View style={{ position: 'absolute', top: -4, right: -4 }} pointerEvents="none">
          <Badge count={badge} tone="danger" ringColor={theme.colors.card} />
        </View>
      ) : null}
    </Touchable>
  );
}
