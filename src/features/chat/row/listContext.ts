/**
 * What every row of one message list shares - the room, its space, the display mode and the
 * viewer's gates - passed by context so FlashList's renderItem stays a one-liner and rows
 * re-render only when one of these changes.
 */
import { createContext, useContext } from 'react';

export interface ListContextValue {
  roomId: string;
  spaceId: string | null;
  compact: boolean;
  allowLinkPreviews: boolean;
  canReply: boolean;
  /** Start new reactions (the "+" pill, the picker). */
  canReact: boolean;
  /** Click an existing pill to join it. */
  canJoinReactions: boolean;
  customEmojiSpaceId?: string;
  /** The web's --space-message-group (appearance setting). */
  groupSpacing: number;
}

export const ListContext = createContext<ListContextValue>({
  roomId: '',
  spaceId: null,
  compact: false,
  allowLinkPreviews: false,
  canReply: false,
  canReact: false,
  canJoinReactions: false,
  groupSpacing: 16,
});

export function useListContext(): ListContextValue {
  return useContext(ListContext);
}
