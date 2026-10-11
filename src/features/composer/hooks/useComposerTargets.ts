/**
 * What the composer's top strip shows: the message being replied to (author, one-line
 * preview, whether it is loaded so "jump" can scroll to it) and the message being edited
 * (its wire text, to seed the edit buffer). Both read one message by id, so the strip
 * re-renders only when that message changes.
 */
import { messages } from '@web/stores/messages';
import { auth } from '@web/stores/auth';
import { getMessageBodyText, getSenderDisplay, messagePreviewText } from '@web/components/messageList/utils';
import { t } from '@web/i18n/t';
import { deepEqual, useDerived } from '@/data/derived';
import { roomParticipantPool } from '@/data/messages';

/** The reply strip's preview length (the web's 120 characters). */
export const REPLY_PREVIEW_CHARS = 120;

export interface ReplyTargetView {
  id: string;
  name: string;
  preview: string;
  /** In the loaded window: tapping the strip scrolls to it and flashes it. */
  loaded: boolean;
}

export function replyTargetView(roomId: string, messageId: string): ReplyTargetView {
  const target = messages.byRoom[roomId]?.find((m) => m.id === messageId);
  if (!target) return { id: messageId, name: t('room.replyFallback'), preview: '', loaded: false };
  const pool = roomParticipantPool(roomId);
  const me = auth.user?.id;
  const sender = getSenderDisplay(target.sender_id, pool, me);
  return {
    id: messageId,
    name: sender.name,
    preview: messagePreviewText(getMessageBodyText(target), pool, me, REPLY_PREVIEW_CHARS),
    loaded: true,
  };
}

export function useReplyTarget(roomId: string, messageId: string | null): ReplyTargetView | null {
  return useDerived(
    `composerReply:${roomId}:${messageId ?? ''}`,
    () => (messageId ? replyTargetView(roomId, messageId) : null),
    deepEqual,
  );
}

export interface EditTargetView {
  id: string;
  /** The stored (wire) text, or null while it isn't readable yet (loading, undecryptable). */
  text: string | null;
  /** Still in the loaded list (deleted messages end edit mode). */
  exists: boolean;
}

export function editTargetView(roomId: string, messageId: string): EditTargetView {
  const msg = messages.byRoom[roomId]?.find((m) => m.id === messageId);
  if (!msg) return { id: messageId, text: null, exists: false };
  const readable = !msg.decryptError && !msg.decryptPending && msg.plaintext != null;
  return { id: messageId, text: readable ? (msg.plaintext ?? '') : null, exists: true };
}

export function useEditTarget(roomId: string, messageId: string | null): EditTargetView | null {
  return useDerived(
    `composerEdit:${roomId}:${messageId ?? ''}`,
    () => (messageId ? editTargetView(roomId, messageId) : null),
    deepEqual,
  );
}
