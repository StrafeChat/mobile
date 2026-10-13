/**
 * What the composer's top strip shows: the message being replied to (author, one-line
 * preview, whether it is loaded so "jump" can scroll to it) and the message being edited
 * (its wire text, to seed the edit buffer, and whether it was deleted). Both read one message
 * by id, so the strip re-renders only when that message changes.
 */
import { messages } from '@web/stores/messages';
import { auth } from '@web/stores/auth';
import { rooms } from '@web/stores/rooms';
import { spaces } from '@web/stores/spaces';
import { isSnowflake, messageIdGt } from '@web/stores/readState';
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
  /** In the loaded list. A message can be missing without being gone: a jump (a reply's
   * original, a pin, a search hit, "jump to present") replaces the loaded window. */
  loaded: boolean;
  /** Missing from a loaded window that covers where it would be: deleted (ends edit mode). */
  deleted: boolean;
}

/** The newest message the server reported for a room (PM list or a space's room list). */
function roomLastMessageId(roomId: string): string | undefined {
  const pm = rooms.rooms.find((r) => r.id === roomId);
  if (pm?.last_message_id) return pm.last_message_id;
  for (const list of Object.values(spaces.spaceRoomsBySpaceId)) {
    const r = list?.find((x) => x.id === roomId);
    if (r?.last_message_id) return r.last_message_id;
  }
  return undefined;
}

/**
 * Whether `messageId` would be in the loaded window if it still existed. The window is one
 * contiguous range of history (the store replaces it on a jump rather than splice two ranges),
 * so an id between its oldest and newest message is covered; one beyond an end only when
 * nothing more is that way - no older history at all, or past the room's newest message.
 * Anything uncertain answers no: wrongly ending an edit throws away what was typed, while a
 * save of a message that is really gone just fails with the server's reason.
 */
export function windowCovers(roomId: string, messageId: string): boolean {
  if (!isSnowflake(messageId)) return false;
  const list = messages.byRoom[roomId] ?? [];
  let oldest: string | undefined;
  let newest: string | undefined;
  for (const m of list) {
    // Sends still in flight carry temp ids and sit outside the range.
    if (!isSnowflake(m.id)) continue;
    if (oldest === undefined || messageIdGt(oldest, m.id)) oldest = m.id;
    if (newest === undefined || messageIdGt(m.id, newest)) newest = m.id;
  }
  if (oldest === undefined || newest === undefined) return false;
  if (messageIdGt(oldest, messageId)) return messages.hasMoreOlder[roomId] === false;
  if (messageIdGt(messageId, newest)) {
    // "Jump to present" clears hasMoreNewer before the tail arrives, while the old window is
    // still loaded: the room's newest message id is what says the message could exist.
    const last = roomLastMessageId(roomId);
    return messages.hasMoreNewer[roomId] !== true && last !== undefined && messageIdGt(messageId, last);
  }
  return true;
}

export function editTargetView(roomId: string, messageId: string): EditTargetView {
  const msg = messages.byRoom[roomId]?.find((m) => m.id === messageId);
  if (!msg) return { id: messageId, text: null, loaded: false, deleted: windowCovers(roomId, messageId) };
  const readable = !msg.decryptError && !msg.decryptPending && msg.plaintext != null;
  return { id: messageId, text: readable ? (msg.plaintext ?? '') : null, loaded: true, deleted: false };
}

export function useEditTarget(roomId: string, messageId: string | null): EditTargetView | null {
  return useDerived(
    `composerEdit:${roomId}:${messageId ?? ''}`,
    () => (messageId ? editTargetView(roomId, messageId) : null),
    deepEqual,
  );
}
