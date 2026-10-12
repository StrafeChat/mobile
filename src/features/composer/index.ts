/**
 * The composer area: the message composer of a conversation, its shared reply/edit/draft
 * state, its emoji / GIF panel (in the keyboard's place), and the emoji picker reusable
 * elsewhere (the reaction picker is <EmojiPickerSheet>).
 */
import { forgetComposer } from './state';
import { discardAttachmentQueue } from './attachmentQueues';
import { onRoomGone } from '@/platform/roomGone';

export { Composer, type ComposerProps } from './Composer';
export {
  composerFor,
  startReply,
  cancelReply,
  setReplyMention,
  startEdit,
  cancelEdit,
  finishEdit,
  setEditText,
  setDraft,
  setSendError,
  requestComposerFocus,
  clearAfterSend,
  restoreAfterFailedSend,
  forgetComposer,
  type ComposerRoomState,
} from './state';
export { attachmentQueueFor, discardAttachmentQueue } from './attachmentQueues';
export { EmojiPicker, type EmojiPick, type EmojiPickerProps } from './components/EmojiPicker';
export { EmojiPickerSheet, type EmojiPickerSheetProps } from './components/EmojiPickerSheet';
export { ExpressionPanel, type ExpressionPanelProps } from './panel/ExpressionPanel';
export { useExpressionPanel, type ExpressionTab } from './panel/useExpressionPanel';
export { GifPicker, type GifPickerProps } from './components/GifPicker';
export { EmojiGlyph } from './components/EmojiGlyph';
export { wireToReadable, readableToWire } from './logic/wireText';

/** A room went away (deleted, left, kicked): drop its draft, reply/edit target and queued files. */
export function forgetComposerRoom(roomId: string): void {
  forgetComposer(roomId);
  discardAttachmentQueue(roomId);
}

onRoomGone(forgetComposerRoom);
