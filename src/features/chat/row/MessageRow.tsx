/**
 * One message in the list (the body of the web's MessageListView <For>): a group's first row
 * with avatar, name (role colour), BOT / OFFICIAL / WEBHOOK or platform tags and time; a continuation pulled tight
 * under it; the reply line and its spine; the body; attachments; a bot's embeds; the thread
 * strip; reactions.
 *
 * Mobile shape: long-press the row for the message sheet, swipe it left to reply, tap the
 * avatar or name for the profile (long-press them for the user menu), tap a continuation to
 * show its time (the web shows it on hover). A mention of the viewer tints the row with a
 * primary bar; a pending send is muted; a jump flashes the row it lands on.
 *
 * Screen readers: the header and the text are one element ("name, time: text") carrying the
 * row's actions - the sheet, reply, the author's profile, and whatever can be tapped inside the
 * text, which VoiceOver cannot enter: links, the images, invite cards and code blocks under or
 * among them, mentions, rooms (messageA11y.ts). The row itself is not an element: on iOS that
 * would hide everything inside it from VoiceOver, so the avatar, the reply line, attachments
 * (play, open, save), a bot's embeds, the thread strip and the reactions each stay their own.
 *
 * A webhook's or bridged message shows the identity it was posted under (data/webhooks
 * useMessageAuthor): its name, avatar (or the default picked from the webhook or bridged
 * person's id), its tag, and a bridged person's own colour when their bridge allows it. Its
 * name and avatar open its card, never a profile, and its menu has no person actions.
 *
 * Embeds show where the list allows them (a plain room, "Show embeds from bots" on); a file an
 * embed already shows as its picture is left out of the attachments, and a link an embed
 * already carries gets no preview card of its own (the web's rules).
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text as RNText, View, type AccessibilityActionEvent, type AccessibilityActionInfo } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming, cancelAnimation } from 'react-native-reanimated';
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import type { DecryptedMessage } from '@web/stores/messages';
import { formatMessageTimestamp, formatTimeOfDay } from '@web/lib/utils/datetime';
import { formatSystemMessageText, getMessageBodyText, isEdited, messagePreviewText } from '@web/components/messageList/utils';
import { attachmentsBesideEmbeds, safeHttpUrl } from '@web/lib/embeds/messageEmbeds';
import { isPlaceholderBody, maskedAuthorLabel, roomParticipantPool, useMessage, useMessageAuthor, type MessageListItem } from '@/data';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Avatar, BotTag, OfficialTag, Text, Touchable, WebhookTag, useLongPress, withAlpha } from '@/ui';
import { composerFor, startReply } from '@/features/composer/state';
import { dismissKeyboard } from '@/ui/keyboard';
import { MessageAttachments } from '../attachments/Attachments';
import { MessageBody, bodyColor } from '../body/MessageBody';
import { MessageEmbeds } from '../body/MessageEmbed';
import { EditedMarker } from '../body/inline';
import { showMessageActions } from '../actions/messageActions';
import { FLASH_FADE_MS, FLASH_HOLD_MS, useFlashNonce } from '../flash';
import { AVATAR_GAP, AVATAR_PX, ROW_PAD_X } from '../layout';
import { openMessageAuthor, showMessageAuthorMenu } from '../people';
import { MessageReactionsRow } from '../reactions/Reactions';
import { ReplyReference } from './ReplyReference';
import { SwipeToReply } from './SwipeToReply';
import { swipeToReplyEnabled } from '../preferences';
import { ThreadFooter } from './ThreadFooter';
import { useListContext } from './listContext';
import { activateBodyTarget, bodyActionIndex, bodyActionName, bodyTargets } from './messageA11y';
import { sameMessageItem } from '../list/listLogic';
// Its module directly, not '@/features/room' (that index pulls RoomView, which pulls the chat).
import { openBridgesLearnMore } from '@/features/room/bridges/learnMore';

type MessageItem = Extract<MessageListItem, { kind: 'message' }>;

const NO_EMBEDS: NonNullable<DecryptedMessage['embeds']> = [];

/** System lines (joins, pins, calls...): centred, muted, no avatar, no actions. */
function SystemRow({ msg }: { msg: DecryptedMessage }) {
  const theme = useTheme();
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
  // A bridge's notice links to what bridges do with messages and how to opt out.
  const bridgeNotice = msg.system_type === 'bridge_created' || msg.system_type === 'bridge_deleted';
  return (
    <View style={styles.system} accessibilityRole="text">
      <Text variant="caption" align="center">
        {text}
        {bridgeNotice ? (
          <>
            {' '}
            <RNText
              onPress={openBridgesLearnMore}
              accessibilityRole="link"
              style={{ color: theme.colors.primary, fontWeight: '600' }}
              testID="bridge-learn-more"
            >
              {t('bridges.learnMore')}
            </RNText>
          </>
        ) : null}
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
  const sender = useMessageAuthor(msg, userCtx);
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
  const authorLongPress = useLongPress(() => showMessageAuthorMenu(msg, userCtx));
  const reply = useCallback(() => startReply(roomId, msg.id), [roomId, msg.id]);

  const name = sender?.name ?? t('common.unknown');
  const nameColor = sender?.nameColor ?? theme.colors.foreground;
  const created = new Date(msg.created_at);
  const placeholder = isPlaceholderBody(msg);
  const color = bodyColor(theme, { pending: msg.pending, placeholder });
  const edited = isEdited(msg) && msg.updated_at ? (
    <EditedMarker label={t('messages.editedAt', { time: formatMessageTimestamp(new Date(msg.updated_at)) })} />
  ) : null;
  const openProfile = () => openMessageAuthor(msg, userCtx);
  // A webhook's or bridged person's name reads with what it is ("Alice (Discord)"), never as a member's.
  const spokenName = (sender && maskedAuthorLabel(sender)) || name;
  const canReply = ctx.canReply && realId;
  // The gesture only when the person turned it on (see ../preferences); the accessibility
  // action below is there either way.
  const swipeReply = useSolid(() => swipeToReplyEnabled());
  const canSwipeReply = canReply && swipeReply;
  const bodyText = getMessageBodyText(msg);
  const embeds = ctx.showEmbeds ? (msg.embeds ?? NO_EMBEDS) : NO_EMBEDS;
  const attachments = useMemo(() => attachmentsBesideEmbeds(msg.attachments ?? [], embeds), [msg.attachments, embeds]);
  const embedLinks = useMemo(() => embeds.map((e) => safeHttpUrl(e.url)).filter((u): u is string => !!u), [embeds]);
  // The participant pool walks the room's loaded messages: once per text, not per render.
  const preview = useMemo(() => messagePreviewText(bodyText, roomParticipantPool(roomId), auth.user?.id, 500), [bodyText, roomId]);
  // Screen readers can neither long-press a row reliably nor swipe it: both as actions. The
  // author's profile too where no avatar is there to reach it (continuations, compact mode),
  // and what can be tapped inside the text, which is one element with the header.
  const authorAction = !item.showHeader || compact;
  const rowActions = useMemo<AccessibilityActionInfo[]>(
    () => [
      { name: 'longpress', label: t('mobile.ui.showActions') },
      ...(canReply ? [{ name: 'reply', label: t('messages.actions.reply') }] : []),
      ...(authorAction ? [{ name: 'profile', label: t('mobile.chat.openProfileOf', { name: spokenName }) }] : []),
    ],
    [canReply, authorAction, spokenName],
  );
  // Read once per text, like the preview: the names go stale only until the text changes. The
  // row's own labels are passed so that no target reads like one of them (see messageA11y.ts).
  const targets = useMemo(
    () => bodyTargets(bodyText, { roomId, spaceId }, msg.sender_id, rowActions.map((a) => a.label ?? '')),
    [bodyText, roomId, spaceId, msg.sender_id, rowActions],
  );
  const a11yActions = useMemo<AccessibilityActionInfo[]>(
    () => [
      // TalkBack's double-tap is ACTION_CLICK, which React Native hands over as the 'activate'
      // action. This element is not clickable otherwise, and Android would then deliver the
      // double-tap as a touch at the element's centre - often a link in the text. It opens the
      // sheet, as VoiceOver's does (onAccessibilityTap below). Android only: on iOS it would be
      // one more custom action in the rotor (MicButton has the same rule).
      ...(Platform.OS === 'android' ? [{ name: 'activate', label: t('mobile.ui.showActions') }] : []),
      ...rowActions,
      ...targets.map((target, i) => ({ name: bodyActionName(i), label: target.label })),
    ],
    [rowActions, targets],
  );
  const onA11yAction = (e: AccessibilityActionEvent) => {
    const action = e.nativeEvent.actionName;
    if (action === 'activate' || action === 'longpress') openActions();
    else if (action === 'reply') reply();
    else if (action === 'profile') openProfile();
    else {
      const i = bodyActionIndex(action);
      const target = i === null ? undefined : targets[i];
      if (target) activateBodyTarget(target, { roomId, spaceId });
    }
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
      skipPreviewUrls={embedLinks}
      color={color}
      italic={placeholder}
      trailing={edited}
      leading={
        // Compact mode (the web's): every row is one line, "Name [tags] time · body".
        compact ? (
          <>
            {nameText}
            {sender?.bot || sender?.system || sender?.webhook ? ' ' : ''}
            {sender?.bot ? <BotTag bot size="xs" /> : null}
            {sender?.webhook ? <WebhookTag webhook={sender.webhook} size="xs" /> : null}
            {sender?.system ? <OfficialTag system size="xs" /> : null}
            <RNText style={{ color: theme.colors.mutedForeground, fontSize: theme.font(11) }}>{`  ${formatMessageTimestamp(created)}  ·  `}</RNText>
          </>
        ) : undefined
      }
    />
  );

  const extras = (
    <>
      {attachments.length ? <MessageAttachments key={`a:${msg.id}`} attachments={attachments} /> : null}
      {embeds.length ? <MessageEmbeds key={`e:${msg.id}`} embeds={embeds} roomId={roomId} spaceId={spaceId} /> : null}
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
        onPress={() => {
          // A tap on the conversation puts the keyboard away (Discord); the row claims the tap,
          // so the list's own tap-to-dismiss never sees it.
          dismissKeyboard();
          if (!item.showHeader && !compact) setTimeFor((v) => (v === msg.id ? null : msg.id));
        }}
        onLongPress={rowLongPress.onLongPress}
        delayLongPress={rowLongPress.delayLongPress}
        // Not an element itself (see the top of the file): the message element is inside.
        accessible={false}
        importantForAccessibility="no"
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
                accessibilityLabel={spokenName}
                accessibilityHint={t('mobile.chat.openProfile')}
                style={msg.reply_to_id ? styles.avatarAfterReply : null}
              >
                <Avatar
                  uri={sender?.avatar ?? null}
                  name={name}
                  // A webhook's or bridged person's default avatar comes from its own id.
                  user={sender?.webhook ? sender.userId : { userId: msg.sender_id, originId: sender?.originId }}
                  size={AVATAR_PX}
                />
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
          <View
            accessible
            accessibilityRole="text"
            accessibilityLabel={`${spokenName}, ${formatMessageTimestamp(created)}: ${preview}`}
            accessibilityHint={t('mobile.chat.messageHint')}
            accessibilityActions={a11yActions}
            onAccessibilityAction={onA11yAction}
            // VoiceOver's double-tap would otherwise land as a tap on whatever sits at the
            // element's centre - often a link in the text. It opens the message sheet instead.
            onAccessibilityTap={openActions}
          >
            {!compact && item.showHeader ? (
              <View style={styles.header}>
                <View style={styles.nameWrap}>{nameText}</View>
                <BotTag bot={sender?.bot} size="sm" />
                <WebhookTag webhook={sender?.webhook} size="sm" />
                <OfficialTag system={sender?.system} size="sm" />
                <Text variant="caption" numberOfLines={1} style={styles.time}>
                  {formatMessageTimestamp(created)}
                </Text>
              </View>
            ) : null}
            {body}
          </View>
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
