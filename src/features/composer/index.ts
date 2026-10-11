/**
 * The composer area: the message composer of a conversation, its shared reply/edit/draft
 * state, and the emoji / GIF pickers (reusable elsewhere - the reaction picker is
 * <EmojiPickerSheet>).
 */
import { forgetComposer } from './state';
import { discardAttachmentQueue } from './attachmentQueues';

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
export { EmojiPickerSheet, ExpressionSheet, type EmojiPickerSheetProps, type ExpressionSheetProps, type ExpressionTab } from './components/ExpressionSheet';
export { GifPicker, type GifPickerProps } from './components/GifPicker';
export { EmojiGlyph } from './components/EmojiGlyph';
export { wireToReadable, readableToWire } from './logic/wireText';

/** A room went away (deleted, left, kicked): drop its draft, reply/edit target and queued files. */
export function forgetComposerRoom(roomId: string): void {
  forgetComposer(roomId);
  discardAttachmentQueue(roomId);
}
