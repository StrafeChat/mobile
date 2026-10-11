/**
 * The room area: the conversation frame (header, banners, info sheet, the list / typing /
 * composer composed from the chat and composer areas), the member drawer, and the screens and
 * sheets around a conversation - pins, search, threads, group details, profiles, safety
 * numbers, reports, notification settings, and the E2EE recovery prompts.
 *
 * Contract (integrator):
 *   <ConversationPanel/>  the shell's content side (shell.view(): room, Friends, Notes, empty)
 *   <MembersPanel/>       the shell's right drawer / tablet column
 *   <RoomHosts/>          root-mounted sheets and dialogs this area owns
 */
export { ConversationPanel } from './ConversationPanel';
export { MembersPanel } from './members/MembersPanel';
export { RoomHosts } from './RoomHosts';

/** One conversation, for other areas that show a room (Notes, say). mode 'screen' = pushed. */
export { RoomView, type RoomViewProps } from './RoomView';

// Openers other areas can call.
export { openRoomNotifySheet, openCreateThread, openMembersSheet, promptText, type CreateThreadRequest } from './presenters';
export {
  openPinsScreen,
  openSearchScreen,
  openThreadsScreen,
  openThreadScreen,
  openProfileScreen,
  openSafetyScreen,
  openGroupScreen,
  messageUser,
  goToMessage,
} from './navigation';
export { showUserProfile, spaceRoleContextFor } from './profile/present';
export { leaveGroup, markRoomRead } from './roomActions';

export { openLink } from './links';

// Route screens (src/app/(main)/...).
export { ThreadScreen } from './threads/ThreadScreen';
export { ThreadsScreen } from './threads/ThreadsScreen';
export { PinsScreen } from './pins/PinsScreen';
export { SearchScreen } from './search/SearchScreen';
export { FullProfileScreen } from './profile/FullProfileScreen';
export { SafetyScreen } from './safety/SafetyScreen';
export { GroupScreen } from './group/GroupScreen';
