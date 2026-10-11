/**
 * The chat area: the message list and everything a message renders, the typing row, the
 * full-screen media viewer, and the message sheets (actions, reactions, delete, create thread).
 *
 * Contract (src/features/room composes these):
 * - <MessageList roomId spaceId? />: the conversation's messages. Enters the room
 *   (enterRoom/leave), lands, pages, follows, jumps, acks what is on screen. A thread is a room
 *   id too. Reply / edit go through '@/features/composer/state'.
 * - <TypingIndicator roomId />: the "X is typing…" row (fixed height).
 *
 * Also useful to other areas:
 * - <MessageBody text roomId … />: one message's rendered text (pins, search results).
 * - <MessageAttachments attachments />: a message's attachments.
 * - openMedia(items, index?, label?) and <MediaViewerHost /> (mount once at the root: it shows
 *   the /media screen whenever shared code opens stores/mediaViewer directly).
 * - openReactionPicker / openCreateThread / confirmDeleteMessage: the sheets the list hosts.
 * - showMessageActions(messageId, { roomId, spaceId }): the long-press sheet.
 * - openUserProfile / showAuthorMenu: a person in a room's context.
 */
export { MessageList, type MessageListProps } from './list/MessageList';
export { TypingIndicator, TYPING_ROW_HEIGHT } from './TypingIndicator';
export { MessageBody, type MessageBodyProps } from './body/MessageBody';
export { MessageAttachments } from './attachments/Attachments';
export { openMedia, MediaViewerHost } from './mediaViewer';
export { openReactionPicker } from './reactions/ReactionPicker';
export { openCreateThread, CreateThreadSheet, type CreateThreadRequest } from './actions/CreateThreadSheet';
export { confirmDeleteMessage } from './actions/DeleteMessageSheet';
export { showMessageActions } from './actions/messageActions';
export { openUserProfile, showAuthorMenu } from './people';
export { openMessageLink } from './navigation';
