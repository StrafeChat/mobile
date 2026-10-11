/**
 * Recently used emoji, shared with the web's EmojiPicker: the same localStorage key and entry
 * format (`u:<unicode>` / `c:<customEmojiId>`, newest first, 32 kept), so the picker's
 * "Frequently used" row and the quick-reaction strip agree across both clients' habits on
 * this device.
 */
export const RECENT_KEY = 'strafe_emoji_recent';
export const RECENT_MAX = 32;

/** Discord's defaults for the quick-reaction strip before anything has been used. */
export const DEFAULT_QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export type EmojiPick = { unicode: string } | { customId: string };

export function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecent(key: string): void {
  try {
    const next = [key, ...loadRecent().filter((k) => k !== key)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
}

/** The recents key of a pick. */
export function recentKeyOf(pick: EmojiPick): string {
  return 'unicode' in pick ? `u:${pick.unicode}` : `c:${pick.customId}`;
}

/** The reaction key the server uses: the Unicode sequence, or `custom:<id>`. */
export function reactionKeyOf(pick: EmojiPick): string {
  return 'unicode' in pick ? pick.unicode : `custom:${pick.customId}`;
}

/**
 * The quick strip: recent picks the viewer may use here (custom emoji only when allowed:
 * `allowCustom(spaceId)`), topped up with the defaults, `count` long.
 */
export function quickReactions(
  recent: readonly string[],
  allowCustom: (customId: string) => boolean,
  count = 6,
): EmojiPick[] {
  const out: EmojiPick[] = [];
  const seen = new Set<string>();
  for (const key of recent) {
    if (out.length >= count) break;
    if (key.startsWith('u:')) {
      const unicode = key.slice(2);
      if (!unicode || seen.has(`u:${unicode}`)) continue;
      seen.add(`u:${unicode}`);
      out.push({ unicode });
    } else if (key.startsWith('c:')) {
      const id = key.slice(2);
      if (!id || seen.has(key) || !allowCustom(id)) continue;
      seen.add(key);
      out.push({ customId: id });
    }
  }
  for (const unicode of DEFAULT_QUICK_REACTIONS) {
    if (out.length >= count) break;
    if (seen.has(`u:${unicode}`)) continue;
    seen.add(`u:${unicode}`);
    out.push({ unicode });
  }
  return out;
}
