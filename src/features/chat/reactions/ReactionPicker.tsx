/**
 * Adding a reaction: the web's standalone EmojiPicker, as the composer area's
 * <EmojiPickerSheet> (one emoji picker in the app - search, frequently used, each space's
 * custom emoji, the Unicode groups - limited to one space's custom emoji when the viewer
 * lacks Use External Emojis in the room). Picking an emoji the viewer already reacted with
 * removes it, as on the web (toggleReaction).
 *
 * Opened with openReactionPicker(); drawn by <ReactionPickerHost/> inside the message list.
 */
import { t } from '@web/i18n/t';
import { messages, toggleReaction } from '@web/stores/messages';
import { EmojiPickerSheet, type EmojiPick as PickerPick } from '@/features/composer';
import { createExternalStore, haptics, toast, useExternalStore } from '@/ui';
import { useHostSlot } from '../hostSlot';
import { errorText } from '../navigation';
import { pushRecent, reactionKeyOf, recentKeyOf, type EmojiPick } from './recents';

export interface ReactionPickerRequest {
  roomId: string;
  messageId: string;
  /** Only this space's custom emoji (no Use External Emojis here). */
  customEmojiSpaceId?: string;
}

const pickerStore = createExternalStore<ReactionPickerRequest | null>(null);

export function openReactionPicker(req: ReactionPickerRequest): void {
  pickerStore.set(req);
}

export function closeReactionPicker(): void {
  pickerStore.set(null);
}

/**
 * React with `pick` on a message: adds it, or removes it when it is already the viewer's.
 * `remember` puts it at the front of the recent list (picks from the picker and the quick
 * strip; a tap on an existing pill is not a choice of emoji).
 */
export function reactWith(roomId: string, messageId: string, pick: EmojiPick, remember = false): void {
  const key = reactionKeyOf(pick);
  const mine = messages.byRoom[roomId]?.find((m) => m.id === messageId)?.reactions?.find((r) => r.emoji === key)?.me ?? false;
  if (remember) pushRecent(recentKeyOf(pick));
  haptics.selection();
  toggleReaction(roomId, messageId, key, mine).catch((err: unknown) => toast.error(errorText(err)));
}

/** The composer picker's pick as a reaction pick. */
export function fromPickerPick(pick: PickerPick): EmojiPick | null {
  if (pick.custom) return { customId: pick.custom.id };
  return pick.unicode ? { unicode: pick.unicode } : null;
}

export function ReactionPickerHost() {
  const isHost = useHostSlot('chat.reactionPicker');
  const req = useExternalStore(pickerStore);
  if (!isHost) return null;
  return (
    <EmojiPickerSheet
      open={!!req}
      onClose={closeReactionPicker}
      title={t('messages.actions.addReaction')}
      {...(req?.customEmojiSpaceId ? { customEmojiSpaceId: req.customEmojiSpaceId } : {})}
      onPick={(pick) => {
        const r = pickerStore.get();
        const p = fromPickerPick(pick);
        closeReactionPicker();
        // The picker already put it at the front of the recent list.
        if (r && p) reactWith(r.roomId, r.messageId, p);
      }}
    />
  );
}
