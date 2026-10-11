/**
 * Mobile strings for the room area (en), read as t('mobile.room.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  continueInBackground: 'Continue in the background',
  findPeople: 'Find people',
  friends: 'Friends',
  groupDetails: 'Group details',
  has: {
    link: 'Links',
    image: 'Images',
    video: 'Videos',
    audio: 'Audio',
    file: 'Files',
  },
  importingBackup: 'Importing your old backup…',
  jumpHint: 'Opens the conversation at this message',
  jumpToMessage: 'Jump to message',
  keysPendingTitle: 'Some messages are still locked',
  keysPendingBody:
    'They are waiting for their encryption keys. They unlock by themselves when one of your other devices shares the keys, or when you restore your recovery backup.',
  leaveGroupBody: "You'll stop getting messages from {{name}}. Someone in the group will have to add you back.",
  messageFailed: "Couldn't open the conversation.",
  mutualSpaces_one: '{{count}} space in common',
  mutualSpaces_other: '{{count}} spaces in common',
  noMembersMatch: 'No one matches that name.',
  nothingOpenTitle: 'No conversation open',
  nothingOpenBody: 'Pick a room or a private message to start talking.',
  notifications: 'Notifications',
  openCall: 'Open call',
  openRooms: 'Show rooms',
  removeFriendBody: '{{name}} will be removed from your friends.',
  removeMemberBody: '{{name}} will stop getting new messages from this group.',
  requestSent: 'Request sent',
  restoringMessages: 'Restoring your messages…',
  roomSettings: 'Room settings',
  safetyRowHint: 'Compare security codes to make sure nobody else is listening in.',
  saveCode: 'Save',
  saved: 'Saved',
  searchIn: 'Search {{name}}',
  showArchived: 'Shows the archived threads',
  undo: 'Undo',
  pinsLoadFailed: "Couldn't load the pinned messages.",
  unpinned: 'Message unpinned',
};
