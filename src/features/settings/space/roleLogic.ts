/**
 * The role and member rules the space settings pages apply, ported as pure functions from the
 * web's SpaceSettingsModal / SpaceMembersPage / EditMemberRolesDialog so they can be tested
 * and so both clients agree with the server's resolveMemberRoles.
 */
import type { SpaceMember, SpaceRole } from '@web/api/spaces';
import { memberHighestRolePosition } from '@web/lib/spacePermissions';
import { resolveProfile, type SpaceProfileFields } from '@/data/spaceProfileCore';

export const EVERYONE = '@everyone';

export function isEveryone(role: Pick<SpaceRole, 'name'>): boolean {
  return role.name === EVERYONE;
}

/** Custom roles (everything but @everyone), highest first - the hierarchy as Discord shows it. */
export function customRolesDesc(roles: readonly SpaceRole[]): SpaceRole[] {
  return roles.filter((r) => !isEveryone(r)).sort((a, b) => b.position - a.position);
}

/** A role at or above the viewer's highest is out of reach (owner: no ceiling). */
export function roleLocked(role: Pick<SpaceRole, 'position'>, viewerHighest: number): boolean {
  return role.position >= viewerHighest;
}

/** Move one custom role up (towards the top of the hierarchy) or down by one place.
 * `orderDesc` is highest first; returns the new highest-first order (unchanged at an end). */
export function moveRole(orderDesc: readonly SpaceRole[], roleId: string, direction: 'up' | 'down'): SpaceRole[] {
  const next = [...orderDesc];
  const i = next.findIndex((r) => r.id === roleId);
  const j = direction === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= next.length) return next;
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
}

/**
 * The PATCHes that put custom roles in `orderDesc` (highest first). @everyone stays at 0. When
 * the roles hold distinct positions, the new order reuses those same positions, so roles that
 * did not move keep theirs - deleting a role leaves a gap, and renumbering 1..N across it would
 * PATCH roles at or above the editor's own, which the server refuses part-way through. With
 * duplicate positions, custom roles take 1..N from the bottom up, as the web's reorder does.
 * Only roles whose position changes are sent, lowest first.
 */
export function rolePositionPatches(orderDesc: readonly SpaceRole[]): { id: string; position: number }[] {
  const asc = [...orderDesc].reverse();
  const slots = asc.map((r) => r.position).sort((a, b) => a - b);
  const distinct = slots.every((p, i) => p > 0 && (i === 0 || p !== slots[i - 1]));
  return asc
    .map((r, i) => ({ id: r.id, position: distinct ? slots[i]! : i + 1, from: r.position }))
    .filter((p) => p.from !== p.position)
    .map(({ id, position }) => ({ id, position }));
}

/** Whether the role at `index` of a highest-first order may move one place up or down: neither
 * it nor the role it would pass may be out of the viewer's reach (the server refuses both). */
export function canMoveRole(orderDesc: readonly SpaceRole[], index: number, direction: 'up' | 'down', viewerHighest: number): boolean {
  const role = orderDesc[index];
  const other = orderDesc[direction === 'up' ? index - 1 : index + 1];
  if (!role || !other) return false;
  return !roleLocked(role, viewerHighest) && !roleLocked(other, viewerHighest);
}

/** The everyone role id for a space (its field, or the role named @everyone). */
export function everyoneRoleId(space: { everyone_role_id?: string } | undefined, roles: readonly SpaceRole[]): string | undefined {
  return space?.everyone_role_id ?? roles.find(isEveryone)?.id;
}

export interface HierarchyContext {
  ownerId: string | undefined;
  viewerId: string | null | undefined;
  roles: readonly SpaceRole[];
  everyoneId: string | undefined;
  /** Viewer's highest role position; +Infinity for the owner. */
  viewerHighest: number;
}

function targetHighest(m: SpaceMember, ctx: HierarchyContext): number {
  return memberHighestRolePosition(ctx.everyoneId, ctx.roles as SpaceRole[], m);
}

/** Kick / ban: never yourself, never the owner; the owner may moderate anyone; otherwise the target must rank below you. */
export function canModerateMember(m: SpaceMember, ctx: HierarchyContext): boolean {
  if (m.id === ctx.ownerId || m.id === ctx.viewerId) return false;
  if (ctx.viewerId && ctx.viewerId === ctx.ownerId) return true;
  return targetHighest(m, ctx) < ctx.viewerHighest;
}

/**
 * Editing someone's roles: yourself always (the owner included - the self carve-out), never
 * another owner, the owner anyone, otherwise only members ranked below you. Needs Manage Roles.
 */
export function canEditMemberRoles(m: SpaceMember, ctx: HierarchyContext, canManageRoles: boolean): boolean {
  if (!canManageRoles) return false;
  if (m.id === ctx.viewerId) return true;
  if (m.id === ctx.ownerId) return false;
  if (ctx.viewerId && ctx.viewerId === ctx.ownerId) return true;
  return targetHighest(m, ctx) < ctx.viewerHighest;
}

/** Only the owner may change the owner's roles - but they may, on themselves. */
export function canAssignRoleTo(userId: string, ctx: Pick<HierarchyContext, 'ownerId' | 'viewerId'>): boolean {
  return userId === ctx.viewerId || userId !== ctx.ownerId;
}

/** A member's custom role ids after adding or removing one, other custom roles kept. */
export function memberRolesWith(member: Pick<SpaceMember, 'roles'>, roles: readonly SpaceRole[], roleId: string, add: boolean): string[] {
  const custom = new Set(roles.filter((r) => !isEveryone(r)).map((r) => r.id));
  const next = new Set((member.roles ?? []).filter((id) => custom.has(id)));
  if (add) next.add(roleId);
  else next.delete(roleId);
  return [...next];
}

export type MemberSort = 'joined_desc' | 'joined_asc' | 'name';

/** A member as these pages list them: by their space profile. */
type ListedMember = SpaceMember & SpaceProfileFields;

/** The name a member is listed by here: their nickname, else display name, else username. */
const memberName = (m: ListedMember) => resolveProfile(m, m, m.username).name;

/** The nickname, display name or username contains the (lowercased) query. */
function nameMatches(m: ListedMember, q: string): boolean {
  return [m.nick, m.display_name, m.username].some((n) => !!n && n.toLowerCase().includes(q));
}

/** SpaceMembersPage's search (nickname, name, username or exact id), role filter and sort. */
export function filterMembers<M extends ListedMember>(members: readonly M[], opts: { query: string; roleId: string; sort: MemberSort }): M[] {
  const q = opts.query.trim().toLowerCase();
  let list = members.filter((m) => {
    if (opts.roleId && !(m.roles ?? []).includes(opts.roleId)) return false;
    if (!q) return true;
    return nameMatches(m, q) || m.id === q;
  });
  const joined = (m: M) => (m.joined_at ? new Date(m.joined_at).getTime() : 0);
  switch (opts.sort) {
    case 'joined_asc':
      list = [...list].sort((a, b) => joined(a) - joined(b));
      break;
    case 'name':
      list = [...list].sort((a, b) => memberName(a).localeCompare(memberName(b), undefined, { sensitivity: 'base' }));
      break;
    default:
      list = [...list].sort((a, b) => joined(b) - joined(a));
  }
  return list;
}

/** Members who could be given a role: not holding it, assignable by the viewer, matching the search (max 50). */
export function addableMembers<M extends ListedMember>(members: readonly M[], roleId: string, query: string, ctx: Pick<HierarchyContext, 'ownerId' | 'viewerId'>): M[] {
  const q = query.trim().toLowerCase();
  return members
    .filter((m) => !m.roles?.includes(roleId) && canAssignRoleTo(m.id, ctx))
    .filter((m) => !q || nameMatches(m, q))
    .slice(0, 50);
}
