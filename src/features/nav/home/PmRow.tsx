/**
 * One conversation in the Home list (RoomsBar's ConvItem): avatar with presence (a group icon
 * for groups), name with BOT / OFFICIAL tags and a muted bell, the other person's custom
 * status while they are around, and the unread state - a primary count pill, or for a muted
 * room just a grey dot and no bold name. Long-press for the conversation menu.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { usePmRow } from '@/data';
import { openRoom } from '@/shell/state';
import { useTheme } from '@/theme';
import { Avatar, Badge, BotTag, Icon, OfficialTag, Text, Touchable, UserAvatar, useLongPressActions, withAlpha } from '@/ui';
import { pmMenuEntries } from '../menus';

/**
 * `active`: this conversation is the one on screen. A boolean rather than the open room's id,
 * so switching conversations re-renders (and re-derives) the two rows involved, not all of them.
 */
export const PmRow = memo(function PmRow({ roomId, active }: { roomId: string; active: boolean }) {
  const theme = useTheme();
  const row = usePmRow(roomId, active ? roomId : null);
  const menu = useLongPressActions(() => pmMenuEntries(roomId), { title: row?.name });
  if (!row) return null;
  const unread = row.unread > 0;
  const loud = unread && !row.muted;
  const label = [
    row.name,
    row.subtitle,
    row.muted ? t('room.notify.muted') : null,
    unread ? t('mobile.notifications.unread', { count: row.unread }) : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Touchable
      onPress={() => openRoom(roomId, null)}
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[
        styles.row,
        { borderRadius: theme.radii.md, paddingVertical: Math.max(6, theme.rowPadding - 1) },
        active ? { backgroundColor: withAlpha(theme.colors.primary, 0.15) } : null,
      ]}
      {...menu}
    >
      {row.isGroup ? (
        <View style={[styles.group, { backgroundColor: theme.colors.muted }]}>
          <Icon name="fa-user-group" size={14} tone="muted" />
        </View>
      ) : row.otherUserId ? (
        <UserAvatar userId={row.otherUserId} name={row.name} uri={row.avatar} size="md" ringColor={theme.colors.card} />
      ) : (
        <Avatar name={row.name} uri={row.avatar} size="md" />
      )}
      <View style={styles.text}>
        <View style={styles.titleLine}>
          <Text
            variant="body"
            weight={loud ? 'semibold' : 'medium'}
            tone={loud || active ? 'default' : 'muted'}
            numberOfLines={1}
            style={styles.shrink}
          >
            {row.name}
          </Text>
          <BotTag bot={row.bot} size="xs" />
          <OfficialTag system={row.system} size="xs" />
          {row.muted ? <Icon name="fa-bell-slash" size={11} tone="muted" style={styles.mutedIcon} /> : null}
        </View>
        {row.subtitle ? (
          <Text variant="caption" numberOfLines={1}>
            {row.subtitle}
          </Text>
        ) : null}
      </View>
      {loud ? <Badge count={row.unread} tone="primary" /> : null}
      {unread && row.muted ? <View style={[styles.mutedDot, { backgroundColor: withAlpha(theme.colors.mutedForeground, 0.5) }]} /> : null}
    </Touchable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, paddingHorizontal: 10, marginHorizontal: 8 },
  group: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, minWidth: 0, gap: 1 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  shrink: { flexShrink: 1 },
  mutedIcon: { opacity: 0.7 },
  mutedDot: { width: 8, height: 8, borderRadius: 4 },
});
