/**
 * One message in the list (the body of the web's MessageListView <For>): a group's first row
 * with avatar, name (role colour), BOT / OFFICIAL tags and time; a continuation pulled tight
 * under it; the reply line and its spine; the body; attachments; the thread strip; reactions.
 *
 * Mobile shape: long-press the row for the message sheet, swipe it left to reply, tap the
 * avatar or name for the profile (long-press them for the user menu), tap a continuation to
 * show its time (the web shows it on hover). A mention of the viewer tints the row with a
 * primary bar; a pending send is muted; a jump flashes the row it lands on.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, View, type AccessibilityActionEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming, cancelAnimation } from 'react-native-reanimated';
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import type { DecryptedMessage } from '@web/stores/messages';
import { formatMessageTimestamp, formatTimeOfDay } from '@web/lib/utils/datetime';
import { formatSystemMessageText, getMessageBodyText, isEdited, messagePreviewText } from '@web/components/messageList/utils';
import { isPlaceholderBody, roomParticipantPool, useMessage, useUserDisplay, type MessageListItem } from '@/data';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Avatar, BotTag, OfficialTag, Text, Touchable, useLongPress, withAlpha } from '@/ui';
import { composerFor, startReply } from '@/features/composer/state';
import { MessageAttachments } from '../attachments/Attachments';
import { MessageBody, bodyColor } from '../body/MessageBody';
import { EditedMarker } from '../body/inline';
import { showMessageActions } from '../actions/messageActions';
import { FLASH_FADE_MS, FLASH_HOLD_MS, useFlashNonce } from '../flash';
import { AVATAR_GAP, AVATAR_PX, ROW_PAD_X } from '../layout';
import { openUserProfile, showAuthorMenu } from '../people';
import { MessageReactionsRow } from '../reactions/Reactions';
import { ReplyReference } from './ReplyReference';
import { SwipeToReply } from './SwipeToReply';
import { swipeToReplyEnabled } from '../preferences';
import { ThreadFooter } from './ThreadFooter';
import { useListContext } from './listContext';
import { sameMessageItem } from '../list/listLogic';

type MessageItem = Extract<MessageListItem, { kind: 'message' }>;

/** System lines (joins, pins, calls...): centred, muted, no avatar, no actions. */
function SystemRow({ msg }: { msg: DecryptedMessage }) {
  const { roomId } = useListContext();
  const text = useSolid(
    () =>
      formatSystemMessageText(
        msg as DecryptedMessage & { system_type: string; system_payload: string },
        roomParticipantPool(roomId),
        auth.user?.id,
      ),
    [msg, roomId],
  );
  return (
    <View style={styles.system} accessibilityRole="text">
      <Text variant="caption" align="center">
        {text}
      </Text>
    </View>
  );
}

/** The primary tint a jump leaves on the row it lands on: held, then faded (3.2 s). */
function FlashOverlay({ id }: { id: string }) {
  const theme = useTheme();
  const nonce = useFlashNonce(id);
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (!nonce) return;
    cancelAnimation(opacity);
    opacity.value = 1;
    opacity.value = withDelay(FLASH_HOLD_MS, withTiming(0, { duration: theme.reduceMotion ? 0 : FLASH_FADE_MS }));
  }, [nonce, opacity, theme.reduceMotion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  if (!nonce) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.flash, { backgroundColor: withAlpha(theme.colors.primary, 0.28), borderStartColor: theme.colors.primary }, style]}
    />
  );
}

// Compared by value: each structural change of the list (a message arriving) hands every row
// a new item object, and a shallow compare re-rendered every mounted row for it.
export const MessageRow = memo(
  function MessageRow({ item }: { item: MessageItem }) {
    const ctx = useListContext();
    const msg = useMessage(ctx.roomId, item.id);
    if (!msg) return null;
    if (item.system) return <SystemRow msg={msg} />;
    return <UserMessageRow item={item} msg={msg} />;
  },
  (a, b) => sameMessageItem(a.item, b.item),
);

function UserMessageRow({ item, msg }: { item: MessageItem; msg: DecryptedMessage }) {
  const theme = useTheme();
  const ctx = useListContext();
  const { roomId, spaceId, compact } = ctx;
  const userCtx = { roomId, spaceId };
  const sender = useUserDisplay(msg.sender_id, userCtx);
  // FlashList recycles rows: state that belongs to one message resets when the row shows another.
  const [timeFor, setTimeFor] = useState<string | null>(null);
  const showTime = timeFor === msg.id;
  const inComposer = useSolid(() => {
    const c = composerFor(roomId);
    return c.replyTo === msg.id || c.editing === msg.id;
  }, [roomId, msg.id]);

  const realId = !msg.pending && !msg.id.startsWith('temp-');
  const openActions = useCallback(() => showMessageActions(msg.id, { roomId, spaceId }), [msg.id, roomId, spaceId]);
  const rowLongPress = useLongPress(openActions);
  const authorLongPress = useLongPress(() => showAuthorMenu(msg.sender_id, userCtx));
  const reply = useCallback(() => startReply(roomId, msg.id), [roomId, msg.id]);

  const name = sender?.name ?? t('common.unknown');
  const nameColor = sender?.nameColor ?? theme.colors.foreground;
  const created = new Date(msg.created_at);
  const placeholder = isPlaceholderBody(msg);
  const color = bodyColor(theme, { pending: msg.pending, placeholder });
  const edited = isEdited(msg) && msg.updated_at ? (
    <EditedMarker label={t('messages.editedAt', { time: formatMessageTimestamp(new Date(msg.updated_at)) })} />
  ) : null;
  const openProfile = () => openUserProfile(msg.sender_id, userCtx);
  const canReply = ctx.canReply && realId;
  // The gesture only when the person turned it on (see ../preferences); the accessibility
  // action below is there either way.
  const swipeReply = useSolid(() => swipeToReplyEnabled());
  const canSwipeReply = canReply && swipeReply;
  const bodyText = getMessageBodyText(msg);
  // The participant pool walks the room's loaded messages: once per text, not per render.
  const preview = useMemo(() => messagePreviewText(bodyText, roomParticipantPool(roomId), auth.user?.id, 500), [bodyText, roomId]);
  // Screen readers can neither long-press a row reliably nor swipe it: both as actions.
  const a11yActions = useMemo(
    () => [
      { name: 'longpress', label: t('mobile.ui.showActions') },
      ...(canReply ? [{ name: 'reply', label: t('messages.actions.reply') }] : []),
    ],
    [canReply],
  );
  const onA11yAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'longpress') openActions();
    else if (e.nativeEvent.actionName === 'reply') reply();
  };

  const nameText = (
    <RNText
      onPress={openProfile}
      {...authorLongPress}
      accessibilityRole="button"
      accessibilityHint={t('mobile.chat.openProfile')}
      style={{ color: nameColor, fontWeight: '600', fontSize: theme.font(15) }}
      numberOfLines={compact ? undefined : 1}
    >
      {name}
    </RNText>
  );

  const body = (
    <MessageBody
      key={msg.id}
      text={bodyText}
      roomId={roomId}
      spaceId={spaceId}
      allowLinkPreviews={ctx.allowLinkPreviews}
      color={color}
      italic={placeholder}
      trailing={edited}
      leading={
        // Compact mode (the web's): every row is one line, "Name [tags] time · body".
        compact ? (
          <>
            {nameText}
            {sender?.bot || sender?.system ? ' ' : ''}
            {sender?.bot ? <BotTag bot size="xs" /> : null}
            {sender?.system ? <OfficialTag system size="xs" /> : null}
            <RNText style={{ color: theme.colors.mutedForeground, fontSize: theme.font(11) }}>{`  ${formatMessageTimestamp(created)}  ·  `}</RNText>
          </>
        ) : undefined
      }
    />
  );

  const extras = (
    <>
      {msg.attachments?.length ? <MessageAttachments key={`a:${msg.id}`} attachments={msg.attachments} /> : null}
      {msg.thread_id ? <ThreadFooter key={msg.thread_id} threadId={msg.thread_id} spaceId={spaceId} /> : null}
      {msg.reactions?.length ? (
        <MessageReactionsRow
          key={`r:${msg.id}`}
          roomId={roomId}
          messageId={msg.id}
          canJoin={ctx.canJoinReactions}
          canAdd={ctx.canReact && realId}
          {...(ctx.customEmojiSpaceId ? { customEmojiSpaceId: ctx.customEmojiSpaceId } : {})}
        />
      ) : null}
    </>
  );

  const highlight = item.mentionsMe
    ? { backgroundColor: withAlpha(theme.colors.primary, 0.1), borderStartColor: theme.colors.primary, borderStartWidth: 2 }
    : inComposer
      ? { backgroundColor: withAlpha(theme.colors.primary, 0.06) }
      : null;

  return (
    <SwipeToReply enabled={canSwipeReply} onReply={reply}>
      <Pressable
        onPress={!item.showHeader && !compact ? () => setTimeFor((v) => (v === msg.id ? null : msg.id)) : undefined}
        {...rowLongPress}
        accessibilityRole="text"
        accessibilityLabel={`${name}, ${formatMessageTimestamp(created)}: ${preview}`}
        accessibilityHint={t('mobile.chat.messageHint')}
        accessibilityActions={a11yActions}
        onAccessibilityAction={onA11yAction}
        style={[
          styles.row,
          item.showHeader ? styles.headerRow : styles.continuation,
          item.groupStart ? { marginTop: ctx.groupSpacing } : null,
          highlight,
          { opacity: msg.pending ? 0.85 : 1 },
        ]}
      >
        <FlashOverlay key={`f:${msg.id}`} id={msg.id} />
        {!compact ? (
          <View style={styles.gutter}>
            {msg.reply_to_id ? <View pointerEvents="none" style={[styles.spine, { borderColor: withAlpha(theme.colors.border, 0.9), borderTopLeftRadius: theme.radii.md }]} /> : null}
            {item.showHeader ? (
              <Touchable
                feedback="opacity"
                onPress={openProfile}
                {...authorLongPress}
                accessibilityRole="button"
                accessibilityLabel={name}
                accessibilityHint={t('mobile.chat.openProfile')}
                style={msg.reply_to_id ? styles.avatarAfterReply : null}
              >
                <Avatar uri={sender?.avatar ?? null} name={name} size={AVATAR_PX} />
              </Touchable>
            ) : showTime ? (
              <Text variant="caption" style={styles.gutterTime} numberOfLines={1} adjustsFontSizeToFit>
                {formatTimeOfDay(created)}
              </Text>
            ) : null}
          </View>
        ) : null}
        <View style={styles.content}>
          {msg.reply_to_id ? <ReplyReference roomId={roomId} messageId={msg.id} compact={compact} /> : null}
          {!compact && item.showHeader ? (
            <View style={styles.header}>
              <View style={styles.nameWrap}>{nameText}</View>
              <BotTag bot={sender?.bot} size="sm" />
              <OfficialTag system={sender?.system} size="sm" />
              <Text variant="caption" numberOfLines={1} style={styles.time}>
                {formatMessageTimestamp(created)}
              </Text>
            </View>
          ) : null}
          {body}
          {extras}
        </View>
      </Pressable>
    </SwipeToReply>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', paddingHorizontal: ROW_PAD_X, gap: AVATAR_GAP, borderStartWidth: 0, borderStartColor: 'transparent' },
  headerRow: { paddingTop: 2, paddingBottom: 2 },
  continuation: { paddingVertical: 1 },
  gutter: { width: AVATAR_PX, alignItems: 'center' },
  gutterTime: { fontSize: 10, lineHeight: 21, fontVariant: ['tabular-nums'] },
  spine: { position: 'absolute', left: AVATAR_PX / 2, top: 10, height: 14, width: AVATAR_PX / 2 + AVATAR_GAP - 2, borderLeftWidth: 2, borderTopWidth: 2 },
  avatarAfterReply: { marginTop: 24 },
  content: { flex: 1, minWidth: 0 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 1, minWidth: 0 },
  nameWrap: { flexShrink: 1, minWidth: 0 },
  time: { flexShrink: 0 },
  system: { paddingVertical: 8, paddingHorizontal: ROW_PAD_X, alignItems: 'center' },
  flash: { borderStartWidth: 3 },
});
