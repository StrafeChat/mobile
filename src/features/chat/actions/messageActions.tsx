/**
 * The long-press sheet of a message - the web's right-click menu and hover toolbar in one,
 * Discord-mobile style: a strip of quick reactions on top (recent first, then defaults, and
 * "+" for the full picker), then the actions in the web's order with its gates
 * (src/data messageActions): Add reaction, Copy text, Copy message ID, Reply, Create thread,
 * Pin / Unpin, Report, Edit, Delete. System messages have no sheet.
 *
 * Mobile differences: Reply and Edit go to the composer (startReply / startEdit); Delete
 * always confirms (there is no Shift-click); an optimistic row that has not reached the server
 * yet offers only what works on it (copy, edit is meaningless until it has an id).
 */
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { messages, type DecryptedMessage } from '@web/stores/messages';
import { pinMessage, unpinMessage } from '@web/stores/pinnedMessages';
import { customEmojis } from '@web/stores/customEmojis';
import { getMessageBodyText } from '@web/components/messageList/utils';
import { messageActions, roomGates, userDisplay, type MessageAction, type RoomGates } from '@/data';
import { presentReportSheet } from '@/platform/presenters';
import { useTheme } from '@/theme';
import { closeActionSheet, Icon, showActionSheet, toast, Touchable, withAlpha, type ActionItem } from '@/ui';
import { startEdit, startReply } from '@/features/composer/state';
import { CustomEmojiImage, EmojiGlyph } from '../body/inline';
import { errorText } from '../navigation';
import { openReactionPicker, reactWith } from '../reactions/ReactionPicker';
import { loadRecent, quickReactions, type EmojiPick } from '../reactions/recents';
import { confirmDeleteMessage } from './DeleteMessageSheet';
// The room area owns the create-thread form (from a message and from the thread browser).
// Its presenters module directly, not '@/features/room': that index pulls RoomView, which
// imports this area back.
import { openCreateThread } from '@/features/room/presenters';

export interface MessageActionContext {
  roomId: string;
  spaceId: string | null;
}

const ICONS: Record<MessageAction, string> = {
  addReaction: 'face-smile',
  copyText: 'copy',
  copyId: 'hashtag',
  reply: 'reply',
  createThread: 'comments',
  pin: 'thumbtack',
  unpin: 'thumbtack',
  report: 'flag',
  edit: 'pencil',
  delete: 'trash',
};

function labelOf(action: MessageAction): string {
  switch (action) {
    case 'addReaction':
      return t('messages.actions.addReaction');
    case 'copyText':
      return t('messages.actions.copyText');
    case 'copyId':
      return t('messages.actions.copyId');
    case 'reply':
      return t('messages.actions.reply');
    case 'createThread':
      return t('threads.createFromMessage');
    case 'pin':
      return t('messages.actions.pin');
    case 'unpin':
      return t('messages.actions.unpin');
    case 'report':
      return t('messages.actions.report');
    case 'edit':
      return t('messages.actions.edit');
    case 'delete':
      return t('messages.actions.delete');
  }
}

/** Optimistic rows (temp ids) are not on the server yet: only the copies apply to them. */
export function actionsFor(msg: Pick<DecryptedMessage, 'id' | 'sender_id' | 'pinned' | 'thread_id' | 'system_type' | 'pending'>, uid: string | null | undefined, gates: RoomGates): MessageAction[] {
  const all = messageActions(msg, uid, gates);
  if (msg.pending || msg.id.startsWith('temp-')) return all.filter((a) => a === 'copyText' || a === 'copyId');
  return all;
}

async function copy(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
  toast(t('common.copied'));
}

function run(action: MessageAction, msg: DecryptedMessage, ctx: MessageActionContext, gates: RoomGates): void {
  const { roomId, spaceId } = ctx;
  switch (action) {
    case 'addReaction':
      openReactionPicker({ roomId, messageId: msg.id, ...(gates.customEmojiSpaceId ? { customEmojiSpaceId: gates.customEmojiSpaceId } : {}) });
      return;
    case 'copyText':
      void copy(getMessageBodyText(msg));
      return;
    case 'copyId':
      void copy(msg.id);
      return;
    case 'reply':
      startReply(roomId, msg.id);
      return;
    case 'createThread':
      if (spaceId) openCreateThread({ spaceId, roomId, starterMessageId: msg.id });
      return;
    case 'pin':
    case 'unpin':
      void (action === 'unpin' ? unpinMessage(roomId, msg.id) : pinMessage(roomId, msg.id)).catch((err: unknown) => toast.error(errorText(err)));
      return;
    case 'report': {
      const sender = userDisplay(msg.sender_id, { roomId, spaceId });
      presentReportSheet({
        targetType: 'user',
        targetId: msg.sender_id,
        targetName: sender.name,
        ...(spaceId ? { spaceId } : {}),
        roomId,
        messageId: msg.id,
        messageText: getMessageBodyText(msg),
      });
      return;
    }
    case 'edit':
      startEdit(roomId, msg.id);
      return;
    case 'delete':
      confirmDeleteMessage({ roomId, spaceId, message: msg });
      return;
  }
}

/** The sheet's entries for a message, in order; [] for system messages. */
export function messageActionItems(msg: DecryptedMessage, ctx: MessageActionContext, gates: RoomGates): ActionItem[] {
  return actionsFor(msg, auth.user?.id, gates).map((a) => ({
    key: a,
    label: labelOf(a),
    icon: ICONS[a],
    danger: a === 'report' || a === 'delete',
    onSelect: () => run(a, msg, ctx, gates),
  }));
}

function QuickReactions({ ctx, messageId, gates }: { ctx: MessageActionContext; messageId: string; gates: RoomGates }) {
  const theme = useTheme();
  const only = gates.customEmojiSpaceId;
  const picks = quickReactions(loadRecent(), (id) => {
    const e = customEmojis.byId[id];
    return !!e && (only === undefined || e.space_id === only);
  });
  const react = (pick: EmojiPick) => {
    closeActionSheet();
    reactWith(ctx.roomId, messageId, pick, true);
  };
  const cell = [styles.quick, { backgroundColor: withAlpha(theme.colors.muted, 0.6) }];
  return (
    <View style={styles.quickRow} accessibilityRole="toolbar" accessibilityLabel={t('messages.actions.addReaction')}>
      {picks.map((p) => {
        const key = 'unicode' in p ? p.unicode : `c:${p.customId}`;
        const custom = 'customId' in p ? customEmojis.byId[p.customId] : undefined;
        return (
          <Touchable key={key} onPress={() => react(p)} accessibilityRole="button" accessibilityLabel={'unicode' in p ? p.unicode : `:${custom?.name ?? ''}:`} style={cell}>
            {'unicode' in p ? (
              <EmojiGlyph emoji={p.unicode} size={26} />
            ) : custom ? (
              <CustomEmojiImage url={custom.url} name={custom.name} animated={custom.animated} size={26} />
            ) : null}
          </Touchable>
        );
      })}
      <Touchable
        onPress={() => {
          closeActionSheet();
          openReactionPicker({ roomId: ctx.roomId, messageId, ...(only ? { customEmojiSpaceId: only } : {}) });
        }}
        accessibilityRole="button"
        accessibilityLabel={t('messages.actions.addReaction')}
        style={cell}
      >
        <Icon name="face-smile" tone="muted" size={20} />
      </Touchable>
    </View>
  );
}

/** Open the sheet for a message (long-press on its row). */
export function showMessageActions(messageId: string, ctx: MessageActionContext): void {
  const msg = messages.byRoom[ctx.roomId]?.find((m) => m.id === messageId);
  const gates = roomGates(ctx.roomId, ctx.spaceId);
  if (!msg || !gates || msg.system_type) return;
  const items = messageActionItems(msg, ctx, gates);
  if (items.length === 0) return;
  const canQuick = gates.canReact && !msg.pending && !msg.id.startsWith('temp-');
  void showActionSheet(items, canQuick ? { header: <QuickReactions ctx={ctx} messageId={msg.id} gates={gates} /> } : {});
}

const styles = StyleSheet.create({
  quickRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, gap: 6 },
  quick: { flex: 1, maxWidth: 52, aspectRatio: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
});
