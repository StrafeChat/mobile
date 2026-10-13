/**
 * Where the app shell is: which panel is in front and what it shows.
 *
 * Kept in Solid signals (like every other store the app reads) so non-React code - a
 * notification tap, a deep link, the gateway noticing the open room was deleted - can move
 * the shell the same way a component does.
 *
 * Information architecture, as in the web client's mobile layout and Discord's app:
 *   - nav panel: the space rail + that space's room list (or the DM list on Home), with the
 *     bottom tab bar (Home / Notifications / You);
 *   - content panel: the open conversation;
 *   - members drawer: slides in from the right over the content.
 * Swiping moves between them; on a tablet-width screen nav and content sit side by side and
 * members is a column.
 */
import { createSignal } from 'solid-js';
import { dismissKeyboard } from '@/ui/keyboard';

export type ShellPanel = 'nav' | 'content';
export type ShellTab = 'home' | 'notifications' | 'you';

/** What the content panel shows. */
export type ShellView =
  | { kind: 'room'; roomId: string; spaceId?: string }
  | { kind: 'friends' }
  | { kind: 'notes' }
  | { kind: 'empty' };

const [panel, writePanel] = createSignal<ShellPanel>('nav');
const [tab, setTab] = createSignal<ShellTab>('home');
const [membersOpen, writeMembersOpen] = createSignal(false);
const [membersAvailable, setMembersAvailable] = createSignal(false);
/** The space selected on the rail; null is Home (DMs). */
const [selectedSpaceId, setSelectedSpaceId] = createSignal<string | null>(null);
const [view, setView] = createSignal<ShellView>({ kind: 'empty' });
/** The shell is the screen in front: nothing (a thread, a profile, settings) is pushed over it. */
const [focused, setShellFocused] = createSignal(false);
/** Rails and conversation side by side (tablet width): the conversation shows whichever panel is "in front". */
const [wide, setShellWide] = createSignal(false);

export const shell = {
  panel,
  tab,
  membersOpen,
  membersAvailable,
  selectedSpaceId,
  view,
  focused,
  wide,
};

/** focused and wide are SwipeShell's to keep: it is what lays the shell out and is navigated over. */
export { setTab as setShellTab, setMembersAvailable, setSelectedSpaceId, setShellFocused, setShellWide };

// ---- the conversation on screen -----------------------------------------------------------------

export interface RoomOnScreen {
  roomId: string;
  /** null for a PM or group. */
  spaceId: string | null;
}

/**
 * A room claimed by a screen pushed over the shell while that screen is in front: a thread's
 * own, or the conversation the media viewer was opened over.
 */
const [screenRoom, setScreenRoom] = createSignal<RoomOnScreen | null>(null);

/**
 * A screen pushed over the shell shows `roomId` and is the one in front; call the returned
 * release when it no longer is (covered by another screen, or gone). Only the claim still
 * current is released, so the order of one screen's blur and the next one's focus does not
 * matter.
 */
export function claimScreenRoom(roomId: string, spaceId: string | null): () => void {
  const claim: RoomOnScreen = { roomId, spaceId };
  setScreenRoom(claim);
  return () => {
    if (screenRoom() === claim) setScreenRoom(null);
  };
}

/**
 * The conversation the person is looking at, or null when none is - the one definition the
 * app has. A thread's screen while it is in front; otherwise the shell's open room, while the
 * shell is in front and the conversation shows: in front of the rails on a phone, always on a
 * tablet. The member drawer over it does not hide it (the web keeps the room as the one viewed
 * with its drawer open too), and neither does the media viewer, which keeps the conversation it
 * was opened over: on the web the viewer is an overlay on the room, so a reply arriving while
 * you look at a photo neither pings over it nor waits unread behind it.
 *
 * Messages arriving in this room are seen: the read cursor follows it (lib/viewportAck) and its
 * notifications are skipped (platform/wiring.ts names it in the location the web's notification
 * logic reads). Anything else - the rails in front, any other screen pushed over the
 * conversation (pins, search, a profile, settings) - is not seen, so it notifies and stays
 * unread. The app being in front at all (AppState) is each caller's own check.
 */
export function roomOnScreen(): RoomOnScreen | null {
  const top = screenRoom();
  if (top) return top;
  if (!focused()) return null;
  const v = view();
  if (v.kind !== 'room') return null;
  if (!wide() && panel() !== 'content') return null;
  return { roomId: v.roomId, spaceId: v.spaceId ?? null };
}

/** Whether `roomId` is the conversation on screen (roomOnScreen). Tracked inside an effect. */
export function conversationOnScreen(roomId: string): boolean {
  return roomOnScreen()?.roomId === roomId;
}

/*
 * The keyboard goes away whenever the conversation is covered or a panel that may hold the
 * focused field goes away: the rails coming over it, the member drawer opening (the composer
 * is under it) and closing (its search field is gone). Done here, at the moment the shell
 * moves, rather than in a component effect: every caller (a swipe, a button, Android back, a
 * notification, a deleted room) goes through these, and it runs before the render in which a
 * newly opened conversation's composer takes a requested focus (a push notification's Reply),
 * which a parent's effect would run after and undo. Bringing the conversation to the front
 * leaves the keyboard alone for the same reason.
 */

export function setShellPanel(next: ShellPanel): void {
  if (next === 'nav' && panel() !== 'nav') dismissKeyboard();
  writePanel(next);
}

export function setMembersOpen(open: boolean): void {
  if (open !== membersOpen()) dismissKeyboard();
  writeMembersOpen(open);
}

/** Show the rails (space list + rooms). */
export function openNav(): void {
  setMembersOpen(false);
  setShellPanel('nav');
}

/** Bring the conversation to the front. */
export function openContent(): void {
  setShellPanel('content');
}

/** Open a conversation: the room on the content panel, the Home tab underneath. */
export function openRoom(roomId: string, spaceId?: string | null): void {
  setView({ kind: 'room', roomId, ...(spaceId ? { spaceId } : {}) });
  if (spaceId !== undefined) setSelectedSpaceId(spaceId ?? null);
  setTab('home');
  setMembersOpen(false);
  setShellPanel('content');
}

export function openShellView(next: ShellView): void {
  setView(next);
  setTab('home');
  setMembersOpen(false);
  setShellPanel('content');
}

/** The open room went away (deleted, left, kicked): back to the list. */
export function closeView(): void {
  setView({ kind: 'empty' });
  setMembersOpen(false);
  setShellPanel('nav');
}

export function currentRoomId(): string | null {
  const v = view();
  return v.kind === 'room' ? v.roomId : null;
}
