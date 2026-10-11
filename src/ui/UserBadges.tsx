/**
 * UserBadges: the row of profile badges from a user's `public_flags`, via the web's
 * lib/badges (which bit is which badge, its icon and accent) - the same row as the web's.
 *
 * The web names each badge in a hover tooltip; here a tap shows its name in a toast, and each
 * badge is labelled for screen readers. `max` folds the rest into a "+N" chip (tap lists
 * them), so a heavily-badged account never pushes the name off its line. The BOT tag is not a
 * badge - that is BotTag, placed right after the name.
 */
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { badgesFor } from '@web/lib/badges';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { withAlpha } from './color';
import { Icon } from './Icon';
import { Text } from './Text';
import { Touchable } from './Touchable';
import { toast } from './toast';

export interface UserBadgesProps {
  /** The user's badge bitfield (public_flags). */
  flags?: number | null;
  /** Icon size in points. */
  size?: number;
  /** Show at most this many; the rest fold into "+N". */
  max?: number;
  /** Tap a badge to see its name (default on). */
  interactive?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function UserBadges({ flags, size = 15, max, interactive = true, style }: UserBadgesProps) {
  const theme = useTheme();
  const all = badgesFor(flags ?? undefined);
  if (all.length === 0) return null;
  const shown = max != null && all.length > max ? all.slice(0, max) : all;
  const folded = max != null && all.length > max ? all.slice(max) : [];
  const chip = {
    minHeight: size + 6,
    minWidth: size + 8,
    paddingHorizontal: 4,
    borderRadius: 5,
    backgroundColor: withAlpha(theme.colors.muted, 0.5),
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  };
  const foldedLabel = folded.map((b) => t(`badges.${b.id}`)).join(', ');

  return (
    <View style={[{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4 }, style]}>
      {shown.map((b) => {
        const label = t(`badges.${b.id}`);
        return (
          <Touchable
            key={b.id}
            disabled={!interactive}
            onPress={() => toast({ message: label, icon: `fa-solid ${b.icon}` })}
            accessibilityRole="image"
            accessibilityLabel={label}
            hitSlop={6}
            feedback="opacity"
            style={chip}
          >
            {/* The badge's accent is data from lib/badges, recognised by colour + shape. */}
            <Icon name={b.icon} size={size} color={b.color} />
          </Touchable>
        );
      })}
      {folded.length > 0 ? (
        <Touchable
          disabled={!interactive}
          onPress={() => toast({ message: foldedLabel })}
          accessibilityRole="image"
          accessibilityLabel={foldedLabel}
          hitSlop={6}
          feedback="opacity"
          style={[chip, { backgroundColor: withAlpha(theme.colors.muted, 0.6) }]}
        >
          <Text variant="caption" weight="semibold" allowFontScaling={false} style={{ fontVariant: ['tabular-nums'] }}>
            +{folded.length}
          </Text>
        </Touchable>
      ) : null}
    </View>
  );
}
