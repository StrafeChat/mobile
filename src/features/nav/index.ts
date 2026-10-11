/**
 * The nav area: the shell's nav side (space rail, Home's PM list, a space's rooms, the bottom
 * tabs with the Notifications and You panels), Friends and Notes for the content side, the
 * Discover / invite / create-space screens, and the sheets for inviting, creating rooms,
 * sections and groups, adding friends and people, and the custom status.
 *
 * Contract: NavPanel (shell nav side), FriendsView and NotesView (rendered by the room area's
 * ConversationPanel for shell views 'friends' / 'notes').
 */
export { NavPanel } from './NavPanel';
/** Optional root mount of the nav sheets (NavPanel hosts them too; only one renders). */
export { NavSheets as NavHosts } from './sheets/NavSheets';
export { FriendsView } from './friends';
export { NotesView, fetchNotesRoom } from './notes';

/** For the content side's empty state ('empty' view): greeting + add friends / group / space. */
export { HomeLanding } from './HomeLanding';
/** The phone-only "show spaces and rooms" header button, for content-side headers. */
export { RailsButton } from './ContentHeader';

/** Sheets other areas may open (they present over the whole app; NavPanel hosts them). */
export {
  openAddFriendSheet,
  openAddPeopleSheet,
  openCreateGroupSheet,
  openCreateRoomSheet,
  openCreateSectionSheet,
  openCustomStatusSheet,
  openInviteSheet,
} from './sheets/store';

/** Screens and moves other areas may want. */
export { goToSpace, openCreateSpace, openDiscover, openInvite, openJoinSpace, openPmWith } from './navigation';
/** Paste/scan handling for invite links from any instance (foreign links become code@domain). */
export { inviteCodeFromAnyInput, inviteLink, roomLink } from './invites';
/** The space sheet (the header's menu), e.g. for a long-press on a space name elsewhere. */
export { openSpaceSheet } from './space/SpaceHeader';
