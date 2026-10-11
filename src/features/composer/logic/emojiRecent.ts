/**
 * The emoji picker's "Frequently used" list - the web's own key and format
 * ('strafe_emoji_recent', newest first, max 32, 'u:<unicode>' / 'c:<custom id>'), kept in
 * localStorage, which the app backs with MMKV. Shared with the web code that reads it.
 */
export const RECENT_KEY = 'strafe_emoji_recent';
export const RECENT_MAX = 32;

export function loadRecentEmoji(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

export function pushRecentEmoji(key: string): string[] {
  const next = [key, ...loadRecentEmoji().filter((k) => k !== key)].slice(0, RECENT_MAX);
  try {
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: the list just doesn't persist
  }
  return next;
}
