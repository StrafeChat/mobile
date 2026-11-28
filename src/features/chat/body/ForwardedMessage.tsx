/**
 * A forwarded message (the web's messageList/ForwardedMessage; lib/forwardMessages): a
 * "Forwarded" label over the copy - its text, files and embeds as they were, never who wrote
 * them - and where and when it came from. That line opens the original when this account can
 * see its room (openRoomLink says so otherwise, as any room link does).
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { ForwardView } from '@web/lib/forwardMessages';
import { formatMessageTimestamp } from '@web/lib/utils/datetime';
import { spaces } from '@web/stores/spaces';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Icon, Text, Touchable, withAlpha } from '@/ui';
import { MessageAttachments } from '../attachments/Attachments';
import { openRoomLink } from '../navigation';
import { MessageBody } from './MessageBody';
import { MessageEmbeds } from './MessageEmbed';

export const ForwardedMessage = memo(function ForwardedMessage({
  forward,
  roomId,
  spaceId,
}: {
  forward: ForwardView;
  roomId: string;
  spaceId: string | null;
}) {
  const theme = useTheme();
  const src = forward.source;
  const stamp = new Date(forward.timestamp);
  const when = Number.isNaN(stamp.getTime()) ? '' : formatMessageTimestamp(stamp);
  const roomName = useSolid(() =>
    src?.roomId && !src.domain && src.spaceId ? (spaces.spaceRoomsBySpaceId[src.spaceId]?.find((r) => r.id === src.roomId)?.name ?? '') : '',
  );
  const canOpen = !!src?.roomId && !!src.messageId && !src.domain;
  const footer = roomName ? t('forward.from', { room: roomName, time: when }) : t('forward.fromTime', { time: when });
  const muted = theme.colors.mutedForeground;

  return (
    <View style={styles.wrap} testID="forwarded-message">
      <View style={styles.label}>
        <Icon name="share" size={11} color={muted} />
        <Text variant="caption" style={{ fontStyle: 'italic', color: muted }}>
          {t('forward.label')}
        </Text>
      </View>
      <View style={[styles.copy, { borderStartColor: theme.colors.border }]}>
        {forward.content ? (
          <MessageBody text={forward.content} roomId={roomId} spaceId={spaceId} allowLinkPreviews={false} embedded small color={withAlpha(theme.colors.foreground, 0.9)} />
        ) : null}
        {forward.attachments.length ? <MessageAttachments attachments={forward.attachments} /> : null}
        {forward.embeds.length ? <MessageEmbeds embeds={forward.embeds} roomId={roomId} spaceId={spaceId} /> : null}
        {canOpen ? (
          <Touchable
            feedback="opacity"
            accessibilityRole="link"
            accessibilityLabel={`${t('forward.openOriginal')}: ${footer}`}
            onPress={() => void openRoomLink({ roomId: src!.roomId!, spaceId: src!.spaceId ?? null, messageId: src!.messageId! })}
          >
            <Text variant="caption" style={{ color: muted }}>
              {footer}
              {forward.editedTimestamp ? ` · ${t('messages.edited')}` : ''}
            </Text>
          </Touchable>
        ) : (
          <Text variant="caption" style={{ color: muted }}>
            {when}
            {forward.editedTimestamp ? ` · ${t('messages.edited')}` : ''}
          </Text>
        )}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { marginTop: 2, gap: 4, maxWidth: 640 },
  label: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  copy: { borderStartWidth: 3, paddingStart: 10, gap: 6 },
});
