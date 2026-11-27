/**
 * Permission-override rules for room settings (SpaceRoomSettingsModal), as pure functions:
 * which rows a room shows, the private-section switch, and how an override reads in a list.
 * Masks go through the web's permBits (BigInt underneath): Manage Webhooks (bit 31) and
 * Masquerade (bit 32) do not survive JS's 32-bit `&`/`|`/`~`.
 */
import type { SpaceRoom, SpaceRoomOverride } from '@web/api/spaces';
import {
  hasAnyPerm,
  hasPerm,
  orPerms,
  PermViewChannel,
  ROOM_OVERRIDE_PERM_ROWS,
  VOICE_ROOM_OVERRIDE_PERM_ROWS,
  withoutPerms,
  type PermInput,
  type PermRow,
} from '@web/lib/spacePermissions';
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
  return !!ov && hasAnyPerm(ov.deny, PermViewChannel);
}

/**
 * What turning "private section" on or off does to the @everyone override: on denies View
 * (and drops any allow of it); off removes the View deny, deleting the override outright
 * when nothing is left in it (the web's togglePrivateCategory).
 */
export function privateSectionChange(
  existing: { allow: PermInput; deny: PermInput } | undefined,
  makePrivate: boolean,
): { action: 'put'; allow: number; deny: number } | { action: 'delete' } {
  const allow = withoutPerms(existing?.allow, PermViewChannel);
  const deny = makePrivate ? orPerms(existing?.deny, PermViewChannel) : withoutPerms(existing?.deny, PermViewChannel);
  if (!makePrivate && allow === 0 && deny === 0) return { action: 'delete' };
  return { action: 'put', allow, deny };
}

/** How many of a room's override rows an override allows and denies. */
export function overrideCounts(o: { allow: PermInput; deny: PermInput }, rows: readonly PermRow[]): { allowed: number; denied: number } {
  let allowed = 0;
  let denied = 0;
  for (const r of rows) {
    if (hasPerm(o.deny, r.bit)) denied++;
    else if (hasPerm(o.allow, r.bit)) allowed++;
  }
  return { allowed, denied };
}
