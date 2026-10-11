/**
 * A joined (or open) thread nested under its room (SpaceThreadRow): a comments glyph, the
 * name, a lock when locked, a bell-slash when muted, and a mention pill unless it is the one
 * on screen. Unread or mentions (not open, not muted) bold the name and light the edge pip.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { useThreadRow } from '@/data';
import { openRoom } from '@/shell/state';
import { useTheme } from '@/theme';
import { Badge, Icon, Text, Touchable, useLongPressActions, withAlpha } from '@/ui';
import { threadMenuEntries } from '../menus';

export const ThreadRow = memo(function ThreadRow({
  spaceId,
  roomId,
  activeRoomId,
}: {
  spaceId: string;
  roomId: string;
  activeRoomId: string | null;
}) {
  const theme = useTheme();
  const row = useThreadRow(spaceId, roomId, activeRoomId);
  const name = row?.name || t('space.unnamed');
  const menu = useLongPressActions(() => threadMenuEntries(spaceId, roomId), { title: name });
  if (!row) return null;
  const active = activeRoomId === roomId;
  const fg = row.highlight || active ? theme.colors.foreground : theme.colors.mutedForeground;
  const label = [
    name,
    row.locked ? t('mobile.nav.threadLocked') : null,
    row.muted ? t('room.notify.muted') : null,
    row.showMentionBadge ? t('mobile.notifications.mentioned', { count: row.mentions }) : null,
    row.highlight && !row.showMentionBadge ? t('mobile.nav.unread') : null,
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <View style={styles.wrap}>
      {row.highlight ? <View style={[styles.pip, { backgroundColor: theme.colors.foreground }]} /> : null}
      <Touchable
        onPress={() => openRoom(roomId, spaceId)}
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        style={[
          styles.row,
          { borderRadius: theme.radii.md },
          active ? { backgroundColor: withAlpha(theme.colors.primary, 0.15) } : null,
        ]}
        {...menu}
      >
        <View style={[styles.branch, { borderColor: withAlpha(theme.colors.border, 0.9) }]} />
        <Icon name="fa-comments" size={12} color={fg} />
        <Text variant="label" weight={row.highlight || active ? 'semibold' : 'regular'} color={fg} numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        {row.locked ? <Icon name="fa-lock" size={10} tone="muted" /> : null}
        {row.muted ? <Icon name="fa-bell-slash" size={10} tone="muted" style={styles.dim} /> : null}
        {row.showMentionBadge ? <Badge count={row.mentions} tone="primary" /> : null}
      </Touchable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { paddingStart: 26, paddingEnd: 8, justifyContent: 'center' },
  pip: { position: 'absolute', start: 0, width: 4, height: 8, borderTopEndRadius: 4, borderBottomEndRadius: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 44, paddingHorizontal: 8 },
  branch: { width: 8, height: 12, borderStartWidth: 1.5, borderBottomWidth: 1.5, borderBottomStartRadius: 6, marginTop: -8 },
  name: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.7 },
});
