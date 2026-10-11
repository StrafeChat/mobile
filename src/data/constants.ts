/**
 * Room types as the server numbers them (equinox rooms/model.go). The web spells these as
 * bare numbers inline; naming them once here keeps the data layer readable.
 */
export const ROOM_TYPE_PM = 1;
export const ROOM_TYPE_GROUP = 2;
export const ROOM_TYPE_TEXT = 3;
export const ROOM_TYPE_VOICE = 4;
export const ROOM_TYPE_SECTION = 5;
export const ROOM_TYPE_THREAD = 6;

/** Text channels and threads both hold a message list (SpacePage's isTextLike). */
export function isTextLike(type: number | undefined): boolean {
  return type === ROOM_TYPE_TEXT || type === ROOM_TYPE_THREAD;
}

/** A snowflake id (temp ids of optimistic sends are not). Same test the web uses inline. */
export function isSnowflakeId(id: string): boolean {
  return /^\d+$/.test(id);
}

/**
 * The newest real message id among `list`, else `fallback` (the room's last_message_id). What
 * every "Mark as read" in the web acks to - RoomsBar, SpaceRoomsBar and lib/mobileNotifications
 * each carry this same reduction inline.
 */
export function latestSnowflakeId(
  list: ReadonlyArray<{ id: string }> | undefined,
  fallback: string | null | undefined,
): string | null {
  let best: string | null = null;
  let bestN = 0n;
  for (const m of list ?? []) {
    if (!isSnowflakeId(m.id)) continue;
    const n = BigInt(m.id);
    if (best === null || n > bestN) {
      best = m.id;
      bestN = n;
    }
  }
  return best ?? fallback ?? null;
}

/** Badge text with the web's 99+ cap. */
export function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}
