/**
 * Permission-override rules for room settings (SpaceRoomSettingsModal), as pure functions:
 * which rows a room shows, the private-section switch, and how an override reads in a list.
 */
import type { SpaceRoom, SpaceRoomOverride } from '@web/api/spaces';
import { PermViewChannel, ROOM_OVERRIDE_PERM_ROWS, VOICE_ROOM_OVERRIDE_PERM_ROWS, type PermRow } from '@web/lib/spacePermissions';
import { ROOM_TYPE_SECTION, ROOM_TYPE_VOICE } from './useRoomSettings';

/** Voice rooms override View plus the voice bits; text rooms and sections the text bits. */
export function overrideRowsFor(room: Pick<SpaceRoom, 'type'>): PermRow[] {
  return room.type === ROOM_TYPE_VOICE ? VOICE_ROOM_OVERRIDE_PERM_ROWS : ROOM_OVERRIDE_PERM_ROWS;
}

/** A channel inside a section can sync to it; while synced its overrides are the section's (read-only). */
export function isChannelInSection(room: Pick<SpaceRoom, 'type' | 'parent_id'>): boolean {
  return room.type !== ROOM_TYPE_SECTION && !!room.parent_id;
}

export function isSyncLocked(room: Pick<SpaceRoom, 'type' | 'parent_id' | 'permissions_synced'>): boolean {
  return isChannelInSection(room) && room.permissions_synced === true;
}

/** A section is private when @everyone is denied View on it. */
export function isPrivateSection(overrides: readonly SpaceRoomOverride[] | undefined, everyoneId: string | undefined): boolean {
  const ov = overrides?.find((o) => o.role_id === everyoneId);
  return !!ov && (ov.deny & PermViewChannel) !== 0;
}

/**
 * What turning "private section" on or off does to the @everyone override: on denies View
 * (and drops any allow of it); off removes the View deny, deleting the override outright
 * when nothing is left in it (the web's togglePrivateCategory).
 */
export function privateSectionChange(
  existing: Pick<SpaceRoomOverride, 'allow' | 'deny'> | undefined,
  makePrivate: boolean,
): { action: 'put'; allow: number; deny: number } | { action: 'delete' } {
  const allow = (existing?.allow ?? 0) & ~PermViewChannel;
  const deny = makePrivate ? (existing?.deny ?? 0) | PermViewChannel : (existing?.deny ?? 0) & ~PermViewChannel;
  if (!makePrivate && allow === 0 && deny === 0) return { action: 'delete' };
  return { action: 'put', allow, deny };
}

/** How many of a room's override rows an override allows and denies. */
export function overrideCounts(o: Pick<SpaceRoomOverride, 'allow' | 'deny'>, rows: readonly PermRow[]): { allowed: number; denied: number } {
  let allowed = 0;
  let denied = 0;
  for (const r of rows) {
    if ((o.deny & r.bit) === r.bit) denied++;
    else if ((o.allow & r.bit) === r.bit) allowed++;
  }
  return { allowed, denied };
}
