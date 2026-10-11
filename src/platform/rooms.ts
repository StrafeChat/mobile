/**
 * Entering and leaving a conversation: the store side of the web's RoomPage / SpacePage /
 * MessageListView that the native conversation screen needs and src/data does not cover.
 *
 * The rules that make a room behave live in the shared stores, but some of the calls that
 * drive them are made by those web pages, which do not run here:
 *
 * - the message store bounds a room's cache by whether a list is showing it
 *   (enterRoomView / leaveRoomView). With no view registered, every live message trims an
 *   open room back to 50 rows, throwing away the history the reader scrolled up to. The
 *   native list has no DOM container, so its view is registered without one: the store
 *   then never trims an on-screen room (it only trims around DOM measurements), and
 *   shrinks it to one page around the reader when they leave, as on the web;
 * - sendMessage, editMessage, link-preview warming and the read ack look the room up in
 *   the rooms store, which holds PMs. SpacePage mirrors the channel being viewed into it
 *   (spaceRoomToRoom); without that, sends to a space channel return nothing, or go out as
 *   plaintext into an E2EE channel and are rejected;
 * - the pages subscribe the gateway to what they show, fetch a PM's participants when the
 *   list had none, and ensure a space's roles, members and channel list.
 *
 * enterRoom() does that for one room; the screen calls leave() when the room goes off
 * screen. The first page and the NEW divider's entry snapshot are src/data's
 * (useEnsureRoomHistory, useEntrySnapshot); enterRoom only adds the case they cannot see -
 * a room shown before the session could load it (see below).
 */
import { createEffect, createMemo, createRoot, createSignal, on, onCleanup, untrack, type Accessor } from 'solid-js';
import { getRoom, type Room } from '@web/api/rooms';
import type { SpaceRoom } from '@web/api/spaces';
import { rememberScrollPosition, type SavedScrollPosition } from '@web/lib/scrollPositions';
import { subscribe, unsubscribe } from '@web/services/stargate/client';
import { auth } from '@web/stores/auth';
import { lastSpaceRoom } from '@web/stores/lastSpaceRoom';
import { enterRoomView, hasPendingJump, leaveRoomView, loadMessages, messages } from '@web/stores/messages';
import { clearNewHeaderDismissed } from '@web/stores/newHeaderDismissed';
import { addOrUpdateRoom, rooms } from '@web/stores/rooms';
import { ensureSpaceMembers } from '@web/stores/spaceMembers';
import { ensureSpaceRoles, ensureSpaceRooms, spaces } from '@web/stores/spaces';
import { stargate } from '@web/stores/stargate';

export const ROOM_TYPE_TEXT = 3;
export const ROOM_TYPE_THREAD = 6;

/** Text channels and threads hold a message list (voice and section rooms do not). */
export function isTextLikeRoomType(type: number | undefined): boolean {
  return type === ROOM_TYPE_TEXT || type === ROOM_TYPE_THREAD;
}

/**
 * A space channel as a rooms-store Room, so the send / edit / ack paths find it. Ported
 * from SpacePage.tsx, where the reasons for each field are spelled out:
 * - last_read_message_id and mention_count are carried through because addOrUpdateRoom
 *   re-syncs read state from whatever it is given; dropping them reset the read cursor on
 *   every visit (the NEW divider that "always came back");
 * - e2ee_enabled decides between the plaintext and Megolm send paths.
 *
 * One deliberate addition: `federation`. addOrUpdateRoom registers it with the E2EE
 * identity registry, so a channel of a space mirrored from another instance is keyed by
 * its origin id even when the channel list came from GET /spaces/:id/rooms (setSpaceRooms
 * does not register identities; only the READY path does). A plain copy, never the store
 * proxy, so one store does not end up holding another's.
 */
export function spaceRoomToRoom(r: SpaceRoom, spaceId: string): Room {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    topic: r.topic,
    position: r.position,
    space_id: spaceId,
    parent_id: r.parent_id,
    last_message_id: r.last_message_id,
    last_read_message_id: r.last_read_message_id,
    mention_count: r.mention_count,
    e2ee_enabled: r.e2ee_enabled,
    ...(r.federation ? { federation: { origin_domain: r.federation.origin_domain, origin_id: r.federation.origin_id } } : {}),
    created_at: r.created_at,
    updated_at: r.updated_at,
    recipients: [],
    participants: [],
  };
}

/** The space a channel (or thread) belongs to, from the loaded channel lists; reactive. */
export function spaceIdOfRoom(roomId: string): string | null {
  for (const [spaceId, list] of Object.entries(spaces.spaceRoomsBySpaceId)) {
    if (list?.some((r) => r.id === roomId)) return spaceId;
  }
  return null;
}

/**
 * The list on screen has no DOM container: that is what tells the message store not to
 * trim it from under the reader (it can only trim on screen with measurements).
 */
const CONTAINERLESS_VIEW = {
  container: (): undefined => undefined,
  programmatic: (run: () => void) => run(),
};

export interface RoomEntry {
  readonly roomId: string;
  /** The room's space, once known (null for PMs and group PMs); reactive. */
  readonly spaceId: Accessor<string | null>;
  /**
   * The room went off screen. `position` is where the reader was (the first row on screen
   * and whether they were following the bottom): the cache is shrunk to a page around it.
   * Pass `top` (that row's offset) too and it is remembered for the list's next landing
   * (lib/scrollPositions recallScrollPosition). Idempotent.
   */
  leave(position?: { anchorId: string | null; atBottom: boolean; top?: number } | null): void;
}

const [activeRoom, setActiveRoom] = createSignal<string | null>(null);
/** How many entries hold each room (a screen can re-mount before the old one unmounts). */
const holders = new Map<string, number>();

/** The room most recently entered and still on screen; reactive. */
export function activeRoomId(): string | null {
  return activeRoom();
}

/**
 * Show a room: register it with the message store, mirror a space channel into the rooms
 * store (and again whenever its type or E2EE flag changes), subscribe the gateway, and
 * fetch what its screen reads. Pass `spaceId` when the caller knows it (null for a PM);
 * otherwise it is looked up in the loaded channel lists, and followed if those arrive
 * later (a deep link or a notification opened before READY).
 *
 * Call from an effect (useEffect), not during render: it writes to stores.
 */
export function enterRoom(roomId: string, opts: { spaceId?: string | null } = {}): RoomEntry {
  enterRoomView(roomId, CONTAINERLESS_VIEW);
  holders.set(roomId, (holders.get(roomId) ?? 0) + 1);
  setActiveRoom(roomId);

  return createRoot((dispose) => {
    const spaceId = createMemo<string | null>(() => (opts.spaceId !== undefined ? opts.spaceId : spaceIdOfRoom(roomId)));
    const spaceRoom = createMemo(() => {
      const sid = spaceId();
      return sid ? (spaces.spaceRoomsBySpaceId[sid]?.find((r) => r.id === roomId) ?? null) : null;
    });

    // SpacePage's mirror, keyed on what the send path reads rather than on the room object:
    // the channel object is replaced on every incoming message, and re-mirroring each time
    // pushed the entry-time read snapshot back over the live ack.
    let mirrored = '';
    createEffect(() => {
      const room = spaceRoom();
      const sid = spaceId();
      const key = `${room?.id ?? ''}|${room?.type ?? ''}|${room?.e2ee_enabled ? 1 : 0}|${sid ?? ''}`;
      if (key === mirrored) return;
      mirrored = key;
      if (!room || !sid || !isTextLikeRoomType(room.type)) return;
      untrack(() => {
        addOrUpdateRoom(spaceRoomToRoom(room, sid));
        lastSpaceRoom.set(sid, room.id);
      });
    });

    // A space's roles, members and channel list, which its screens read; each is a no-op
    // when already loaded for this connection.
    createEffect(() => {
      const sid = spaceId();
      if (!sid) return;
      untrack(() => {
        void ensureSpaceRoles(sid);
        void ensureSpaceRooms(sid);
        void ensureSpaceMembers(sid).catch(() => undefined);
      });
    });

    // What the page itself subscribes (ref-counted; boot.ts already holds every channel):
    // the space for a channel, the room for a PM.
    createEffect(() => {
      if (!stargate.ready) return;
      const channel = spaceId() ?? roomId;
      subscribe(channel, undefined);
      onCleanup(() => unsubscribe(channel, undefined));
    });

    // A PM listed without participants (GET /rooms may omit them) gets them fetched once.
    let fetchedParticipants = false;
    createEffect(() => {
      if (spaceId() || fetchedParticipants) return;
      const room = rooms.rooms.find((r) => r.id === roomId);
      if (!room || (room.participants?.length ?? 0) > 0) return;
      fetchedParticipants = true;
      getRoom(roomId)
        .then((full) => addOrUpdateRoom(full))
        .catch(() => undefined);
    });

    // The first page is the screen's to load (useEnsureRoomHistory, at entry). A room shown
    // before the session could load it - an offline start, a notification tapped during
    // start-up - had nothing loaded then (loadMessages needs the signed-in user), and on the
    // web would stay empty: its pages never render before READY. Here it loads once the
    // user is known or the gateway comes up. A failure (still offline) leaves it unloaded
    // for the next change to retry.
    createEffect(
      on(
        () => [auth.user?.id, stargate.ready] as const,
        ([uid]) => {
          if (!uid || messages.byRoom[roomId] !== undefined || messages.loading[roomId] || hasPendingJump(roomId)) return;
          loadMessages(roomId).catch((e: unknown) => console.warn('[rooms] could not load', roomId, e));
        },
        { defer: true },
      ),
    );

    let left = false;
    const entry: RoomEntry = {
      roomId,
      spaceId,
      leave(position) {
        if (left) return;
        left = true;
        dispose();
        if (position && typeof position.top === 'number') {
          rememberScrollPosition(roomId, position as SavedScrollPosition);
        }
        const remaining = (holders.get(roomId) ?? 1) - 1;
        if (remaining > 0) {
          holders.set(roomId, remaining);
          return;
        }
        holders.delete(roomId);
        leaveRoomView(roomId, position ? { anchorId: position.anchorId, atBottom: position.atBottom } : null);
        // As the pages' cleanup: the next visit starts with the NEW header shown.
        clearNewHeaderDismissed(roomId);
        if (activeRoom() === roomId) setActiveRoom(null);
      },
    };
    return entry;
  });
}

/**
 * Pull the newest page of the room on screen without moving the reader (merged in place).
 * For coming back to the foreground on a socket that survived: frames the server dropped
 * while the app was suspended never arrive, and READY (which re-syncs everything) only
 * comes with a reconnect.
 */
export function refreshActiveRoomQuietly(): void {
  const id = activeRoom();
  if (!id || messages.byRoom[id] === undefined || messages.loading[id]) return;
  loadMessages(id, undefined, undefined, { quiet: true }).catch(() => undefined);
}
