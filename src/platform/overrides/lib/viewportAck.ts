/**
 * Mobile replacement for web/src/lib/viewportAck.ts - the read cursor follows what is on screen.
 *
 * The message list reports the bottom-most message actually visible; this advances the room's
 * read cursor to it whenever it moves past what is already read, while the app is in front.
 * The decision rules are the web's, in the same order (the web primitive itself cannot run
 * here: it registers `document` listeners on mount and reads `document.visibilityState`):
 *
 * - switching rooms forgets the previous room's bottom message, so it cannot ack the new room;
 * - a truly empty room (nothing loaded, nothing to page either way) acks straight to its
 *   last_message_id, or a deleted last message leaves a permanent phantom unread;
 * - at the live tail, a dangling last_message_id (its message deleted) is acked through too -
 *   but not while reading a jumped-to window (hasMoreNewer), where "newest loaded" is not the
 *   newest;
 * - caught up, a stranded mention badge is cleared with a non-advancing ack;
 * - nothing is acked while nobody is looking, and everything is re-evaluated the moment the app
 *   is in front again (the web's visibilitychange/focus).
 *
 * Mobile differences: "looking" is AppState 'active' *and* the room being the conversation on
 * screen (shell/state.ts roomOnScreen). The app keeps a conversation mounted - and its list
 * following new messages - behind the rails or under a pushed screen, where a browser tab would
 * have navigated away; a bottom row reported from there was never seen, so it is neither acked
 * nor kept for the keepalive, and coming back on screen re-evaluates like coming back to the
 * foreground. The web's last-chance `beforeunload` keepalive ack is sent when the app goes to
 * the background - the moment it may be suspended or killed without another word - and only
 * when it is ahead of the read cursor.
 *
 * Two ways to use it:
 * - createViewportAck(roomId) - the web's Solid primitive, same signature; call it under a
 *   Solid owner (inside createRoot), it cleans up with the owner;
 * - createRoomViewportAck(roomId) - for a React message list: owns its Solid root; call
 *   setBottomVisibleMessageId from the list's viewability callback (debounced as the web's list
 *   does, ~450 ms) and dispose() on unmount or room change.
 */
import { createEffect, createRoot, createSignal, onCleanup, type Accessor, type Setter } from 'solid-js';
import { AppState, type AppStateStatus } from 'react-native';
import { ackRoomOptimistic, messageIdGt, readState } from '@web/stores/readState';
import { rooms } from '@web/stores/rooms';
import { messages } from '@web/stores/messages';
import { clearPendingAck, getPendingAck, setPendingAck } from '@web/stores/pendingAck';
import { ackRoomKeepalive } from '@web/api/rooms';
import { conversationOnScreen } from '@/shell/state';

const SNOWFLAKE = /^\d+$/;

// ---- is anyone looking -------------------------------------------------------------------------

const [appActive, setAppActive] = createSignal(AppState.currentState === 'active');
const leaveListeners = new Set<() => void>();
let watchingAppState = false;

function watchAppState(): void {
  if (watchingAppState) return;
  watchingAppState = true;
  AppState.addEventListener('change', (state: AppStateStatus) => {
    const active = state === 'active';
    if (active !== appActive()) setAppActive(active);
    // 'inactive' is a pause in front of the person (Control Center, a call banner, the app
    // switcher opening); 'background' is the app going away, the web's page unload.
    if (state === 'background') for (const fn of [...leaveListeners]) fn();
  });
}

// ---- the web's rules ----------------------------------------------------------------------------

/** Newest real (snowflake) message id loaded for a room, skipping optimistic temp ids. */
function newestLoadedMessageId(roomId: string): string | null {
  const list = messages.byRoom[roomId];
  if (!list) return null;
  let best: string | null = null;
  for (const m of list) {
    if (!SNOWFLAKE.test(m.id)) continue;
    if (best == null || messageIdGt(m.id, best)) best = m.id;
  }
  return best;
}

function lastReadFor(roomId: string): string | null {
  return readState.byRoom[roomId]?.lastReadMessageId ?? rooms.rooms.find((r) => r.id === roomId)?.last_read_message_id ?? null;
}

/** The web's `beforeunload` keepalive, sent when the app goes to the background. */
function flushPendingAck(): void {
  const p = getPendingAck();
  if (!p) return;
  const lastRead = lastReadFor(p.roomId);
  if (lastRead && !messageIdGt(p.messageId, lastRead)) return;
  ackRoomKeepalive(p.roomId, p.messageId);
}

/**
 * Viewport-driven read cursor for the room `roomId()` shows. Same contract as the web's:
 * returns the bottom-visible id and its setter, which the message list calls.
 */
export function createViewportAck(roomId: Accessor<string | undefined>): {
  bottomVisibleMessageId: Accessor<string | null>;
  setBottomVisibleMessageId: Setter<string | null>;
} {
  watchAppState();
  const [bottomVisibleMessageId, setBottomVisibleMessageId] = createSignal<string | null>(null);

  // Reset when switching rooms, so the previous room's bottom id never acks the new room.
  createEffect(() => {
    roomId();
    setBottomVisibleMessageId(null);
  });

  leaveListeners.add(flushPendingAck);
  onCleanup(() => leaveListeners.delete(flushPendingAck));

  createEffect(() => {
    // Tracked: coming back to the foreground re-evaluates, like the web's visibilityTick.
    const active = appActive();
    const id = roomId();
    let ackID = bottomVisibleMessageId();
    // Tracked so this re-runs once the room's messages finish loading, the only signal an
    // empty room gives (it never reports a bottom-visible message).
    const loaded = id ? messages.byRoom[id] : undefined;
    const loading = id ? messages.loading[id] === true : false;
    if (!id) {
      clearPendingAck();
      return;
    }
    // Tracked too: the conversation coming back on screen (the rails swiped away, the screen
    // over it closed) re-evaluates, as the foreground does. Until then nothing it shows is
    // seen: no ack (not even a stranded mention's), and no pending position for the background
    // keepalive to send. The pending slot is left as it is - it is app-wide, and holds either
    // a position this room had on screen or the one of the room that is on screen now.
    if (!conversationOnScreen(id)) return;
    if (!ackID || !SNOWFLAKE.test(ackID)) {
      const r = rooms.rooms.find((x) => x.id === id);
      const roomLast = r?.last_message_id;
      const trulyEmpty =
        !loading && (loaded?.length ?? 0) === 0 && messages.hasMoreOlder[id] !== true && messages.hasMoreNewer[id] !== true;
      if (roomLast && SNOWFLAKE.test(roomLast) && trulyEmpty) {
        ackID = roomLast;
      } else {
        clearPendingAck();
        return;
      }
    }
    const room = rooms.rooms.find((r) => r.id === id);
    const roomLast = room?.last_message_id;
    if (
      roomLast &&
      SNOWFLAKE.test(roomLast) &&
      messages.hasMoreNewer[id] !== true &&
      messageIdGt(roomLast, ackID) &&
      ackID === newestLoadedMessageId(id)
    ) {
      ackID = roomLast;
    }
    const lastRead = readState.byRoom[id]?.lastReadMessageId ?? room?.last_read_message_id ?? null;
    if (lastRead && !messageIdGt(ackID, lastRead)) {
      // Caught up. A stranded mention badge (its message deleted) still has to be cleared: a
      // non-advancing ack resets the server's mention baseline without moving the cursor.
      if ((readState.byRoom[id]?.mentionCount ?? 0) === 0) return;
      if (!active) return;
      ackRoomOptimistic(id, lastRead);
      return;
    }
    setPendingAck(id, ackID);
    if (!active) return;
    ackRoomOptimistic(id, ackID);
  });

  onCleanup(() => clearPendingAck());

  return { bottomVisibleMessageId, setBottomVisibleMessageId };
}

export interface RoomViewportAck {
  /** The bottom-most message on screen, or null when none is (scrolled into a gap, loading). */
  setBottomVisibleMessageId(id: string | null): void;
  /** Stop tracking (unmount, or the list now shows another room). */
  dispose(): void;
}

/** createViewportAck for a fixed room, with its own Solid root - for React components. */
export function createRoomViewportAck(roomId: string): RoomViewportAck {
  return createRoot((dispose) => {
    const { setBottomVisibleMessageId } = createViewportAck(() => roomId);
    return {
      setBottomVisibleMessageId: (id: string | null) => {
        setBottomVisibleMessageId(id);
      },
      dispose,
    };
  });
}
