/**
 * One message as a card - the pinned-messages screen and search results (the web's
 * RoomPinnedPanel / RoomSearchPanel cards): author avatar and name, time, the body and the
 * files it carries, drawn by the chat area's own MessageBody / MessageAttachments so a card
 * reads exactly like the message in the list. Tap jumps to it; long-press opens the card's
 * actions.
 */
import { memo, type ReactNode } from 'react';
import { View } from 'react-native';
import type { DecryptedMessage } from '@web/stores/messages';
import { getMessageBodyText } from '@web/components/messageList/utils';
import { formatMessageTimestamp } from '@web/lib/utils/datetime';
import { t } from '@web/i18n/t';
import { isPlaceholderBody, useUserDisplay } from '@/data';
import { useTheme } from '@/theme';
import { MessageAttachments, MessageBody } from '@/features/chat';
import { Avatar, BotTag, Text, Touchable, useLongPress, withAlpha } from '@/ui';
import { showUserProfile } from '../profile/present';

export interface MessageCardProps {
  message: DecryptedMessage;
  /** The room the message is in (a space search spans channels). */
  roomId: string;
  spaceId?: string | null;
  onPress: () => void;
  onLongPress?: () => void;
  /** End-of-header slot (an unpin button). */
  trailing?: ReactNode;
  testID?: string;
}

export const MessageCard = memo(function MessageCard({ message, roomId, spaceId, onPress, onLongPress, trailing, testID }: MessageCardProps) {
  const theme = useTheme();
  const c = theme.colors;
  const author = useUserDisplay(message.sender_id, { roomId, spaceId: spaceId ?? null });
  const name = author?.name ?? t('common.unknown');
  const time = formatMessageTimestamp(new Date(message.created_at));
  const body = getMessageBodyText(message);
  const placeholder = isPlaceholderBody(message) || message.plaintext == null;
  const longPress = useLongPress(() => onLongPress?.(), { disabled: !onLongPress });
  const attachments = message.attachments ?? [];

  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      {...(onLongPress ? longPress : null)}
      feedback="highlight"
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${time}, ${placeholder ? body : body.slice(0, 200)}`}
      accessibilityHint={t('mobile.room.jumpHint')}
      style={{
        flexDirection: 'row',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: withAlpha(c.border, 0.8),
        backgroundColor: withAlpha(c.card, 0.6),
      }}
    >
      <Touchable
        onPress={() => showUserProfile(message.sender_id, { roomId, spaceId })}
        accessibilityRole="button"
        accessibilityLabel={name}
        hitSlop={6}
      >
        <Avatar uri={author?.avatar} name={name} size="md" />
      </Touchable>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="label" weight="semibold" color={author?.nameColor} numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Text>
          <BotTag bot={author?.bot} size="xs" />
          <Text variant="caption" numberOfLines={1} style={{ flexShrink: 0 }}>
            {time}
          </Text>
          <View style={{ flex: 1 }} />
          {trailing}
        </View>
        {body ? (
          <MessageBody text={body} roomId={roomId} spaceId={spaceId ?? null} allowLinkPreviews={false} inlineOnly italic={placeholder} numberOfLines={8} />
        ) : null}
        {attachments.length > 0 ? <MessageAttachments attachments={attachments} /> : null}
      </View>
    </Touchable>
  );
});
