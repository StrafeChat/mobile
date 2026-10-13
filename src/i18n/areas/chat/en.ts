/**
 * Mobile strings for the chat area (en), read as t('mobile.chat.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  listLabel: 'Messages',
  loadFailed: 'Couldn\'t load messages.',
  messageHint: 'Long-press for actions, swipe left to reply',
  openProfile: 'Opens their profile',
  openProfileOf: 'Open profile: {{name}}',
  jumpToUnread: 'Jumps to the first unread message',
  emojiUnavailable: 'This emoji is no longer available',
  videoUnplayable: 'This video can\'t be played on this device.',
  audioUnplayable: 'This file can\'t be played on this device. Share it to open it in another app.',
  fileOpenHint: 'Opens the share sheet to open or save the file',
  link: {
    open: 'Open link',
    copy: 'Copy link',
    openNamed: 'Open link: {{link}}',
    openImage: 'Open image: {{name}}',
  },
  copyCode: 'Copy code',
  reactions: {
    title: 'Reactions',
    none: 'Nobody to show.',
  },
};
