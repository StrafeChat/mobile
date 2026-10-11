/**
 * A text or voice room in a space's list (SpaceChannelRow). The rules are the web's, from
 * useChannelRow: a white pip for unread without mentions, a bold name for unread or mentions, a
 * primary mention pill - all suppressed when muted, which shows a bell-slash instead; voice rooms
 * show "N" or "N/limit" people. The lock badge marks an encrypted (brand) or private (muted)
 * room. Tap opens a text room, or joins a voice room; long-press opens the room menu.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { useChannelRow } from '@/data';
import { openRoom } from '@/shell/state';
import { useTheme } from '@/theme';
import { Badge, Icon, Text, Touchable, useLongPressActions, withAlpha } from '@/ui';
import { channelMenuEntries } from '../menus';
import { pressVoiceRoom } from '../voiceRooms';
import { RoomTypeIcon } from './RoomTypeIcon';

/** `active`: the room on screen (a boolean, so a room switch re-renders two rows, not all). */
export const ChannelRow = memo(function ChannelRow({
  spaceId,
  roomId,
  active,
}: {
  spaceId: string;
  roomId: string;
  active: boolean;
}) {
  const theme = useTheme();
  const row = useChannelRow(spaceId, roomId, active ? roomId : null);
  const name = row?.name || t('space.unnamed');
  const menu = useLongPressActions(() => channelMenuEntries(spaceId, roomId), { title: name });
  if (!row) return null;
  const fg = row.bold || active ? theme.colors.foreground : theme.colors.mutedForeground;
  const label = [
    name,
    row.isVoice ? t('createRoom.typeVoice') : null,
    row.e2ee ? t('room.e2eeBadge') : row.isPrivate ? t('room.privateBadge') : null,
    row.muted ? t('room.notify.muted') : null,
    row.showMentionBadge ? t('mobile.notifications.mentioned', { count: row.mentions }) : null,
    row.showUnreadPip ? t('mobile.nav.unread') : null,
    row.showVoiceCount ? t('mobile.nav.inVoice', { count: row.voiceCount }) : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={styles.wrap}>
      {row.showUnreadPip ? <View style={[styles.pip, { backgroundColor: theme.colors.foreground }]} /> : null}
      <Touchable
        onPress={() => (row.isVoice ? pressVoiceRoom(spaceId, roomId) : openRoom(roomId, spaceId))}
        accessibilityLabel={label}
        accessibilityHint={row.isVoice ? t('voice.join') : undefined}
        accessibilityState={{ selected: active }}
        style={[
          styles.row,
          { borderRadius: theme.radii.md, paddingVertical: Math.max(6, theme.rowPadding) },
          active ? { backgroundColor: withAlpha(theme.colors.primary, 0.15) } : null,
        ]}
        {...menu}
      >
        <RoomTypeIcon voice={row.isVoice} e2ee={row.e2ee} isPrivate={row.isPrivate} color={fg} />
        <Text
          variant="body"
          weight={row.bold || active ? 'semibold' : 'medium'}
          color={fg}
          numberOfLines={1}
          style={styles.name}
        >
          {name}
        </Text>
        {row.muted ? <Icon name="fa-bell-slash" size={11} tone="muted" style={styles.dim} /> : null}
        {row.showVoiceCount ? (
          <View style={styles.voiceCount}>
            <Icon name="fa-user" size={9} tone="muted" />
            <Text variant="caption" style={styles.tabular}>
              {row.userLimit > 0 ? `${row.voiceCount}/${row.userLimit}` : String(row.voiceCount)}
            </Text>
          </View>
        ) : null}
        {row.showMentionBadge ? <Badge count={row.mentions} tone="primary" /> : null}
      </Touchable>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 8, justifyContent: 'center' },
  pip: { position: 'absolute', start: 0, width: 4, height: 8, borderTopEndRadius: 4, borderBottomEndRadius: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 10 },
  name: { flex: 1, minWidth: 0 },
  dim: { opacity: 0.7 },
  voiceCount: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tabular: { fontVariant: ['tabular-nums'] },
});
