/**
 * The nav area's sheets - invite, create room / section, create group, add people, add friend,
 * custom status - one at a time, opened from anywhere (a long-press menu, a header button,
 * another area) and drawn by <NavSheets/>, which NavPanel mounts. The web keeps each of these
 * as a modal owned by whichever bar opened it; on a phone they are bottom sheets presented
 * over the whole app, so their state is app-wide.
 */
import { createExternalStore } from '@/ui';

export type NavSheet =
  | { kind: 'invite'; spaceId: string }
  | { kind: 'createRoom'; spaceId: string; parentSectionId: string | null }
  | { kind: 'createSection'; spaceId: string }
  | { kind: 'createGroup' }
  | { kind: 'addPeople'; roomId: string }
  | { kind: 'addFriend' }
  | { kind: 'customStatus' };

export const navSheetStore = createExternalStore<NavSheet | null>(null);

export function openNavSheet(sheet: NavSheet): void {
  navSheetStore.set(sheet);
}

export function closeNavSheet(): void {
  navSheetStore.set(null);
}

/** Invite people to a space (create a link, copy, share). */
export function openInviteSheet(spaceId: string): void {
  openNavSheet({ kind: 'invite', spaceId });
}

/** Create a text or voice room, optionally inside a section. */
export function openCreateRoomSheet(spaceId: string, parentSectionId: string | null = null): void {
  openNavSheet({ kind: 'createRoom', spaceId, parentSectionId });
}

export function openCreateSectionSheet(spaceId: string): void {
  openNavSheet({ kind: 'createSection', spaceId });
}

/** Start a group PM with friends. */
export function openCreateGroupSheet(): void {
  openNavSheet({ kind: 'createGroup' });
}

/** Add friends to a group PM (the group header's "Add people"). */
export function openAddPeopleSheet(roomId: string): void {
  openNavSheet({ kind: 'addPeople', roomId });
}

export function openAddFriendSheet(): void {
  openNavSheet({ kind: 'addFriend' });
}

export function openCustomStatusSheet(): void {
  openNavSheet({ kind: 'customStatus' });
}
