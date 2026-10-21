/**
 * The data layer: typed React hooks over the web client's Solid stores.
 *
 * Every value comes from the web's stores and libs (imported from the `web` submodule); nothing
 * here re-implements their rules. What this layer adds is the React side: narrow selectors,
 * shared memos that re-render a component only when *its* value changes (see derived.ts), and
 * pure ports of the view-model logic the web keeps inside .tsx components (message grouping,
 * the space room tree, member grouping, permission gates) so both clients agree.
 *
 * Conventions:
 *  - Hooks return plain frozen data (never store proxies): safe for React.memo and FlashList.
 *  - Lists return ids/structure; rows read their own item by id (useMessage, usePmRow,
 *    useChannelRow, useMemberRow...).
 *  - Actions are the web stores' functions - import them from '@web/stores/*' and call them
 *    from handlers (sendMessage, toggleReaction, ackRoomOptimistic, muteRoom...).
 *  - Each hook's comment says what it re-renders on.
 */
export * from './constants';
export * from './derived';
export * from './me';
export * from './spaces';
export * from './rooms';
export * from './spaceRoomTree';
export * from './spaceRoomList';
export * from './collapsedSections';
export * from './memberList';
export * from './members';
export * from './users';
export * from './messageListModel';
export * from './messages';
export * from './typing';
export * from './reactions';
export * from './permissions';
export * from './notifications';
export * from './voice';
export * from './settings';
export * from './spaceProfileCompat';
export { useSolidScope } from './scope';
