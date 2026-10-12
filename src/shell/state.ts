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

export const shell = {
  panel,
  tab,
  membersOpen,
  membersAvailable,
  selectedSpaceId,
  view,
};

export { setTab as setShellTab, setMembersAvailable, setSelectedSpaceId };

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
