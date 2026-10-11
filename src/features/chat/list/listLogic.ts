/**
 * The message list's scroll decisions, pure (MessageListView's land / applyJump / rowFor /
 * publishBottomVisible / maybeLoadEdges rules), so they are testable without a list on screen.
 */
import { messageIdGt } from '@web/stores/readState';
import type { SavedScrollPosition } from '@web/lib/scrollPositions';
import type { MessageListItem } from '@/data';

export type MessageItem = Extract<MessageListItem, { kind: 'message' }>;
export type DividerItem = Extract<MessageListItem, { kind: 'dateDivider' | 'newDivider' | 'e2eeDivider' }>;

/**
 * One FlashList row: a message together with the dividers above it, or the intro.
 *
 * Why not one row per divider and the history edges as rows, as the model hands them over:
 * FlashList keeps the reader still across a prepended page by anchoring on the *first visible
 * row's key*. Anchored on the top history edge (whose key never changes and whose position
 * never moves - the page goes in below it) or on a day divider (keyed by the message under it,
 * gone once an older same-day message arrives), the correction is zero or lost, the reader is
 * left at the top, and the next page loads, and the next: the list paged itself back to the
 * room's first message. Folded like this, the top row is always a message keyed by its own id
 * (stable across pages); the edges are the list's header and footer, outside the data.
 */
export type ListRow = { kind: 'intro'; key: 'intro' } | { kind: 'message'; key: string; id: string; item: MessageItem; dividers: DividerItem[] };

export interface ListRows {
  rows: ListRow[];
  /** More history above the loaded window: the header skeleton. */
  olderEdge: boolean;
  /** A jumped-to window with newer messages below it: the footer skeleton. */
  newerEdge: boolean;
}

/** The model's items as list rows (see ListRow). Dividers after the last message are dropped. */
export function buildRows(items: readonly MessageListItem[]): ListRows {
  const rows: ListRow[] = [];
  let olderEdge = false;
  let newerEdge = false;
  let pending: DividerItem[] = [];
  for (const it of items) {
    switch (it.kind) {
      case 'intro':
        rows.push(it);
        break;
      case 'historyEdge':
        if (it.side === 'older') olderEdge = true;
        else newerEdge = true;
        break;
      case 'message':
        rows.push({ kind: 'message', key: it.key, id: it.id, item: it, dividers: pending });
        pending = [];
        break;
      default:
        pending.push(it);
    }
  }
  return { rows, olderEdge, newerEdge };
}

function sameDivider(a: DividerItem, b: DividerItem): boolean {
  if (a.key !== b.key || a.kind !== b.kind) return false;
  if (a.kind === 'dateDivider' && b.kind === 'dateDivider') return a.newMessages === b.newMessages && a.date === b.date;
  if (a.kind === 'e2eeDivider' && b.kind === 'e2eeDivider') return a.encrypted === b.encrypted;
  return true;
}

/** Equal as far as a row's rendering goes. Every structural change of the list hands over all
 * new objects; comparing by value keeps the rows that did not change from re-rendering. */
export function sameMessageItem(a: MessageItem, b: MessageItem): boolean {
  return (
    a.id === b.id &&
    a.senderId === b.senderId &&
    a.showHeader === b.showHeader &&
    a.groupStart === b.groupStart &&
    a.mentionsMe === b.mentionsMe &&
    a.system === b.system &&
    a.pending === b.pending
  );
}

export function sameRow(a: ListRow, b: ListRow): boolean {
  if (a === b) return true;
  if (a.kind !== 'message' || b.kind !== 'message') return a.kind === b.kind;
  if (!sameMessageItem(a.item, b.item) || a.dividers.length !== b.dividers.length) return false;
  return a.dividers.every((d, i) => sameDivider(d, b.dividers[i]!));
}

/** What the index helpers need of a row (a ListRow, or a model item in tests). */
type RowLike = { kind: string; id?: string; key?: string };

/** "At the bottom" within this many px (the web's BOTTOM_THRESHOLD_PX). */
export const BOTTOM_THRESHOLD_PX = 24;
/** Page the next batch in once the loaded edge is this close (EDGE_LOAD_MARGIN_PX). */
export const EDGE_LOAD_MARGIN_PX = 400;
/** How long a jump waits for its row before settling on the nearest one. */
export const JUMP_ROW_WAIT_MS = 2000;
/** A scroll is the user's until it has been idle this long. */
export const USER_SCROLL_IDLE_MS = 120;
/** Viewport ack debounce (ACK_VISIBILITY_DEBOUNCE_MS). */
export const ACK_DEBOUNCE_MS = 450;
/** The first-unread row lands this far below the top on a room's first view. */
export const UNREAD_LANDING_OFFSET = 96;
/** The bottom landing re-snaps after this, as late layout settles. */
export const SETTLE_DELAY_MS = 100;
/**
 * How long after a landing or a page the edges are looked at again: past the list's own
 * anchoring correction, which it applies on the next layout and during which it mutes its
 * scroll events for 100 ms.
 */
export const PAGE_SETTLE_MS = 250;

const SNOWFLAKE = /^\d+$/;

/** Index of a message row in the list items, or -1. */
export function indexOfMessage(items: readonly RowLike[], id: string): number {
  return items.findIndex((it) => it.kind === 'message' && it.id === id);
}

/**
 * The row a jump to `id` lands on: the message itself, else (deleted, blocked, filtered) the
 * next newer one, else the last message (web: rowFor). Null when there are no messages.
 */
export function resolveJumpRow(items: readonly RowLike[], id: string): { index: number; id: string; exact: boolean } | null {
  let last: { index: number; id: string } | null = null;
  let after: { index: number; id: string } | null = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.kind !== 'message' || it.id === undefined) continue;
    if (it.id === id) return { index: i, id, exact: true };
    if (!after && SNOWFLAKE.test(it.id) && messageIdGt(it.id, id)) after = { index: i, id: it.id };
    last = { index: i, id: it.id };
  }
  const hit = after ?? last;
  return hit ? { ...hit, exact: false } : null;
}

export type Landing =
  | { kind: 'jump'; targetId: string }
  | { kind: 'saved'; index: number; top: number }
  | { kind: 'unread'; index: number }
  | { kind: 'bottom' };

/**
 * Where a room lands when its rows first show (web: land()): a pending jump; else the saved
 * position for this room this session, when it was not at the bottom and its row is loaded;
 * else, the first time the room is shown this session, the first unread row; else the bottom.
 */
export function chooseLanding(input: {
  items: readonly RowLike[];
  jumpTargetId: string | null;
  saved: SavedScrollPosition | undefined;
  firstView: boolean;
  firstUnreadId: string | null;
}): Landing {
  if (input.jumpTargetId) return { kind: 'jump', targetId: input.jumpTargetId };
  const saved = input.saved;
  if (saved && !saved.atBottom && saved.anchorId) {
    const index = indexOfMessage(input.items, saved.anchorId);
    if (index >= 0) return { kind: 'saved', index, top: saved.top };
  }
  if (input.firstView && input.firstUnreadId) {
    const index = indexOfMessage(input.items, input.firstUnreadId);
    if (index >= 0) return { kind: 'unread', index };
  }
  return { kind: 'bottom' };
}

export function distanceToBottom(contentHeight: number, offset: number, viewportHeight: number): number {
  return contentHeight - offset - viewportHeight;
}

export interface ViewTokenLike {
  index: number | null;
  isViewable: boolean;
  item: RowLike;
}

/** The bottom-most visible real message - the read cursor's target (web: publishBottomVisible). */
export function bottomVisibleMessageId(tokens: readonly ViewTokenLike[]): string | null {
  let best: { index: number; id: string } | null = null;
  for (const tok of tokens) {
    if (!tok.isViewable || tok.index == null) continue;
    const it = tok.item;
    if (it.kind !== 'message' || it.id === undefined || !SNOWFLAKE.test(it.id)) continue;
    if (!best || tok.index > best.index) best = { index: tok.index, id: it.id };
  }
  return best?.id ?? null;
}

/** The top-most visible message row (the anchor a position is remembered by). */
export function topVisibleMessage(tokens: readonly ViewTokenLike[]): { index: number; id: string } | null {
  let best: { index: number; id: string } | null = null;
  for (const tok of tokens) {
    if (!tok.isViewable || tok.index == null) continue;
    const it = tok.item;
    if (it.kind !== 'message' || it.id === undefined) continue;
    if (!best || tok.index < best.index) best = { index: tok.index, id: it.id };
  }
  return best;
}

/** A check that is not the reader's own scroll pages in at most this many pages in a row. */
export const MAX_UNPROMPTED_PAGES = 1;

/**
 * Which edges to page in (web: maybeLoadEdges / the sentinels' observers).
 *
 * `source` says what asked: 'scroll' is the reader's own drag or fling; 'settle' is
 * everything else - the check after landing, after a page arrived, a scroll event the list
 * made itself. A settle check that would page again after `unprompted` pages already loaded
 * without the reader touching the list only goes ahead while the list is too short to scroll
 * past the margin (it has to fill the screen somehow). That is the backstop for the runaway
 * where a list that failed to keep its place after a prepend kept reading "near the top" and
 * paged itself back to the room's first message, one request every couple of seconds.
 *
 * Nothing pages while the list is unmeasured (offset 0 on a list with no layout reads as "at
 * the top") or while a landing / jump / snap is still moving it (scrollToIndex walks through
 * projected offsets on its way).
 */
export function edgesToLoad(input: {
  offset: number;
  distanceToBottom: number;
  /** Viewport and content heights; 0 = not measured yet. */
  viewport: number;
  content: number;
  hasMessages: boolean;
  hasMoreOlder: boolean | undefined;
  loadingOlder: boolean;
  hasMoreNewer: boolean;
  loadingNewer: boolean;
  /** A programmatic scroll is still in flight. */
  moving: boolean;
  source: 'scroll' | 'settle';
  /** Pages loaded by settle checks since the reader last scrolled. */
  unprompted: number;
}): { older: boolean; newer: boolean } {
  const none = { older: false, newer: false };
  if (!input.hasMessages || input.moving || input.viewport <= 0 || input.content <= 0) return none;
  if (input.source === 'settle' && input.unprompted >= MAX_UNPROMPTED_PAGES && input.content - input.viewport >= EDGE_LOAD_MARGIN_PX) {
    return none;
  }
  return {
    older: (input.hasMoreOlder ?? true) && !input.loadingOlder && input.offset < EDGE_LOAD_MARGIN_PX,
    newer: input.hasMoreNewer && !input.loadingNewer && input.distanceToBottom < EDGE_LOAD_MARGIN_PX,
  };
}

/** FlashList recycling pools: one per row shape. */
export function itemType(row: ListRow): string {
  if (row.kind !== 'message') return row.kind;
  if (row.item.system) return 'system';
  return row.item.showHeader ? 'message' : 'continuation';
}
