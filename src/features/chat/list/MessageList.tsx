/**
 * The conversation's message list - the web's MessageListView behaviours on a FlashList v2.
 *
 * Why FlashList v2, not inverted: v2 has no `inverted` and does chat natively - rows oldest
 * first, `startRenderingFromBottom` for the initial bottom, and maintainVisibleContentPosition
 * (on by default) keeping the reader's row still while older pages are prepended. That is the
 * web's scroll anchoring without measuring anything ourselves.
 *
 * Behaviour, as the web:
 * - entry: enterRoom() registers the view (the store then never trims an on-screen room) and
 *   leave() on exit hands it the position, which shrinks the cache around it and is
 *   remembered for the next landing;
 * - landing, once per entry as soon as rows exist: a pending jump (centred, flashed) > the
 *   saved position for this session (not at bottom) > the first unread row on the room's
 *   first view, 96 px from the top > the bottom (the only landing that follows new messages).
 *   The list stays invisible until it has landed, so it never visibly jumps. Until the
 *   session has hydrated the read cursor is unknown (everything would read as unread), so
 *   such an early landing goes to the bottom and leaves the first-view landing for later;
 * - following: only a user scroll turns "stick to bottom" on (ending within 24 px of it) or off.
 *   A live message follows only while sticking and not mid-scroll; the viewer's own send and
 *   "jump to present" always go to the bottom; content growing (images, previews) re-pins;
 * - paging: within 400 px of either loaded edge the next page loads (older always, newer only
 *   in a jumped-to window); skeleton groups stand in past the edge meanwhile, as the list's
 *   header / footer (never as rows: see ListRow for why the anchoring needs that). The
 *   position is read from the list itself, which knows about its own anchoring corrections
 *   (its scroll events are muted while it makes them), and nothing pages while unmeasured or
 *   mid-landing; a check the reader did not prompt pages at most once (edgesToLoad);
 * - jumps while in the room (a reply, a pin, a search hit): consumed, polled up to 2 s for the
 *   row (the nearest newer one if it's gone), centred, smooth only if already loaded;
 * - "You're viewing older messages / Jump to present" while the window isn't the live tail;
 *   otherwise a jump-to-bottom button once scrolled away;
 * - the unread banner ("N new messages since…", Mark As Read) while away from the bottom;
 * - the read cursor follows the bottom-most visible message (lib/viewportAck, 450 ms).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import { formatDate, t } from '@web/i18n/t';
import { jumpToPresent, loadNewerMessages, loadOlderMessages, messages as messageStore } from '@web/stores/messages';
import { recallScrollPosition } from '@web/lib/scrollPositions';
import { auth } from '@web/stores/auth';
import { ackRoomOptimistic } from '@web/stores/readState';
import { dismissNewHeader } from '@web/stores/newHeaderDismissed';
import {
  newestLoadedMessageId,
  takeJumpTarget,
  useEnsureRoomHistory,
  useEntrySnapshot,
  useJumpTarget,
  useLinkPreviewsAllowed,
  useMessageList,
  useMessagePaging,
  useRoomGates,
  useScrollSignals,
  useSettings,
  useUnreadBanner,
} from '@/data';
import { useSolid } from '@/bridge/solid';
import { enterRoom, spaceIdOfRoom, type RoomEntry } from '@/platform/rooms';
import { createRoomViewportAck } from '@/platform/overrides/lib/viewportAck';
import { useTheme } from '@/theme';
import { Button, dismissKeyboard, EmptyState, ErrorBoundary, haptics, Icon, Text, Touchable, withAlpha } from '@/ui';
import { DeleteMessageHost } from '../actions/DeleteMessageSheet';
import { flashMessage } from '../flash';
import { ReactionPickerHost } from '../reactions/ReactionPicker';
import { DateDivider, E2eeDivider, HistoryEdge, ListIntro, NewDivider } from '../row/ListPieces';
import { MessageRow } from '../row/MessageRow';
import { RoomSkeleton } from '../row/Skeletons';
import { ListContext, type ListContextValue } from '../row/listContext';
import {
  ACK_DEBOUNCE_MS,
  BOTTOM_THRESHOLD_PX,
  JUMP_ROW_WAIT_MS,
  PAGE_SETTLE_MS,
  SETTLE_DELAY_MS,
  UNREAD_LANDING_OFFSET,
  USER_SCROLL_IDLE_MS,
  bottomVisibleMessageId,
  buildRows,
  chooseLanding,
  distanceToBottom,
  edgesToLoad,
  indexOfMessage,
  itemType,
  resolveJumpRow,
  sameRow,
  topVisibleMessage,
  type DividerItem,
  type ListRow,
  type ViewTokenLike,
} from './listLogic';
import { safeRecomputeViewableItems, safeScrollToEnd, safeScrollToIndex } from './safeList';

/** Rooms whose first-view landing (on the first unread) has happened this session. */
const roomsWithInitialScrollDone = new Set<string>();
/** The list reveals itself (landing as best it can) if its onLoad has not come by then. */
const LAND_FALLBACK_MS = 1200;

export interface MessageListProps {
  roomId: string;
  /** null for a PM / group; omit to look the space up from the loaded room lists. */
  spaceId?: string | null;
}

/**
 * One list per room: a different room is a fresh list (its own landing, its own entry). A
 * render error inside it remounts just the list, which re-enters the room and lands again
 * (on the position it left with), instead of taking the conversation or the app down.
 */
export function MessageList(props: MessageListProps) {
  return (
    <ErrorBoundary key={props.roomId} name="message-list">
      <RoomMessageList {...props} />
    </ErrorBoundary>
  );
}

function Divider({ item }: { item: DividerItem }) {
  switch (item.kind) {
    case 'dateDivider':
      return <DateDivider date={item.date} newMessages={item.newMessages} />;
    case 'newDivider':
      return <NewDivider />;
    default:
      return <E2eeDivider encrypted={item.encrypted} />;
  }
}

/** A message and the dividers above it (one FlashList row; see ListRow). */
const MessageListRow = memo(
  function MessageListRow({ row }: { row: Extract<ListRow, { kind: 'message' }> }) {
    return (
      <>
        {row.dividers.map((d) => (
          <Divider key={d.key} item={d} />
        ))}
        <MessageRow item={row.item} />
      </>
    );
  },
  (a, b) => sameRow(a.row, b.row),
);

function renderItem({ item }: ListRenderItemInfo<ListRow>) {
  return item.kind === 'intro' ? <ListIntro /> : <MessageListRow row={item} />;
}

const keyExtractor = (item: ListRow) => item.key;
const OLDER_EDGE = <HistoryEdge side="older" />;
const NEWER_EDGE = <HistoryEdge side="newer" />;
const viewabilityConfig = { itemVisiblePercentThreshold: 1, minimumViewTime: 0 };
/** Chat mode: first render at the bottom; prepends keep the reader's row still (v2's default). */
const keepPosition = { startRenderingFromBottom: true };

function RoomMessageList({ roomId, spaceId: spaceIdProp }: MessageListProps) {
  const theme = useTheme();
  const spaceId = useSolid(() => (spaceIdProp !== undefined ? spaceIdProp : spaceIdOfRoom(roomId)), [roomId, spaceIdProp]);

  // ---- entry / leave -------------------------------------------------------------------------------
  const position = useRef<{ anchorId: string | null; atBottom: boolean; top?: number } | null>(null);
  useEffect(() => {
    const entry: RoomEntry = enterRoom(roomId, spaceIdProp !== undefined ? { spaceId: spaceIdProp } : {});
    return () => entry.leave(position.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);
  const history = useEnsureRoomHistory(roomId);

  const ack = useRef<ReturnType<typeof createRoomViewportAck> | null>(null);
  useEffect(() => {
    const a = createRoomViewportAck(roomId);
    ack.current = a;
    return () => {
      ack.current = null;
      a.dispose();
    };
  }, [roomId]);

  // ---- data ---------------------------------------------------------------------------------------
  const entrySnap = useEntrySnapshot(roomId);
  const model = useMessageList(roomId, entrySnap);
  const { rows, olderEdge, newerEdge } = useMemo(() => buildRows(model.items), [model.items]);
  const paging = useMessagePaging(roomId);
  const gates = useRoomGates(roomId, spaceId);
  const settings = useSettings();
  const allowLinkPreviews = useLinkPreviewsAllowed(roomId);
  const jump = useJumpTarget(roomId);
  const signals = useScrollSignals(roomId);
  const hydrated = useSolid(() => auth.hydrated);
  const hasMessages = model.visibleIds.length > 0;

  const ctx = useMemo<ListContextValue>(
    () => ({
      roomId,
      spaceId,
      compact: settings.messageCompact === true,
      allowLinkPreviews,
      canReply: gates?.canReply ?? false,
      canReact: gates?.canReact ?? false,
      canJoinReactions: gates?.canJoinReactions ?? false,
      ...(gates?.customEmojiSpaceId ? { customEmojiSpaceId: gates.customEmojiSpaceId } : {}),
      groupSpacing: theme.messageGroupSpacing,
    }),
    [roomId, spaceId, settings.messageCompact, allowLinkPreviews, gates, theme.messageGroupSpacing],
  );

  // ---- scroll state (refs: none of it renders) --------------------------------------------------------
  const listRef = useRef<FlashListRef<ListRow>>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const stick = useRef(true);
  const dragging = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Content and viewport heights (native), and the last offset a scroll event reported. */
  const metrics = useRef({ offset: 0, content: 0, viewport: 0 });
  const [landed, setLanded] = useState(false);
  const landedRef = useRef(false);
  const [nearBottom, setNearBottom] = useState(true);
  const nearRef = useRef(true);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const pagingRef = useRef(paging);
  pagingRef.current = paging;
  const firstUnreadRef = useRef<string | null>(null);
  // Before hydration the frozen read cursor is null and every message reads as unread.
  firstUnreadRef.current = hydrated ? model.firstUnreadId : null;
  const hydratedRef = useRef(hydrated);
  hydratedRef.current = hydrated;
  /** Programmatic scrolls (landing, jump, snap to bottom) still moving the list. */
  const moving = useRef(0);
  /** Pages loaded by checks the reader did not prompt, since their last drag (edgesToLoad). */
  const unprompted = useRef(0);
  const reduceMotion = theme.reduceMotion;

  const updateNear = useCallback((near: boolean) => {
    if (nearRef.current === near) return;
    nearRef.current = near;
    setNearBottom(near);
  }, []);

  /** The list's own offset: it includes the anchoring corrections it applies after a page
   * arrives, during which it mutes its scroll events (so `metrics.offset` would be stale). */
  const readOffset = useCallback((): number => {
    try {
      const o = listRef.current?.getAbsoluteLastScrollOffset?.();
      if (typeof o === 'number' && Number.isFinite(o)) return o;
    } catch {
      /* no layout yet */
    }
    return metrics.current.offset;
  }, []);

  const settleTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  /** Ends the snap's "moving" mark; cancelling the snap must still end it. */
  const settleEnd = useRef<(() => void) | null>(null);
  const cancelSettle = () => {
    for (const tm of settleTimers.current) clearTimeout(tm);
    settleTimers.current = [];
    const end = settleEnd.current;
    settleEnd.current = null;
    end?.();
  };
  useEffect(() => () => {
    cancelSettle();
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  // ---- paging -----------------------------------------------------------------------------------------
  const maybeLoadEdges = useCallback(
    (source: 'scroll' | 'settle') => {
      if (!landedRef.current || !mounted.current) return;
      const m = metrics.current;
      const p = pagingRef.current;
      const offset = readOffset();
      const want = edgesToLoad({
        offset,
        distanceToBottom: distanceToBottom(m.content, offset, m.viewport),
        viewport: m.viewport,
        content: m.content,
        hasMessages: (messageStore.byRoom[roomId]?.length ?? 0) > 0,
        hasMoreOlder: p.hasMoreOlder,
        loadingOlder: p.loadingOlder,
        hasMoreNewer: p.hasMoreNewer,
        loadingNewer: p.loadingNewer,
        moving: moving.current > 0,
        source,
        unprompted: unprompted.current,
      });
      if ((want.older || want.newer) && source === 'settle') unprompted.current += 1;
      if (want.older) void loadOlderMessages(roomId).catch(() => undefined);
      if (want.newer) void loadNewerMessages(roomId).catch(() => undefined);
    },
    [roomId, readOffset],
  );

  // After the landing, and after a page arrived (or the window changed), look again once the
  // list has laid the change out and corrected its position for it.
  const settleCheck = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleEdgeCheck = useCallback(() => {
    if (settleCheck.current) clearTimeout(settleCheck.current);
    settleCheck.current = setTimeout(() => {
      settleCheck.current = null;
      maybeLoadEdges('settle');
    }, PAGE_SETTLE_MS);
  }, [maybeLoadEdges]);
  useEffect(() => () => {
    if (settleCheck.current) clearTimeout(settleCheck.current);
  }, []);
  useEffect(() => {
    if (landed) scheduleEdgeCheck();
  }, [landed, rows.length, paging.loadingOlder, paging.loadingNewer, scheduleEdgeCheck]);

  /** Mark the list as being moved by us until the returned end is called (once); then look
   * at the edges again. */
  const beginMove = useCallback(() => {
    moving.current += 1;
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      moving.current = Math.max(0, moving.current - 1);
      if (mounted.current && landedRef.current) scheduleEdgeCheck();
    };
  }, [scheduleEdgeCheck]);
  const track = useCallback(
    (done: Promise<unknown> | undefined) => {
      const end = beginMove();
      void Promise.resolve(done)
        .catch(() => undefined)
        .finally(end);
    },
    [beginMove],
  );

  /** Snap to the newest row now, then again as late layout (images, previews) settles. */
  const scrollToBottomSettled = useCallback(() => {
    cancelSettle();
    const snap = () => safeScrollToEnd(listRef.current, { animated: false });
    snap();
    const end = beginMove();
    settleEnd.current = end;
    settleTimers.current.push(
      setTimeout(snap, 16),
      setTimeout(() => {
        snap();
        settleEnd.current = null;
        end();
      }, SETTLE_DELAY_MS),
    );
    updateNear(true);
  }, [updateNear, beginMove]);

  /** Remember where the reader is (scroll idle, after ack publishes): the row at the top and its offset. */
  const topRow = useRef<{ index: number; id: string } | null>(null);
  const stashPosition = useCallback(() => {
    if (!landedRef.current) return;
    const top = topRow.current;
    // topRow is from the last viewability report; the rows may have changed since (a jump
    // replaced the window, a page was trimmed, a message was deleted). Look the row up again
    // by id. The reads are caught: this runs from timers, where a throw closes the app.
    const rows = rowsRef.current;
    const at = top ? rows[top.index] : undefined;
    const index = !top ? -1 : at?.kind === 'message' && at.id === top.id ? top.index : rows.findIndex((r) => r.kind === 'message' && r.id === top.id);
    let layout: { y: number } | undefined;
    let first = 0;
    try {
      if (index >= 0) layout = listRef.current?.getLayout(index) ?? undefined;
      first = listRef.current?.getFirstItemOffset() ?? 0;
    } catch {
      layout = undefined;
    }
    position.current = {
      anchorId: top?.id ?? null,
      atBottom: stick.current,
      ...(layout ? { top: Math.round(layout.y + first - readOffset()) } : {}),
    };
  }, [readOffset]);

  // ---- jumps ----------------------------------------------------------------------------------------
  const pendingJump = useRef<{ id: string; smooth: boolean; started: number } | null>(null);
  const [jumpPoll, setJumpPoll] = useState(0);

  const applyJump = useCallback(
    (allowSmooth: boolean): boolean => {
      const pj = pendingJump.current;
      if (!pj) return true;
      const hit = resolveJumpRow(rowsRef.current, pj.id);
      const waited = Date.now() - pj.started;
      if (!hit) {
        // Nothing to land on yet; give up quietly after the wait.
        if (waited < JUMP_ROW_WAIT_MS) return false;
        pendingJump.current = null;
        return true;
      }
      // The exact row may still be on its way (a window that just arrived): wait for it,
      // then settle for the nearest newer one.
      if (!hit.exact && waited < JUMP_ROW_WAIT_MS) return false;
      pendingJump.current = null;
      cancelSettle();
      stick.current = false;
      updateNear(false);
      const animated = allowSmooth && pj.smooth && !reduceMotion;
      track(safeScrollToIndex(listRef.current, { index: hit.index, viewPosition: 0.5, animated }, rowsRef.current.length));
      if (hit.exact) flashMessage(hit.id);
      return true;
    },
    [reduceMotion, track, updateNear],
  );

  // A jump while in the room (reply, pin, search hit, a notification opened over the room);
  // before the landing it is only recorded - the landing takes it first.
  useEffect(() => {
    if (!jump) return;
    takeJumpTarget(roomId);
    pendingJump.current = { id: jump.id, smooth: jump.smooth, started: Date.now() };
    if (landedRef.current) setJumpPoll((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.nonce, jump?.id]);

  // Poll for the jumped-to row (a window that just arrived renders a beat later).
  useEffect(() => {
    if (!landedRef.current || !pendingJump.current) return undefined;
    if (applyJump(true)) return undefined;
    const timer = setTimeout(() => setJumpPoll((n) => n + 1), 100);
    return () => clearTimeout(timer);
  }, [jumpPoll, rows, landed, applyJump]);

  // ---- landing --------------------------------------------------------------------------------------
  /** The landing has started (it runs once per entry); `landedRef` = it has finished. */
  const landingRef = useRef(false);
  const land = useCallback(() => {
    if (landingRef.current) return;
    const list = listRef.current;
    if (!list) return;
    landingRef.current = true;
    const ready = hydratedRef.current;
    const choice = chooseLanding({
      items: rowsRef.current,
      jumpTargetId: pendingJump.current?.id ?? null,
      saved: recallScrollPosition(roomId),
      firstView: ready && !roomsWithInitialScrollDone.has(roomId),
      firstUnreadId: firstUnreadRef.current,
    });
    // As the web: the first view is used up once the landing gets past the jump and the saved
    // position - and only once the read cursor is known.
    if (ready && (choice.kind === 'unread' || choice.kind === 'bottom')) roomsWithInitialScrollDone.add(roomId);
    // Revealed (and acking, paging, following) only once in place.
    const done = () => {
      if (!mounted.current || landedRef.current) return;
      landedRef.current = true;
      setLanded(true);
    };
    switch (choice.kind) {
      case 'jump':
        if (pendingJump.current) pendingJump.current.smooth = false;
        done();
        if (!applyJump(false)) setJumpPoll((n) => n + 1);
        return;
      case 'saved':
        stick.current = false;
        updateNear(false);
        track(safeScrollToIndex(list, { index: choice.index, animated: false, viewOffset: -choice.top }, rowsRef.current.length).finally(done));
        return;
      case 'unread':
        stick.current = false;
        updateNear(false);
        track(safeScrollToIndex(list, { index: choice.index, animated: false, viewOffset: -UNREAD_LANDING_OFFSET }, rowsRef.current.length).finally(done));
        return;
      default:
        stick.current = true;
        scrollToBottomSettled();
        done();
    }
  }, [roomId, applyJump, scrollToBottomSettled, updateNear, track]);

  // Safety net: never leave the list invisible if the list's onLoad is lost. Counted from
  // when the list itself is mounted (not the skeleton), and it still lands properly.
  const showSkeleton = !hasMessages && (paging.loading || !paging.cached);
  useEffect(() => {
    if (landed || showSkeleton) return undefined;
    const timer = setTimeout(() => {
      land();
      if (!landedRef.current) {
        landedRef.current = true;
        setLanded(true);
      }
    }, LAND_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [landed, showSkeleton, land]);

  // ---- following ------------------------------------------------------------------------------------
  const prevTick = useRef(signals.tick);
  useEffect(() => {
    if (signals.tick === prevTick.current) return;
    prevTick.current = signals.tick;
    if (!landedRef.current || !stick.current || dragging.current) return;
    requestAnimationFrame(() => safeScrollToEnd(listRef.current, { animated: !reduceMotion }));
  }, [signals.tick, reduceMotion]);

  const prevForce = useRef(signals.force);
  useEffect(() => {
    if (signals.force === prevForce.current) return;
    prevForce.current = signals.force;
    stick.current = true;
    pendingJump.current = null;
    scrollToBottomSettled();
  }, [signals.force, scrollToBottomSettled]);

  /** Re-pin while following the live bottom; a jumped-to window's bottom is not live (its
   * footer pages newer in, and pinning to it would page on down to the present by itself). */
  const followsLive = useCallback(
    () => landedRef.current && stick.current && !dragging.current && !pendingJump.current && !pagingRef.current.hasMoreNewer,
    [],
  );

  const onContentSizeChange = useCallback(
    (_w: number, h: number) => {
      metrics.current.content = h;
      if (followsLive()) safeScrollToEnd(listRef.current, { animated: false });
    },
    [followsLive],
  );

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    const grew = h !== metrics.current.viewport;
    metrics.current.viewport = h;
    // The keyboard (or a banner) resized the list: keep the newest message in view.
    if (grew && followsLive()) requestAnimationFrame(() => safeScrollToEnd(listRef.current, { animated: false }));
  }, [followsLive]);

  // ---- scroll events ------------------------------------------------------------------------------------
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      metrics.current = { offset: contentOffset.y, content: contentSize.height, viewport: layoutMeasurement.height };
      const near = distanceToBottom(contentSize.height, contentOffset.y, layoutMeasurement.height) <= BOTTOM_THRESHOLD_PX;
      // Only the user's own scrolling starts or stops following the newest message.
      if (dragging.current) stick.current = near;
      updateNear(near);
      maybeLoadEdges(dragging.current ? 'scroll' : 'settle');
    },
    [maybeLoadEdges, updateNear],
  );

  const userScrollStart = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    dragging.current = true;
    unprompted.current = 0;
    cancelSettle();
  }, []);
  const userScrollMaybeEnd = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => {
      idleTimer.current = null;
      dragging.current = false;
      stashPosition();
    }, USER_SCROLL_IDLE_MS);
  }, [stashPosition]);

  // ---- viewport ack ---------------------------------------------------------------------------------------
  const ackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bottomId = useRef<string | null>(null);
  useEffect(() => () => {
    if (ackTimer.current) clearTimeout(ackTimer.current);
  }, []);
  const publish = useCallback(() => {
    if (ackTimer.current) clearTimeout(ackTimer.current);
    ackTimer.current = setTimeout(function fire() {
      // Not while a landing or jump is still carrying the list past rows it will not stop at.
      if (moving.current > 0) {
        ackTimer.current = setTimeout(fire, ACK_DEBOUNCE_MS);
        return;
      }
      ackTimer.current = null;
      // A timer: anything thrown here is uncaught, and fatal in a release build.
      try {
        ack.current?.setBottomVisibleMessageId(bottomId.current);
      } catch (e) {
        console.warn('[list] read cursor not published:', e instanceof Error ? e.message : e);
      }
      stashPosition();
    }, ACK_DEBOUNCE_MS);
  }, [stashPosition]);

  const onViewableItemsChanged = useCallback(
    (info: { viewableItems: ViewTokenLike[] }) => {
      if (!landedRef.current) return;
      bottomId.current = bottomVisibleMessageId(info.viewableItems);
      topRow.current = topVisibleMessage(info.viewableItems);
      publish();
    },
    [publish],
  );

  // A message arriving while already at the bottom never scrolls: re-measure on every change.
  // A frame later, never in the commit that changed the rows: FlashList has trimmed its
  // layouts to the new data by then but still holds the previous on-screen indices until its
  // own layout pass, so recomputing now asks for the layout of a row that was just deleted
  // ("index out of bounds, not enough layouts" - the 0.1.1 crash on deleting a message).
  useEffect(() => {
    if (!landed) return undefined;
    const frame = requestAnimationFrame(() => {
      if (!mounted.current) return;
      safeRecomputeViewableItems(listRef.current);
      publish();
    });
    return () => cancelAnimationFrame(frame);
  }, [landed, rows, publish]);

  // ---- overlays -----------------------------------------------------------------------------------------
  const banner = useUnreadBanner(roomId, entrySnap, nearBottom);
  const markAsRead = () => {
    const newest = newestLoadedMessageId(roomId);
    if (newest) ackRoomOptimistic(roomId, newest);
    dismissNewHeader(roomId);
    haptics.success();
  };
  const jumpToUnread = () => {
    const id = model.firstUnreadId;
    if (!id) return;
    const index = indexOfMessage(rowsRef.current, id);
    if (index < 0) return;
    stick.current = false;
    track(safeScrollToIndex(listRef.current, { index, animated: !reduceMotion, viewOffset: -UNREAD_LANDING_OFFSET }, rowsRef.current.length));
  };
  const toBottom = () => {
    stick.current = true;
    updateNear(true);
    safeScrollToEnd(listRef.current, { animated: !reduceMotion });
  };

  // ---- render ---------------------------------------------------------------------------------------------

  return (
    <ListContext.Provider value={ctx}>
      <View style={styles.fill} onLayout={onLayout}>
        {showSkeleton && history.failed && !paging.loading ? (
          <EmptyState
            size="page"
            icon="fa-solid fa-triangle-exclamation"
            body={t('mobile.chat.loadFailed')}
            action={<Button title={t('common.retry')} size="sm" variant="outline" onPress={history.retry} />}
          />
        ) : showSkeleton ? (
          <RoomSkeleton compact={ctx.compact} />
        ) : (
          <View style={[styles.fill, { opacity: landed ? 1 : 0 }]}>
            <FlashList
              ref={listRef}
              data={rows}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              getItemType={itemType}
              maintainVisibleContentPosition={keepPosition}
              ListHeaderComponent={olderEdge ? OLDER_EDGE : null}
              ListFooterComponent={newerEdge ? NEWER_EDGE : null}
              onLoad={land}
              onScroll={onScroll}
              scrollEventThrottle={32}
              onScrollBeginDrag={userScrollStart}
              onMomentumScrollBegin={userScrollStart}
              onScrollEndDrag={userScrollMaybeEnd}
              onMomentumScrollEnd={userScrollMaybeEnd}
              onContentSizeChange={onContentSizeChange}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              contentContainerStyle={paging.hasMoreNewer ? styles.contentUnderBar : styles.content}
              drawDistance={800}
              accessibilityLabel={t('mobile.chat.listLabel')}
            />
          </View>
        )}

        {banner ? (
          <View style={[styles.banner, { backgroundColor: withAlpha(theme.colors.primary, 0.14), borderBottomColor: withAlpha(theme.colors.primary, 0.25) }]}>
            <Touchable feedback="opacity" onPress={jumpToUnread} accessibilityRole="button" accessibilityHint={t('mobile.chat.jumpToUnread')} style={styles.bannerText}>
              <Text variant="label" numberOfLines={1}>
                {t('room.unread.count', {
                  count: banner.capped ? banner.count + 1 : banner.count,
                  shown: `${banner.count}${banner.capped ? '+' : ''}`,
                  since: t('room.unread.since', {
                    time: formatDate(banner.since, { hour: 'numeric', minute: '2-digit' }),
                    date: formatDate(banner.since, { month: 'long', day: 'numeric', year: 'numeric' }),
                  }),
                })}
              </Text>
            </Touchable>
            <Button title={t('room.unread.markAsRead')} size="sm" onPress={markAsRead} />
          </View>
        ) : null}

        {paging.hasMoreNewer && hasMessages ? (
          <View style={[styles.olderBar, { backgroundColor: theme.colors.primary, borderRadius: theme.radii.lg }]}>
            <Text variant="caption" weight="medium" tone="onPrimary" numberOfLines={1} style={styles.flexShrink}>
              {t('messages.viewingOlder')}
            </Text>
            <Touchable
              feedback="opacity"
              onPress={() => {
                haptics.selection();
                dismissKeyboard();
                void jumpToPresent(roomId);
              }}
              accessibilityRole="button"
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              style={styles.present}
            >
              <Text variant="caption" weight="semibold" tone="onPrimary">
                {t('messages.jumpToPresent')}
              </Text>
              <Icon name="arrow-down" size={10} tone="onPrimary" />
            </Touchable>
          </View>
        ) : !nearBottom && landed && hasMessages ? (
          <Touchable
            feedback="opacity"
            onPress={toBottom}
            accessibilityRole="button"
            accessibilityLabel={t('messages.jumpToPresent')}
            style={[styles.toBottom, { backgroundColor: withAlpha(theme.colors.card, 0.95), borderColor: theme.colors.border }]}
          >
            <Icon name="arrow-down" size={14} tone="default" />
          </Touchable>
        ) : null}

        <ReactionPickerHost />
        <DeleteMessageHost />
      </View>
    </ListContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingBottom: 8 },
  /** Room for the "viewing older messages" bar over the last rows. */
  contentUnderBar: { paddingBottom: 56 },
  flexShrink: { flexShrink: 1 },
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bannerText: { flex: 1, minWidth: 0, minHeight: 32, justifyContent: 'center' },
  olderBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  present: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toBottom: {
    position: 'absolute',
    end: 16,
    bottom: 14,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
});
