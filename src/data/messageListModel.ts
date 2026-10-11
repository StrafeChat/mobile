/**
 * The message list's rows - MessageListView's grouping and divider rules, pure.
 *
 * The web computes these inline while rendering (shouldShowHeader, shouldShowDateHeader,
 * isFirstUnreadMessage, e2eeHeaderIndices); a virtualised RN list wants them as data instead:
 * one flat array where every divider is a row of its own, so FlashList can recycle and measure
 * them like anything else. The rules are unchanged:
 *
 *  - Messages from people you blocked are not rendered (and so take no part in grouping).
 *  - A row starts a new group (avatar + name) when it is a reply, the first row, from a
 *    different sender than the row above, or more than 5 minutes after it.
 *  - A day divider precedes the first row and every row on a new local calendar day.
 *  - The NEW divider sits above the first message that was already unread on entry: from
 *    someone else, a real id newer than the entry read cursor (any, with no cursor) and not
 *    newer than the newest id loaded on entry - messages that arrive while you watch never
 *    count. Hidden once dismissed (your own send, Mark as read). On the same row as a day
 *    divider the two merge into one ("New messages · date").
 *  - E2EE transitions, skipping optimistic and system rows: "no longer encrypted" at the
 *    first plaintext message after encrypted history (never for a room that was always
 *    plain), "now encrypted" at the first encrypted one after plaintext.
 *  - The intro shows once history is exhausted (or the room is empty); history edges stand
 *    in for the pages still to load at either end.
 *
 * Deliberate difference: the web finds the first-unread and E2EE rows by index into the raw
 * list but renders the blocked-filtered one, so a blocked user's message can shift them by a
 * row; here both are found among the rows actually shown.
 */
import { messageIdGt } from '@web/stores/readState';
import { isSnowflakeId } from './constants';

export const MESSAGE_GROUP_THRESHOLD_MS = 5 * 60 * 1000;

/** The fields of a message the list structure depends on (a DecryptedMessage has them all). */
export interface ListMessage {
  id: string;
  sender_id: string;
  created_at: string;
  reply_to_id?: string;
  system_type?: string;
  notEncrypted?: boolean;
  pending?: boolean;
  mention_everyone?: boolean;
  mentions?: string[];
}

export type MessageListItem =
  | { kind: 'intro'; key: 'intro' }
  | { kind: 'historyEdge'; key: 'edge:older' | 'edge:newer'; side: 'older' | 'newer' }
  /** `newMessages`: the NEW divider merged in ("New messages · date"). `date` is the row's created_at. */
  | { kind: 'dateDivider'; key: string; date: string; newMessages: boolean }
  | { kind: 'newDivider'; key: string }
  | { kind: 'e2eeDivider'; key: string; encrypted: boolean }
  | {
      kind: 'message';
      key: string;
      id: string;
      senderId: string;
      /** Avatar + name; false for a continuation pulled tight under the row above. */
      showHeader: boolean;
      /** A header row that is not the first row (takes the group spacing above it). */
      groupStart: boolean;
      /** @everyone/@here or a direct mention of the viewer (tint + left bar). */
      mentionsMe: boolean;
      system: boolean;
      pending: boolean;
    };

export interface BuildMessageListInput {
  /** Oldest first, as stores/messages keeps them. */
  messages: readonly ListMessage[];
  currentUserId: string | null;
  isBlocked: (userId: string) => boolean;
  /** The read cursor frozen on entry (see useEntrySnapshot). */
  lastReadMessageId: string | null;
  /** The newest id loaded on entry; null until the first rows arrive. */
  maxMessageIdWhenEntered: string | null;
  newHeaderDismissed: boolean;
  hasMoreOlder: boolean | undefined;
  hasMoreNewer: boolean | undefined;
  /**
   * The list key of a message row (and of the dividers attached to it); its id when absent.
   * Pass stableRowKeys' map so a sent message keeps its optimistic row's key.
   */
  rowKeys?: ReadonlyMap<string, string>;
}

const TEMP_PREFIX = 'temp-';

/** Per room: the row key of every message in the last list built for it. */
const rowKeysByRoom = new Map<string, Map<string, string>>();

/**
 * Row keys that survive a send. stores/messages swaps an optimistic message (id
 * `temp-...`) for the server's copy in place - a new id, the same row - and a list keyed by
 * id unmounts the row and mounts another: the bubble flickers, its images reload and a
 * playing voice clip stops. Here a confirmed message of yours that appears in the same
 * update as one of your optimistic rows disappears takes over that row's key (paired
 * oldest first, as the store replaces them). A failed send only removes its row, so nothing
 * inherits from it. Every other row is keyed by its id.
 */
export function stableRowKeys(roomId: string, list: readonly ListMessage[], currentUserId: string | null): Map<string, string> {
  const prev = rowKeysByRoom.get(roomId);
  const next = new Map<string, string>();
  if (list.length === 0) {
    rowKeysByRoom.delete(roomId);
    return next;
  }
  let vanished: string[] = [];
  if (prev) {
    const present = new Set(list.map((m) => m.id));
    for (const [id, key] of prev) if (id.startsWith(TEMP_PREFIX) && !present.has(id)) vanished.push(key);
  }
  for (const m of list) {
    const known = prev?.get(m.id);
    if (known !== undefined) next.set(m.id, known);
    else if (vanished.length > 0 && currentUserId !== null && m.sender_id === currentUserId && !m.id.startsWith(TEMP_PREFIX)) {
      next.set(m.id, vanished[0]!);
      vanished = vanished.slice(1);
    } else next.set(m.id, m.id);
  }
  rowKeysByRoom.set(roomId, next);
  return next;
}

export function shouldShowHeader(msg: ListMessage, prev: ListMessage | undefined): boolean {
  if (msg.reply_to_id) return true;
  if (!prev) return true;
  if (prev.sender_id !== msg.sender_id) return true;
  return new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime() > MESSAGE_GROUP_THRESHOLD_MS;
}

export function shouldShowDateHeader(msg: ListMessage, prev: ListMessage | undefined): boolean {
  if (!prev) return true;
  return new Date(prev.created_at).toDateString() !== new Date(msg.created_at).toDateString();
}

/** Whether a message pings the viewer - the server-authoritative mention_everyone / mentions
 * (which include the author's own id when they @mention themselves). */
export function mentionsUser(msg: ListMessage, userId: string | null): boolean {
  if (!userId) return false;
  if (msg.mention_everyone === true) return true;
  return msg.mentions?.some((m) => String(m) === userId) ?? false;
}

/** Index of the first message that was unread on entry, or -1 (also when dismissed). */
export function firstUnreadIndex(
  list: readonly ListMessage[],
  opts: { currentUserId: string | null; lastReadMessageId: string | null; maxMessageIdWhenEntered: string | null; dismissed: boolean },
): number {
  if (opts.dismissed) return -1;
  for (let i = 0; i < list.length; i++) {
    const m = list[i]!;
    if (m.sender_id === opts.currentUserId || !isSnowflakeId(m.id)) continue;
    if (opts.maxMessageIdWhenEntered != null && messageIdGt(m.id, opts.maxMessageIdWhenEntered)) continue;
    if (opts.lastReadMessageId == null || messageIdGt(m.id, opts.lastReadMessageId)) return i;
  }
  return -1;
}

/** Where the encryption notices go (indices into `list`, -1 for none). */
export function e2eeDividerIndices(list: readonly ListMessage[]): { firstPlaintext: number; firstEncryptedAfterPlaintext: number } {
  let firstPlaintext = -1;
  let firstEncryptedAfterPlaintext = -1;
  let seenPlaintext = false;
  let seenEncrypted = false;
  for (let i = 0; i < list.length; i++) {
    const m = list[i]!;
    if (m.id.startsWith('temp-') || m.system_type) continue;
    if (m.notEncrypted === true) {
      if (firstPlaintext < 0 && seenEncrypted) firstPlaintext = i;
      seenPlaintext = true;
      continue;
    }
    seenEncrypted = true;
    if (seenPlaintext && firstEncryptedAfterPlaintext < 0) firstEncryptedAfterPlaintext = i;
  }
  return { firstPlaintext, firstEncryptedAfterPlaintext };
}

export interface MessageListModel {
  /** Oldest first. Reverse it for an inverted list (or ask useMessageListItems to). */
  items: MessageListItem[];
  /** The message the NEW divider sits above - where landing scrolls on first view. */
  firstUnreadId: string | null;
  /** Ids of the rendered messages, oldest first (blocked senders removed). */
  visibleIds: string[];
}

export function buildMessageList(input: BuildMessageListInput): MessageListModel {
  const all = input.messages;
  const visible = all.filter((m) => !input.isBlocked(m.sender_id));
  const items: MessageListItem[] = [];

  const hasMoreOlder = input.hasMoreOlder ?? true;
  if (all.length === 0 || !hasMoreOlder) items.push({ kind: 'intro', key: 'intro' });
  if (all.length > 0 && hasMoreOlder) items.push({ kind: 'historyEdge', key: 'edge:older', side: 'older' });

  const unreadIdx = firstUnreadIndex(visible, {
    currentUserId: input.currentUserId,
    lastReadMessageId: input.lastReadMessageId,
    maxMessageIdWhenEntered: input.maxMessageIdWhenEntered,
    dismissed: input.newHeaderDismissed,
  });
  const { firstPlaintext, firstEncryptedAfterPlaintext } = e2eeDividerIndices(visible);

  for (let i = 0; i < visible.length; i++) {
    const msg = visible[i]!;
    const prev = i > 0 ? visible[i - 1] : undefined;
    const key = input.rowKeys?.get(msg.id) ?? msg.id;
    const isUnread = i === unreadIdx;
    const isNewDay = shouldShowDateHeader(msg, prev);
    if (isNewDay) items.push({ kind: 'dateDivider', key: `d:${key}`, date: msg.created_at, newMessages: isUnread });
    else if (isUnread) items.push({ kind: 'newDivider', key: `n:${key}` });
    if (i === firstPlaintext) items.push({ kind: 'e2eeDivider', key: `p:${key}`, encrypted: false });
    if (i === firstEncryptedAfterPlaintext) items.push({ kind: 'e2eeDivider', key: `e:${key}`, encrypted: true });
    const showHeader = shouldShowHeader(msg, prev);
    items.push({
      kind: 'message',
      key,
      id: msg.id,
      senderId: msg.sender_id,
      showHeader,
      groupStart: showHeader && !!prev,
      mentionsMe: mentionsUser(msg, input.currentUserId),
      system: !!msg.system_type,
      pending: msg.pending === true,
    });
  }

  if (all.length > 0 && (input.hasMoreNewer ?? false)) {
    items.push({ kind: 'historyEdge', key: 'edge:newer', side: 'newer' });
  }

  return {
    items,
    firstUnreadId: unreadIdx >= 0 ? visible[unreadIdx]!.id : null,
    visibleIds: visible.map((m) => m.id),
  };
}

/** A message body that is a decrypt-state placeholder, not content (rendered muted/italic). */
export function isPlaceholderBody(m: { decryptPending?: boolean; decryptError?: boolean; legacyUndecryptable?: boolean }): boolean {
  return !!(m.decryptPending || m.decryptError || m.legacyUndecryptable);
}
