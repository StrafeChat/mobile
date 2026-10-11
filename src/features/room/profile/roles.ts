/**
 * The profile sheet's role editor rules, ported from the web's UserProfilePopover so the
 * chips, the locks and the "add" list agree with what the server enforces
 * (spaces/resolveMemberRoles):
 *
 * - editing needs Manage Roles and a role other than @everyone to exist;
 * - only the owner may change the owner's roles - and they may, on themselves (the self
 *   carve-out: how an owner gives themselves a colour or a hoisted title);
 * - a role at or above the viewer's highest position is locked (neither added nor removed),
 *   and a bot's managed role is never handed out or taken away here.
 */
import type { SpaceRole } from '@web/api/spaces';
import type { SpaceMemberRoleEditContext } from '@web/stores/userProfilePopover';

export const EVERYONE_ROLE_NAME = '@everyone';

type Ctx = Pick<SpaceMemberRoleEditContext, 'spaceOwnerId' | 'subjectRoleIds' | 'spaceRoles' | 'canManageMemberRoles' | 'viewerHighestPosition'>;

/** May the viewer change this member's roles at all? */
export function canEditMemberRoles(ctx: Ctx | null | undefined, subjectUserId: string | undefined, viewerId: string | undefined): boolean {
  if (!ctx?.canManageMemberRoles || !subjectUserId) return false;
  if (subjectUserId === ctx.spaceOwnerId && subjectUserId !== viewerId) return false;
  return ctx.spaceRoles.some((r) => r.name !== EVERYONE_ROLE_NAME);
}

/** The member's own roles as a set, without @everyone. */
export function pickedFromContext(ctx: Ctx | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!ctx) return out;
  const everyoneId = ctx.spaceRoles.find((r) => r.name === EVERYONE_ROLE_NAME)?.id;
  for (const id of ctx.subjectRoleIds) if (id && id !== everyoneId) out.add(id);
  return out;
}

/** Roles at or above this the viewer may neither add nor take away (Infinity = no ceiling). */
export function roleCeiling(ctx: Ctx | null | undefined): number {
  return ctx?.viewerHighestPosition ?? Number.POSITIVE_INFINITY;
}

export function roleLocked(role: Pick<SpaceRole, 'position'>, ctx: Ctx | null | undefined): boolean {
  return role.position >= roleCeiling(ctx);
}

/** Whether a chip shows its remove control. */
export function roleRemovable(role: Pick<SpaceRole, 'position' | 'bot_id'>, ctx: Ctx | null | undefined, editable: boolean): boolean {
  return editable && !roleLocked(role, ctx) && !role.bot_id;
}

/** The chips, highest position first: the picked set while editable, else the member's roles. */
export function displayedRoles(ctx: Ctx | null | undefined, picked: ReadonlySet<string>, editable: boolean): SpaceRole[] {
  if (!ctx) return [];
  const byId = new Map(ctx.spaceRoles.map((r) => [r.id, r]));
  const ids = editable ? [...picked] : ctx.subjectRoleIds;
  const out: SpaceRole[] = [];
  for (const id of ids) {
    const r = byId.get(id);
    if (r && r.name !== EVERYONE_ROLE_NAME && !out.includes(r)) out.push(r);
  }
  return out.sort((a, b) => b.position - a.position);
}

/** What the "+" offers: not @everyone, not bot-managed, not held, below the ceiling. */
export function rolesAvailableToAdd(ctx: Ctx | null | undefined, picked: ReadonlySet<string>, editable: boolean): SpaceRole[] {
  if (!ctx || !editable) return [];
  return ctx.spaceRoles
    .filter((r) => r.name !== EVERYONE_ROLE_NAME && !r.bot_id && !picked.has(r.id) && !roleLocked(r, ctx))
    .sort((a, b) => b.position - a.position);
}

/** The ids to store after a save: @everyone first, then the chosen roles. */
export function mergedRoleIds(ctx: Ctx, chosen: readonly string[]): string[] {
  const everyoneId = ctx.spaceRoles.find((r) => r.name === EVERYONE_ROLE_NAME)?.id;
  const merged: string[] = [];
  if (everyoneId) merged.push(everyoneId);
  for (const id of chosen) if (!merged.includes(id)) merged.push(id);
  return merged;
}
