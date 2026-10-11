/**
 * The custom emoji the picker offers, per space (the web picker's spaceCategories: every
 * space with emoji, named and iconed from the spaces store), plus a by-id lookup for the
 * "Frequently used" list, which can name an emoji from any space the viewer has seen.
 */
import { customEmojis } from '@web/stores/customEmojis';
import { spaces } from '@web/stores/spaces';
import { deepEqual, useDerived } from '@/data/derived';
import type { PickerCustomEmoji, SpaceEmojiSet } from '../logic/emojiGrid';

export interface SpaceEmojiData {
  sets: SpaceEmojiSet[];
  byId: Record<string, PickerCustomEmoji>;
}

const plain = (e: { id: string; name: string; url: string; space_id?: string | null }): PickerCustomEmoji => ({
  id: e.id,
  name: e.name,
  url: e.url,
  space_id: e.space_id ?? null,
});

export function spaceEmojiData(): SpaceEmojiData {
  const sets: SpaceEmojiSet[] = [];
  for (const [spaceId, list] of Object.entries(customEmojis.bySpaceId)) {
    if (!list || list.length === 0) continue;
    const space = spaces.spaces.find((s) => s.id === spaceId);
    const name = space?.name ?? '';
    sets.push({
      spaceId,
      name,
      ...(space?.icon ? { icon: space.icon } : {}),
      acronym: space?.name_acronym || (name || '?').slice(0, 2),
      emojis: list.map(plain),
    });
  }
  const byId: Record<string, PickerCustomEmoji> = {};
  for (const [id, e] of Object.entries(customEmojis.byId)) if (e) byId[id] = plain(e);
  return { sets, byId };
}

export function useSpaceEmojiData(): SpaceEmojiData {
  return useDerived('composerSpaceEmoji', spaceEmojiData, deepEqual);
}
