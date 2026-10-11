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
 *   The list stays invisible until it has landed, so it never visibly jumps;
 * - following: only a user scroll turns "stick to bottom" on (ending within 24 px of it) or off.
 *   A live message follows only while sticking and not mid-scroll; the viewer's own send and
 *   "jump to present" always go to the bottom; content growing (images, previews) re-pins;
 * - paging: within 400 px of either loaded edge the next page loads (older always, newer only
 *   in a jumped-to window); skeleton groups stand in past the edge meanwhile;
 * - jumps while in the room (a reply, a pin, a search hit): consumed, polled up to 2 s for the
 *   row (the nearest newer one if it's gone), centred, smooth only if already loaded;
 * - "You're viewing older messages / Jump to present" while the window isn't the live tail;
 *   otherwise a jump-to-bottom button once scrolled away;
 * - the unread banner ("N new messages since…", Mark As Read) while away from the bottom;
 * - the read cursor follows the bottom-most visible message (lib/viewportAck, 450 ms).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
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
  type MessageListItem,
} from '@/data';
import { useSolid } from '@/bridge/solid';
import { enterRoom, spaceIdOfRoom, type RoomEntry } from '@/platform/rooms';
import { createRoomViewportAck } from '@/platform/overrides/lib/viewportAck';
import { useTheme } from '@/theme';
import { Button, haptics, Icon, Text, Touchable, withAlpha } from '@/ui';
import { CreateThreadHost } from '../actions/CreateThreadSheet';
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
  SETTLE_DELAY_MS,
  UNREAD_LANDING_OFFSET,
  USER_SCROLL_IDLE_MS,
  bottomVisibleMessageId,
  chooseLanding,
  distanceToBottom,
  edgesToLoad,
  indexOfMessage,
  itemType,
  resolveJumpRow,
  topVisibleMessage,
  type ViewTokenLike,
} from './listLogic';

/** Rooms whose first-view landing (on the first unread) has happened this session. */
const roomsWithInitialScrollDone = new Set<string>();

export interface MessageListProps {
  roomId: string;
  /** null for a PM / group; omit to look the space up from the loaded room lists. */
  spaceId?: string | null;
}

/** One list per room: a different room is a fresh list (its own landing, its own entry). */
export function MessageList(props: MessageListProps) {
  return <RoomMessageList key={props.roomId} {...props} />;
}

function renderItem({ item }: ListRenderItemInfo<MessageListItem>) {
  switch (item.kind) {
    case 'message':
      return <MessageRow item={item} />;
    case 'dateDivider':
      return <DateDivider date={item.date} newMessages={item.newMessages} />;
    case 'newDivider':
      return <NewDivider />;
    case 'e2eeDivider':
      return <E2eeDivider encrypted={item.encrypted} />;
    case 'historyEdge':
      return <HistoryEdge side={item.side} />;
    case 'intro':
      return <ListIntro />;
    default:
      return null;
  }
}

const keyExtractor = (item: MessageListItem) => item.key;
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
  useEnsureRoomHistory(roomId);

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
  const items = model.items;
  const paging = useMessagePaging(roomId);
  const gates = useRoomGates(roomId, spaceId);
  const settings = useSettings();
  const allowLinkPreviews = useLinkPreviewsAllowed(roomId);
  const jump = useJumpTarget(roomId);
  const signals = useScrollSignals(roomId);
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
  const listRef = useRef<FlashListRef<MessageListItem>>(null);
  const stick = useRef(true);
  const dragging = useRef(false);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const metrics = useRef({ offset: 0, content: 0, viewport: 0 });
  const [landed, setLanded] = useState(false);
  const landedRef = useRef(false);
  const [nearBottom, setNearBottom] = useState(true);
  const nearRef = useRef(true);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const pagingRef = useRef(paging);
  pagingRef.current = paging;
  const reduceMotion = theme.reduceMotion;

  const updateNear = useCallback((near: boolean) => {
    if (nearRef.current === near) return;
    nearRef.current = near;
    setNearBottom(near);
  }, []);

  const settleTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cancelSettle = () => {
    for (const tm of settleTimers.current) clearTimeout(tm);
    settleTimers.current = [];
  };
  useEffect(() => () => {
    cancelSettle();
    if (idleTimer.current) clearTimeout(idleTimer.current);
  }, []);

  /** Snap to the newest row now, then again as late layout (images, previews) settles. */
  const scrollToBottomSettled = useCallback(() => {
    cancelSettle();
    const snap = () => listRef.current?.scrollToEnd({ animated: false });
    snap();
    settleTimers.current.push(setTimeout(snap, 16), setTimeout(snap, SETTLE_DELAY_MS));
    updateNear(true);
  }, [updateNear]);

  /** Remember where the reader is (scroll idle, after ack publishes): the row at the top and its offset. */
  const topRow = useRef<{ index: number; id: string } | null>(null);
  const stashPosition = useCallback(() => {
    if (!landedRef.current) return;
    const top = topRow.current;
    const layout = top ? listRef.current?.getLayout(top.index) : undefined;
    const first = listRef.current?.getFirstItemOffset() ?? 0;
    position.current = {
      anchorId: top?.id ?? null,
      atBottom: stick.current,
      ...(layout ? { top: Math.round(layout.y + first - metrics.current.offset) } : {}),
    };
  }, []);

  // ---- jumps ----------------------------------------------------------------------------------------
  const pendingJump = useRef<{ id: string; smooth: boolean; started: number } | null>(null);
  const [jumpPoll, setJumpPoll] = useState(0);

  const applyJump = useCallback(
    (allowSmooth: boolean): boolean => {
      const pj = pendingJump.current;
      if (!pj) return true;
      const hit = resolveJumpRow(itemsRef.current, pj.id);
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
      const animated = allowSmooth && pj.smooth && !reduceMotion;
      void listRef.current?.scrollToIndex({ index: hit.index, viewPosition: 0.5, animated });
      if (hit.exact) flashMessage(hit.id);
      return true;
    },
    [reduceMotion],
  );

  // A jump while in the room (reply, pin, search hit); on entry the landing consumes it first.
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
  }, [jumpPoll, items, applyJump]);

  // ---- landing --------------------------------------------------------------------------------------
  const land = useCallback(() => {
    if (landedRef.current) return;
    const list = listRef.current;
    if (!list) return;
    const firstView = !roomsWithInitialScrollDone.has(roomId);
    roomsWithInitialScrollDone.add(roomId);
    const choice = chooseLanding({
      items: itemsRef.current,
      jumpTargetId: pendingJump.current?.id ?? null,
      saved: recallScrollPosition(roomId),
      firstView,
      firstUnreadId: model.firstUnreadId,
    });
    const done = () => {
      landedRef.current = true;
      setLanded(true);
    };
    switch (choice.kind) {
      case 'jump':
        if (pendingJump.current) pendingJump.current.smooth = false;
        landedRef.current = true;
        if (!applyJump(false)) setJumpPoll((n) => n + 1);
        setLanded(true);
        return;
      case 'saved':
        stick.current = false;
        updateNear(false);
        void list.scrollToIndex({ index: choice.index, animated: false, viewOffset: -choice.top }).finally(done);
        return;
      case 'unread':
        stick.current = false;
        updateNear(false);
        void list.scrollToIndex({ index: choice.index, animated: false, viewOffset: -UNREAD_LANDING_OFFSET }).finally(done);
        return;
      default:
        stick.current = true;
        scrollToBottomSettled();
        done();
    }
  }, [roomId, model.firstUnreadId, applyJump, scrollToBottomSettled, updateNear]);

  // Safety net: never leave the list invisible if a landing callback is lost.
  useEffect(() => {
    if (landed) return undefined;
    const timer = setTimeout(() => {
      landedRef.current = true;
      setLanded(true);
    }, 1200);
    return () => clearTimeout(timer);
  }, [landed]);

  // ---- following ------------------------------------------------------------------------------------
  const prevTick = useRef(signals.tick);
  useEffect(() => {
    if (signals.tick === prevTick.current) return;
    prevTick.current = signals.tick;
    if (!landedRef.current || !stick.current || dragging.current) return;
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: !reduceMotion }));
  }, [signals.tick, reduceMotion]);

  const prevForce = useRef(signals.force);
  useEffect(() => {
    if (signals.force === prevForce.current) return;
    prevForce.current = signals.force;
    stick.current = true;
    pendingJump.current = null;
    scrollToBottomSettled();
  }, [signals.force, scrollToBottomSettled]);

  const onContentSizeChange = useCallback((_w: number, h: number) => {
    metrics.current.content = h;
    if (landedRef.current && stick.current && !dragging.current && !pendingJump.current) {
      listRef.current?.scrollToEnd({ animated: false });
    }
  }, []);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    const grew = h !== metrics.current.viewport;
    metrics.current.viewport = h;
    // The keyboard (or a banner) resized the list: keep the newest message in view.
    if (grew && landedRef.current && stick.current) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
  }, []);

  // ---- paging -----------------------------------------------------------------------------------------
  const maybeLoadEdges = useCallback(() => {
    if (!landedRef.current) return;
    const m = metrics.current;
    const p = pagingRef.current;
    const want = edgesToLoad({
      offset: m.offset,
      distanceToBottom: distanceToBottom(m.content, m.offset, m.viewport),
      hasMessages: messageStore.byRoom[roomId]?.length ? true : false,
      hasMoreOlder: p.hasMoreOlder,
      loadingOlder: p.loadingOlder,
      hasMoreNewer: p.hasMoreNewer,
      loadingNewer: p.loadingNewer,
    });
    if (want.older) void loadOlderMessages(roomId).catch(() => undefined);
    if (want.newer) void loadNewerMessages(roomId).catch(() => undefined);
  }, [roomId]);

  // A page arrived (or the first landing happened) on a list still short of the edge: keep going.
  useEffect(() => {
    if (!landed) return undefined;
    const timer = setTimeout(maybeLoadEdges, 50);
    return () => clearTimeout(timer);
  }, [landed, items.length, paging.loadingOlder, paging.loadingNewer, maybeLoadEdges]);

  // ---- scroll events ------------------------------------------------------------------------------------
  const onScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
      metrics.current = { offset: contentOffset.y, content: contentSize.height, viewport: layoutMeasurement.height };
      const near = distanceToBottom(contentSize.height, contentOffset.y, layoutMeasurement.height) <= BOTTOM_THRESHOLD_PX;
      // Only the user's own scrolling starts or stops following the newest message.
      if (dragging.current) stick.current = near;
      updateNear(near);
      maybeLoadEdges();
    },
    [maybeLoadEdges, updateNear],
  );

  const userScrollStart = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    idleTimer.current = null;
    dragging.current = true;
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
    ackTimer.current = setTimeout(() => {
      ackTimer.current = null;
      ack.current?.setBottomVisibleMessageId(bottomId.current);
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
  useEffect(() => {
    if (!landed) return;
    listRef.current?.recomputeViewableItems();
    publish();
  }, [landed, items, publish]);

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
    const index = indexOfMessage(itemsRef.current, id);
    if (index < 0) return;
    stick.current = false;
    void listRef.current?.scrollToIndex({ index, animated: !reduceMotion, viewOffset: -UNREAD_LANDING_OFFSET });
  };
  const toBottom = () => {
    stick.current = true;
    updateNear(true);
    listRef.current?.scrollToEnd({ animated: !reduceMotion });
  };

  // ---- render ---------------------------------------------------------------------------------------------
  const showSkeleton = !hasMessages && (paging.loading || !paging.cached);

  return (
    <ListContext.Provider value={ctx}>
      <View style={styles.fill} onLayout={onLayout}>
        {showSkeleton ? (
          <RoomSkeleton compact={ctx.compact} />
        ) : (
          <View style={[styles.fill, { opacity: landed ? 1 : 0 }]}>
            <FlashList
              ref={listRef}
              data={items}
              renderItem={renderItem}
              keyExtractor={keyExtractor}
              getItemType={itemType}
              maintainVisibleContentPosition={keepPosition}
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
                Keyboard.dismiss();
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
        <CreateThreadHost />
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
