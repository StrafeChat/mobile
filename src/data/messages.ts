/**
 * Messages: the conversation list's rows, one message per row, paging state, the per-visit
 * unread snapshot, and the reply line.
 *
 * Re-render contract, the reason these hooks exist:
 *  - the list (useMessageList) re-renders when its *structure* changes - a message added or
 *    removed, grouping, dividers, paging edges - never for a reaction, an edit or a pin;
 *  - a row (useMessage) re-renders when that one message changes, including the in-place
 *    `produce` writes the store uses for reactions, pins and thread ids (a row memoised on
 *    the store object's identity would miss those).
 *
 * Paging, jumping, sending and reacting are the web store's own functions (loadMessages,
 * loadOlderMessages, loadNewerMessages, jumpToMessage, jumpToPresent, sendMessage,
 * toggleReaction...): call them from handlers. The list must also register itself with
 * enterRoomView/leaveRoomView (see stores/messages) - that belongs to the list component.
 */
import { createComputed, createSignal, untrack } from 'solid-js';
import { useEffect } from 'react';
import {
  messages,
  setMessages,
  hasPendingJump,
  loadMessages,
  type DecryptedMessage,
  type JumpTarget,
} from '@web/stores/messages';
import { readState, messageIdGt, getUnreadBannerInfo, type UnreadBannerInfo } from '@web/stores/readState';
import { newHeaderDismissed, clearNewHeaderDismissed } from '@web/stores/newHeaderDismissed';
import { rooms } from '@web/stores/rooms';
import { auth } from '@web/stores/auth';
import { relationships, RelType } from '@web/stores/relationships';
import { spaceMembers } from '@web/stores/spaceMembers';
import type { RoomParticipant } from '@web/api/rooms';
import {
  augmentParticipants,
  getMessageBodyText,
  getSenderDisplay,
  messagePreviewText,
} from '@web/components/messageList/utils';
import { snapshot, useSolid } from '@/bridge/solid';
import { deepEqual, sameArray, useDerived } from './derived';
import { useSolidScope } from './scope';
import { buildMessageList, type MessageListModel } from './messageListModel';
import { findSpaceRoom, spaceIdOfRoom } from './rooms';
import { isSnowflakeId } from './constants';

// ---- ids and paging ---------------------------------------------------------------------------

/** Every loaded message id, oldest first (blocked senders included - use useMessageList to
 * render). Re-renders when a message is added, removed or replaced (temp -> real id). */
export function useMessageIds(roomId: string): string[] {
  return useDerived(`msgIds:${roomId}`, () => (messages.byRoom[roomId] ?? []).map((m) => m.id), sameArray);
}

export interface MessagePaging {
  /** byRoom has an entry (loaded or cached); false means the screen should call loadMessages. */
  cached: boolean;
  /** First load of an empty room: show the skeleton. */
  loading: boolean;
  loadingOlder: boolean;
  loadingNewer: boolean;
  /** undefined until known - the list treats that as "maybe" (the web's `?? true`). */
  hasMoreOlder: boolean | undefined;
  /** Reading an older window: a "Jump to present" bar instead of the jump-to-bottom button. */
  hasMoreNewer: boolean;
  /** A send is in flight; the composer refuses a second one. */
  sending: boolean;
}

export function messagePaging(roomId: string): MessagePaging {
  return {
    cached: messages.byRoom[roomId] !== undefined,
    loading: messages.loading[roomId] === true,
    loadingOlder: messages.loadingOlder[roomId] === true,
    loadingNewer: messages.loadingNewer[roomId] === true,
    hasMoreOlder: messages.hasMoreOlder[roomId],
    hasMoreNewer: messages.hasMoreNewer[roomId] === true,
    sending: messages.sending[roomId] === true,
  };
}

/** Paging flags for a room. Re-renders when any flag flips. */
export function useMessagePaging(roomId: string): MessagePaging {
  return useDerived(`msgPaging:${roomId}`, () => messagePaging(roomId), deepEqual);
}

// ---- one message ---------------------------------------------------------------------------------

/**
 * One message as a plain, frozen copy. Re-renders when anything on it changes - text, edit,
 * decryption resolving, attachments' upload progress, reactions, pin, thread - and not when
 * other messages in the room do.
 */
export function useMessage(roomId: string, messageId: string): DecryptedMessage | undefined {
  return useDerived(
    `msg:${roomId}:${messageId}`,
    () => {
      const m = messages.byRoom[roomId]?.find((x) => x.id === messageId);
      return m ? snapshot(m) : undefined;
    },
    deepEqual,
  );
}

/** Just a message's reactions (for a reactions strip rendered apart from the row). */
export function useMessageReactions(roomId: string, messageId: string): NonNullable<DecryptedMessage['reactions']> {
  return useDerived(
    `msgReactions:${roomId}:${messageId}`,
    () => {
      const m = messages.byRoom[roomId]?.find((x) => x.id === messageId);
      return (m?.reactions ?? []).map((r) => ({ emoji: r.emoji, count: r.count, me: r.me }));
    },
    deepEqual,
  );
}

// ---- scroll signals --------------------------------------------------------------------------------

/** A pending jump for the list to apply (null when none). Consume it with takeJumpTarget
 * *before* scrolling, as the web list does, or one jump can fire twice. */
export function useJumpTarget(roomId: string): JumpTarget | null {
  return useDerived(
    `jumpTarget:${roomId}`,
    () => {
      const j = messages.jumpTarget[roomId];
      return j ? { id: j.id, nonce: j.nonce, smooth: j.smooth } : null;
    },
    deepEqual,
  );
}

/** Clear a room's jump target (the list consumed it). */
export function takeJumpTarget(roomId: string): void {
  setMessages('jumpTarget', roomId, null);
}

export interface ScrollSignals {
  /** Bumped on a live append at the bottom: follow it only if already following. */
  tick: number;
  /** Bumped by the user's own send and jump-to-present: always go to the bottom. */
  force: number;
}

/** The store's scroll counters; react to their *changes*, not their values. */
export function useScrollSignals(roomId: string): ScrollSignals {
  return useDerived(
    `scrollSignals:${roomId}`,
    () => ({ tick: messages.scrollToBottomTick[roomId] ?? 0, force: messages.scrollToBottomForce[roomId] ?? 0 }),
    deepEqual,
  );
}

// ---- the per-visit unread snapshot ---------------------------------------------------------------

export interface EntrySnapshot {
  /** The read cursor as it stood on entry - frozen for the visit so the divider does not
   * move while the viewport ack advances the live cursor. */
  lastReadMessageId: string | null;
  /** The newest message loaded on entry (null until the first rows arrive). Messages that
   * arrive while watching are never "new". */
  maxMessageIdWhenEntered: string | null;
}

function largestSnowflake(list: readonly { id: string }[]): string | null {
  let best: string | null = null;
  for (const m of list) {
    if (!isSnowflakeId(m.id)) continue;
    if (best === null || messageIdGt(m.id, best)) best = m.id;
  }
  return best;
}

/**
 * The NEW divider's and the unread banner's reference points for this visit - RoomPage's and
 * SpacePage's effects, as Solid code in a scope owned by the screen:
 *  - on entry (and when hydration completes) the max is reset and the NEW header un-dismissed;
 *  - the cursor is read once, untracked, only after auth.hydrated (before it, the stores are
 *    empty and freezing that would show every message as new on every visit);
 *  - the max is taken the first time the room has rows.
 * Mount once per conversation screen; re-renders when either value is set.
 */
export function useEntrySnapshot(roomId: string): EntrySnapshot {
  const scope = useSolidScope(() => {
    const [lastRead, setLastRead] = createSignal<string | null>(null);
    const [max, setMax] = createSignal<string | null>(null);
    createComputed(() => {
      const hydrated = auth.hydrated;
      setMax(null);
      if (!hydrated) {
        setLastRead(null);
        return;
      }
      untrack(() => {
        const pm = rooms.rooms.find((x) => x.id === roomId);
        const fallback = pm ? pm.last_read_message_id : findSpaceRoom(roomId)?.room.last_read_message_id;
        setLastRead(readState.byRoom[roomId]?.lastReadMessageId ?? fallback ?? null);
      });
    });
    createComputed(() => {
      const list = messages.byRoom[roomId] ?? [];
      // Tracked, as in the web: a reset (hydration completing) takes the max again at once.
      if (list.length === 0 || max() != null) return;
      const best = largestSnowflake(list);
      if (best) setMax(best);
    });
    return { lastRead, max };
  }, [roomId]);
  // Un-dismiss the NEW header on entry. A store write, so in an effect: from the scope's
  // first run it would land during render and update other components mid-render.
  const hydrated = useSolid(() => auth.hydrated);
  useEffect(() => {
    clearNewHeaderDismissed(roomId);
  }, [roomId, hydrated]);
  return useSolid(
    () => ({ lastReadMessageId: scope.lastRead(), maxMessageIdWhenEntered: scope.max() }),
    [scope],
  );
}

// ---- the list ---------------------------------------------------------------------------------------

/**
 * The rendered rows (see messageListModel.ts): messages plus day/NEW/E2EE dividers, intro and
 * history edges, oldest first - or newest first with `inverted` for an inverted FlashList.
 * Re-renders on structure changes only.
 */
export function useMessageList(roomId: string, entry: EntrySnapshot, opts: { inverted?: boolean } = {}): MessageListModel {
  const inverted = opts.inverted === true;
  return useDerived(
    `msgList:${roomId}:${entry.lastReadMessageId ?? ''}:${entry.maxMessageIdWhenEntered ?? ''}:${inverted ? 1 : 0}`,
    () => {
      const blocked = new Set(relationships.relationships.filter((r) => r.type === RelType.Blocked).map((r) => r.user.id));
      const model = buildMessageList({
        messages: (messages.byRoom[roomId] ?? []).map((m) => ({
          id: m.id,
          sender_id: m.sender_id,
          created_at: m.created_at,
          ...(m.reply_to_id ? { reply_to_id: m.reply_to_id } : {}),
          ...(m.system_type ? { system_type: m.system_type } : {}),
          ...(m.notEncrypted ? { notEncrypted: true } : {}),
          ...(m.pending ? { pending: true } : {}),
          ...(m.mention_everyone ? { mention_everyone: true } : {}),
          ...(m.mentions?.length ? { mentions: [...m.mentions] } : {}),
        })),
        currentUserId: auth.user?.id ?? null,
        isBlocked: (id) => blocked.has(id),
        lastReadMessageId: entry.lastReadMessageId,
        maxMessageIdWhenEntered: entry.maxMessageIdWhenEntered,
        newHeaderDismissed: newHeaderDismissed.byRoom[roomId] === true,
        hasMoreOlder: messages.hasMoreOlder[roomId],
        hasMoreNewer: messages.hasMoreNewer[roomId],
      });
      return inverted ? { ...model, items: [...model.items].reverse() } : model;
    },
    deepEqual,
  );
}

/** Whether the NEW divider / banner were dismissed this visit (own send, Mark as read). */
export function useNewHeaderDismissed(roomId: string): boolean {
  return useDerived(`newHeaderDismissed:${roomId}`, () => newHeaderDismissed.byRoom[roomId] === true);
}

/**
 * "N new messages since TIME" (getUnreadBannerInfo), or null. Shown only while the list is
 * scrolled away from the bottom (`nearBottom` false) and the header isn't dismissed; `capped`
 * means render the count as "N+".
 */
export function useUnreadBanner(roomId: string, entry: EntrySnapshot, nearBottom: boolean): UnreadBannerInfo | null {
  return useDerived(
    `unreadBanner:${roomId}:${entry.lastReadMessageId ?? ''}:${entry.maxMessageIdWhenEntered ?? ''}:${nearBottom ? 1 : 0}`,
    () => {
      if (newHeaderDismissed.byRoom[roomId] || nearBottom) return null;
      const uid = auth.user?.id;
      if (!uid) return null;
      const list = (messages.byRoom[roomId] ?? []).map((m) => ({ id: m.id, sender_id: m.sender_id, created_at: m.created_at }));
      return getUnreadBannerInfo(list, entry.lastReadMessageId, entry.maxMessageIdWhenEntered, uid, messages.hasMoreOlder[roomId] ?? false);
    },
    deepEqual,
  );
}

/** The newest loaded real message - what the banner's Mark as read acks to. */
export function newestLoadedMessageId(roomId: string): string | null {
  return largestSnowflake(messages.byRoom[roomId] ?? []);
}

// ---- reply line ---------------------------------------------------------------------------------------

/** The people a room's message text can mention: its PM participants or its space's members,
 * plus everyone embedded on its loaded messages (augmentParticipants). */
export function roomParticipantPool(roomId: string): RoomParticipant[] {
  const spaceId = spaceIdOfRoom(roomId);
  const base = spaceId
    ? (spaceMembers.bySpaceId[spaceId] ?? [])
    : (rooms.rooms.find((r) => r.id === roomId)?.participants ?? []);
  return augmentParticipants(base, messages.byRoom[roomId] ?? []);
}

export type ReplyReferenceView =
  | { state: 'missing'; replyToId: string }
  | {
      state: 'found';
      replyToId: string;
      /** In the loaded window (a tap scrolls) vs only the server's embedded copy (a tap loads
       * a window around it - jumpToMessage handles both). */
      loaded: boolean;
      authorId: string;
      authorName: string;
      authorAvatar?: string;
      authorBot: boolean;
      /** One line, mentions resolved, markdown stripped, max 90 chars; '' = "(no text)". In
       * an E2EE room the embedded copy is ciphertext, so it reads as the loading placeholder. */
      preview: string;
    };

export function replyReferenceView(roomId: string, replyToId: string, embedded: DecryptedMessage | undefined): ReplyReferenceView {
  const loaded = messages.byRoom[roomId]?.find((m) => m.id === replyToId);
  const replied = loaded ?? embedded;
  if (!replied) return { state: 'missing', replyToId };
  const pool = roomParticipantPool(roomId);
  const me = auth.user?.id;
  const sender = getSenderDisplay(replied.sender_id, pool, me);
  return {
    state: 'found',
    replyToId,
    loaded: !!loaded,
    authorId: replied.sender_id,
    authorName: sender.name,
    ...(sender.avatar ? { authorAvatar: sender.avatar } : {}),
    authorBot: sender.bot === true,
    preview: messagePreviewText(getMessageBodyText(replied), pool, me, 90),
  };
}

/** The "replying to…" line of a message (undefined when it is not a reply). */
export function useReplyReference(roomId: string, messageId: string): ReplyReferenceView | undefined {
  return useDerived(
    `replyRef:${roomId}:${messageId}`,
    () => {
      const msg = messages.byRoom[roomId]?.find((m) => m.id === messageId);
      if (!msg?.reply_to_id) return undefined;
      return replyReferenceView(roomId, msg.reply_to_id, msg.referenced_message as DecryptedMessage | undefined);
    },
    deepEqual,
  );
}

/**
 * Load a room's history the first time it is shown, as the room pages do: the tail when
 * nothing is cached (unless a jump is already loading a window around its target), and mark a
 * cached room as possibly having older history. Mount on the conversation screen.
 */
export function useEnsureRoomHistory(roomId: string): void {
  useEffect(() => {
    const cached = messages.byRoom[roomId];
    if (cached === undefined) {
      if (hasPendingJump(roomId)) return;
      void loadMessages(roomId);
      return;
    }
    if (cached.length > 0 && messages.hasMoreOlder[roomId] === undefined) setMessages('hasMoreOlder', roomId, true);
  }, [roomId]);
}
