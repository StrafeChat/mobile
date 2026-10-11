/**
 * Identity tags and role pills - the web's BotTag, OfficialTag and RolePill.
 *
 * BotTag and OfficialTag are identity, not flair: they sit right after a name everywhere it
 * is shown (message header, member row, profile, PM list) so a bot or a system notice is never
 * mistaken for a person. Each renders nothing unless its flag is set, so they can be placed
 * unconditionally - exactly like the web's.
 *
 * RolePill keeps the web's reasoning: the role colour lives on a small dot, not the text,
 * because several pills beside an already-tinted name made a wall of competing colour, and a
 * dark role colour is unreadable as text on a dark theme but fine as a swatch. A colourless
 * role gets a faded grey dot so "no colour" is visible as a state.
 */
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@web/i18n/t';
import { spaceRoleColorHex } from '@web/lib/spacePermissions';
import { useTheme } from '@/theme';
import { withAlpha } from './color';
import { Icon } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';

export type TagSize = 'xs' | 'sm' | 'md';

const TAG: Record<TagSize, { h: number; px: number; font: number }> = {
  xs: { h: 15, px: 5, font: 9.5 },
  sm: { h: 17, px: 6, font: 10.5 },
  md: { h: 19, px: 7, font: 11 },
};

interface TagChipProps {
  label: string;
  a11y: string;
  bg: string;
  fg: string;
  size: TagSize;
  icon?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

function TagChip({ label, a11y, bg, fg, size, icon, style, testID }: TagChipProps) {
  const s = TAG[size];
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={a11y}
      style={[
        {
          marginStart: 6,
          height: s.h,
          paddingHorizontal: s.px,
          borderRadius: 4,
          backgroundColor: bg,
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'center',
          gap: 3,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={s.font * 0.9} color={fg} /> : null}
      <Text
        weight="semibold"
        color={fg}
        allowFontScaling={false}
        style={{ fontSize: s.font, lineHeight: s.font + 2, letterSpacing: 0.2, textTransform: 'uppercase' }}
      >
        {label}
      </Text>
    </View>
  );
}

export interface BotTagProps {
  bot?: boolean | null;
  size?: TagSize;
  style?: StyleProp<ViewStyle>;
}

export function BotTag({ bot, size = 'sm', style }: BotTagProps) {
  const theme = useTheme();
  if (!bot) return null;
  return (
    <TagChip
      testID="bot-tag"
      label={t('badges.botTag')}
      a11y={t('badges.bot')}
      bg={theme.colors.primary}
      fg={theme.colors.primaryForeground}
      size={size}
      style={style}
    />
  );
}

export interface OfficialTagProps {
  /** The account's `system` flag (the instance's official account). */
  system?: boolean | null;
  size?: TagSize;
  style?: StyleProp<ViewStyle>;
}

export function OfficialTag({ system, size = 'sm', style }: OfficialTagProps) {
  const theme = useTheme();
  if (!system) return null;
  return (
    <TagChip
      testID="official-tag"
      label={t('badges.officialTag')}
      a11y={t('badges.official')}
      bg={theme.colors.success}
      fg={theme.colors.primaryForeground}
      size={size}
      icon="circle-check"
      style={style}
    />
  );
}

/** The role shape the web's profile surfaces use (stores/userProfilePopover ProfileRole). */
export interface RolePillRole {
  id?: string;
  name: string;
  /** Packed 0xRRGGBB, 0 / null for "no colour". */
  color?: number | null;
}

export interface RolePillProps {
  role: RolePillRole;
  /** `sm` inline next to a name, `md` in a roles list. */
  size?: 'sm' | 'md';
  /** Renders a remove button (the profile's editable chips). */
  onRemove?: () => void;
  removeLabel?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function RolePill({ role, size = 'md', onRemove, removeLabel, disabled, style }: RolePillProps) {
  const theme = useTheme();
  const sm = size === 'sm';
  const dot = role.color ? spaceRoleColorHex(role.color) : withAlpha(theme.colors.mutedForeground, 0.45);
  return (
    <View
      style={[
        {
          flexDirection: 'row',
          alignItems: 'center',
          alignSelf: 'flex-start',
          maxWidth: '100%',
          gap: sm ? 4 : 6,
          paddingStart: sm ? 8 : 10,
          paddingEnd: onRemove ? 2 : sm ? 8 : 10,
          minHeight: sm ? 20 : 26,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: withAlpha(theme.colors.border, 0.7),
          backgroundColor: withAlpha(theme.colors.background, 0.4),
        },
        style,
      ]}
    >
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: dot }} />
      <Text variant={sm ? 'caption' : 'label'} tone="default" weight="medium" numberOfLines={1} style={{ flexShrink: 1 }}>
        {role.name}
      </Text>
      {onRemove ? (
        <Touchable
          onPress={onRemove}
          disabled={disabled}
          accessibilityLabel={removeLabel ?? role.name}
          hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}
          pressedColor={withAlpha(theme.colors.destructive, 0.15)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            alignItems: 'center',
            justifyContent: 'center',
            opacity: disabled ? 0.3 : 1,
          }}
        >
          <Icon name="xmark" size={10} tone="muted" />
        </Touchable>
      ) : null}
    </View>
  );
}
