/**
 * Reactions, pins and slowmode for the conversation screen.
 *
 * Reactions are toggled with the store's toggleReaction(roomId, messageId, emoji, currentlyMine)
 * (optimistic, reconciled, reverted on failure); pins with pinMessage / unpinMessage. These
 * hooks only read. A message's own reactions: useMessage(...).reactions, or
 * useMessageReactions in messages.ts for a strip rendered apart from the row.
 */
import { useEffect } from 'react';
import { customEmojis, resolveCustomEmoji } from '@web/stores/customEmojis';
import type { CustomEmoji } from '@web/api/emojis';
import { pinnedMessages, ensureRoomPins } from '@web/stores/pinnedMessages';
import type { DecryptedMessage } from '@web/stores/messages';
import { slowmodeRemaining } from '@web/stores/slowmode';
import { snapshot } from '@/bridge/solid';
import { deepEqual, sameArray, useDerived } from './derived';

// ---- reactions --------------------------------------------------------------------------------------

export type ReactionKey = { kind: 'unicode'; emoji: string } | { kind: 'custom'; id: string };

/** A reaction's emoji key: a raw Unicode sequence, or "custom:<id>" for a space emoji. */
export function parseReactionKey(emoji: string): ReactionKey {
  return emoji.startsWith('custom:') ? { kind: 'custom', id: emoji.slice('custom:'.length) } : { kind: 'unicode', emoji };
}

export function customReactionKey(emojiId: string): string {
  return `custom:${emojiId}`;
}

/** A pill is inert when the viewer may not join reactions and it is not theirs - you can
 * always take back your own (MessageReactions). */
export function reactionPillDisabled(reaction: { me: boolean }, canJoinReactions: boolean): boolean {
  return !canJoinReactions && !reaction.me;
}

/**
 * A custom emoji by id, from the cache or one lookup for an emoji from a space the viewer is
 * not in (a PM can carry any space's emoji). Undefined until known, and for deleted ones.
 */
export function useCustomEmoji(id: string | null | undefined): CustomEmoji | undefined {
  return useDerived(
    `customEmoji:${id ?? ''}`,
    () => {
      if (!id) return undefined;
      const e = resolveCustomEmoji(id);
      return e ? { ...e } : undefined;
    },
    deepEqual,
  );
}

/** Every usable custom emoji (picker, :name: completion), grouped by space and sorted by name.
 * Restrict to `onlySpaceId` when the viewer lacks Use External Emojis (RoomGates.customEmojiSpaceId). */
export function useCustomEmojiList(onlySpaceId?: string): CustomEmoji[] {
  return useDerived(
    `customEmojiList:${onlySpaceId ?? ''}`,
    () => {
      const groups = onlySpaceId
        ? [customEmojis.bySpaceId[onlySpaceId] ?? []]
        : Object.values(customEmojis.bySpaceId);
      return groups.flat().map((e) => ({ ...e }));
    },
    deepEqual,
  );
}

// ---- pins ------------------------------------------------------------------------------------------

/** Fetch a room's pins once (the header's pin icon needs to know whether any exist). */
export function useEnsureRoomPins(roomId: string | null | undefined): void {
  useEffect(() => {
    if (roomId) void ensureRoomPins(roomId);
  }, [roomId]);
}

/** Pinned message ids, newest pin first. Re-renders when the pin list changes. */
export function usePinnedMessageIds(roomId: string): string[] {
  return useDerived(`pinIds:${roomId}`, () => (pinnedMessages.byRoom[roomId] ?? []).map((m) => m.id), sameArray);
}

/** Whether the room has pins (and whether that is known yet). */
export function usePinsState(roomId: string): { loaded: boolean; count: number } {
  return useDerived(
    `pinsState:${roomId}`,
    () => ({ loaded: pinnedMessages.loaded[roomId] === true, count: (pinnedMessages.byRoom[roomId] ?? []).length }),
    deepEqual,
  );
}

/** One pinned message as the pin sheet shows it (decrypted like a history page). */
export function usePinnedMessage(roomId: string, messageId: string): DecryptedMessage | undefined {
  return useDerived(
    `pin:${roomId}:${messageId}`,
    () => {
      const m = pinnedMessages.byRoom[roomId]?.find((x) => x.id === messageId);
      return m ? snapshot(m) : undefined;
    },
    deepEqual,
  );
}

// ---- slowmode ----------------------------------------------------------------------------------------

/**
 * Whole seconds left before this room accepts the viewer's next message (0 = may send).
 * The store ticks every 250 ms while a cooldown runs; this re-renders once per second of
 * countdown, and not at all when no cooldown is pending.
 */
export function useSlowmodeRemaining(roomId: string | null | undefined): number {
  return useDerived(`slowmode:${roomId ?? ''}`, () => slowmodeRemaining(roomId ?? undefined));
}
