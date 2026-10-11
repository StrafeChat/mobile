/**
 * The message list's scroll decisions, pure (MessageListView's land / applyJump / rowFor /
 * publishBottomVisible rules), so they are testable without a list on screen.
 */
import { messageIdGt } from '@web/stores/readState';
import type { SavedScrollPosition } from '@web/lib/scrollPositions';
import type { MessageListItem } from '@/data';

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

const SNOWFLAKE = /^\d+$/;

/** Index of a message row in the list items, or -1. */
export function indexOfMessage(items: readonly MessageListItem[], id: string): number {
  return items.findIndex((it) => it.kind === 'message' && it.id === id);
}

/**
 * The row a jump to `id` lands on: the message itself, else (deleted, blocked, filtered) the
 * next newer one, else the last message (web: rowFor). Null when there are no messages.
 */
export function resolveJumpRow(items: readonly MessageListItem[], id: string): { index: number; id: string; exact: boolean } | null {
  let last: { index: number; id: string } | null = null;
  let after: { index: number; id: string } | null = null;
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    if (it.kind !== 'message') continue;
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
  items: readonly MessageListItem[];
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
  item: MessageListItem;
}

/** The bottom-most visible real message - the read cursor's target (web: publishBottomVisible). */
export function bottomVisibleMessageId(tokens: readonly ViewTokenLike[]): string | null {
  let best: { index: number; id: string } | null = null;
  for (const tok of tokens) {
    if (!tok.isViewable || tok.index == null) continue;
    const it = tok.item;
    if (it.kind !== 'message' || !SNOWFLAKE.test(it.id)) continue;
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
    if (it.kind !== 'message') continue;
    if (!best || tok.index < best.index) best = { index: tok.index, id: it.id };
  }
  return best;
}

/** Which edges to page in from a scroll position (web: maybeLoadEdges). */
export function edgesToLoad(input: {
  offset: number;
  distanceToBottom: number;
  hasMessages: boolean;
  hasMoreOlder: boolean | undefined;
  loadingOlder: boolean;
  hasMoreNewer: boolean;
  loadingNewer: boolean;
}): { older: boolean; newer: boolean } {
  if (!input.hasMessages) return { older: false, newer: false };
  return {
    older: (input.hasMoreOlder ?? true) && !input.loadingOlder && input.offset < EDGE_LOAD_MARGIN_PX,
    newer: input.hasMoreNewer && !input.loadingNewer && input.distanceToBottom < EDGE_LOAD_MARGIN_PX,
  };
}

/** FlashList recycling pools: one per row shape. */
export function itemType(item: MessageListItem): string {
  if (item.kind !== 'message') return item.kind;
  if (item.system) return 'system';
  return item.showHeader ? 'message' : 'continuation';
}
