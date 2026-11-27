/**
 * One message as a card - the pinned-messages screen and search results (the web's
 * RoomPinnedPanel / RoomSearchPanel cards): author avatar and name, time, the body, the
 * files it carries and a bot's embeds, drawn by the chat area's own MessageBody /
 * MessageAttachments / MessageEmbeds so a card reads exactly like the message in the list. Tap
 * jumps to it; long-press opens the card's actions. A webhook's or bridged message shows the
 * identity it was posted under with its tag, and its avatar opens its card, never a profile.
 *
 * Embeds follow the web's panels: shown while the reader keeps "Show embeds from bots" on (only
 * a message read in the clear carries any), and a file an embed shows is not repeated.
 */
import { memo, useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import type { DecryptedMessage } from '@web/stores/messages';
import { getMessageBodyText } from '@web/components/messageList/utils';
import { attachmentsBesideEmbeds, embedPreviewText } from '@web/lib/embeds/messageEmbeds';
import { formatMessageTimestamp } from '@web/lib/utils/datetime';
import { t } from '@web/i18n/t';
import { isPlaceholderBody, maskedAuthorLabel, useMessageAuthor, useSettings } from '@/data';
import { useTheme } from '@/theme';
import { MessageAttachments, MessageBody, MessageEmbeds, openMessageAuthor } from '@/features/chat';
import { Avatar, BotTag, Text, Touchable, WebhookTag, useLongPress, withAlpha } from '@/ui';

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
  const author = useMessageAuthor(message, { roomId, spaceId: spaceId ?? null });
  const name = author?.name ?? t('common.unknown');
  const spokenName = (author && maskedAuthorLabel(author)) || name;
  const time = formatMessageTimestamp(new Date(message.created_at));
  const body = getMessageBodyText(message);
  const placeholder = isPlaceholderBody(message) || message.plaintext == null;
  const longPress = useLongPress(() => onLongPress?.(), { disabled: !onLongPress });
  const showEmbeds = useSettings().botEmbeds !== false;
  const embeds = useMemo(() => (showEmbeds ? (message.embeds ?? []) : []), [showEmbeds, message.embeds]);
  const attachments = useMemo(() => attachmentsBesideEmbeds(message.attachments ?? [], embeds), [message.attachments, embeds]);
  // An embed-only message is read out by its first embed (the card itself is one element).
  const spoken = body || embedPreviewText(embeds);

  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      {...(onLongPress ? longPress : null)}
      feedback="highlight"
      accessibilityRole="button"
      accessibilityLabel={`${spokenName}, ${time}, ${placeholder ? spoken : spoken.slice(0, 200)}`}
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
        onPress={() => openMessageAuthor(message, { roomId, spaceId: spaceId ?? null })}
        accessibilityRole="button"
        accessibilityLabel={spokenName}
        hitSlop={6}
      >
        <Avatar uri={author?.avatar} name={name} user={author?.webhook ? author.userId : { userId: message.sender_id, originId: author?.originId }} size="md" />
      </Touchable>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text variant="label" weight="semibold" color={author?.nameColor} numberOfLines={1} style={{ flexShrink: 1 }}>
            {name}
          </Text>
          <BotTag bot={author?.bot} size="xs" />
          <WebhookTag webhook={author?.webhook} size="xs" />
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
        {embeds.length > 0 ? <MessageEmbeds embeds={embeds} roomId={roomId} spaceId={spaceId ?? null} /> : null}
      </View>
    </Touchable>
  );
});
