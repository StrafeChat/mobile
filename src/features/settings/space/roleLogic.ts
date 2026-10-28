/**
 * The role and member rules the space settings pages apply, as pure functions so they can be
 * tested and so both clients agree with the server (spaces/service_roles.go, Discord's rules):
 *
 * - a role can be edited, deleted, moved, given or taken away only when it is strictly below the
 *   viewer's highest role (the owner: any) - `roleLocked`;
 * - giving or taking a role depends on the role alone, never on the member: Manage Roles reaches
 *   anyone's roles, the owner's and those of people ranked above the viewer included
 *   (`roleAssignable`, the web's canChangeMemberRole). A bot's managed role is never given to
 *   anyone nor taken from its bot;
 * - kick and ban still need the member ranked below the viewer (`canModerateMember`).
 *
 * The order itself is the web's lib/roleOrder (customRolesHighestFirst, planRoleOrder): one
 * implementation for both clients.
 */
import type { SpaceMember, SpaceRole } from '@web/api/spaces';
import { t } from '@web/i18n/t';
import { translateRoleApiError } from '@web/lib/formatApiError';
import { planRoleOrder, customRolesHighestFirst, type RoleOrderPlan } from '@web/lib/roleOrder';
import { canChangeMemberRole, memberHighestRolePosition } from '@web/lib/spacePermissions';
import { resolveProfile, type SpaceProfileFields } from '@/data/spaceProfileCore';

export const EVERYONE = '@everyone';

export function isEveryone(role: Pick<SpaceRole, 'name'>): boolean {
  return role.name === EVERYONE;
}

/** A role at or above the viewer's highest is out of reach (owner: no ceiling). */
export function roleLocked(role: Pick<SpaceRole, 'position'>, viewerHighest: number): boolean {
  return role.position >= viewerHighest;
}

/**
 * Whether the viewer may give this role to members and take it back - any member, the owner and
 * people ranked above the viewer included (the web's roleAssignable): Manage Roles, a role below
 * the viewer's highest, not @everyone, not a bot's managed role.
 */
export function roleAssignable(role: Pick<SpaceRole, 'name' | 'position' | 'bot_id'>, viewerHighest: number, canManageRoles: boolean): boolean {
  return canManageRoles && canChangeMemberRole(role, viewerHighest);
}

/**
 * The roles the Edit roles sheet lists for `memberId`, highest first (the web's
 * EditMemberRolesDialog): another bot's managed role is left out, since nobody else can ever
 * hold it; the member's own - when the member is that bot - is shown, held and locked.
 */
export function memberRoleChoices(roles: readonly SpaceRole[], memberId: string | undefined): SpaceRole[] {
  return customRolesHighestFirst(roles).filter((r) => !r.bot_id || r.bot_id === memberId);
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

/** Whether the role at `index` of a highest-first order may move one place up or down: neither
 * it nor the role it would pass may be out of the viewer's reach (the server refuses both). */
export function canMoveRole(orderDesc: readonly SpaceRole[], index: number, direction: 'up' | 'down', viewerHighest: number): boolean {
  const role = orderDesc[index];
  const other = orderDesc[direction === 'up' ? index - 1 : index + 1];
  if (!role || !other) return false;
  return !roleLocked(role, viewerHighest) && !roleLocked(other, viewerHighest);
}

/** What saving an edited role order sends (api/spaces saveSpaceRoleOrder takes `plan`). */
export interface RoleReorder {
  plan: RoleOrderPlan;
  /** A position the plan asks for is at or above the viewer's own: only when legacy ties leave
   * more roles than free places below the viewer. The server would refuse it, so nothing is sent. */
  outOfReach: boolean;
}

/**
 * The save for an order edited in the Roles list: `edited` (highest first, as the list showed
 * it) is read against the space's roles as they are now - a role deleted meanwhile drops out,
 * and positions are the current ones, so a role another device moved is not written from a
 * stale copy - and the roles below the viewer (the owner: all of them) take the positions they
 * hold between them in the new order (the web's planRoleOrder). Nothing at or above the viewer
 * is written.
 */
export function roleReorder(roles: readonly SpaceRole[], edited: readonly Pick<SpaceRole, 'id'>[], viewerHighest: number): RoleReorder {
  const current = customRolesHighestFirst(roles);
  const byId = new Map(current.map((r) => [r.id, r]));
  const next = edited.map((r) => byId.get(r.id)).filter((r): r is SpaceRole => !!r);
  const movable = new Set(current.filter((r) => !roleLocked(r, viewerHighest)).map((r) => r.id));
  const plan = planRoleOrder(next, movable);
  return { plan, outOfReach: plan.positions.some((p) => p.position >= viewerHighest) };
}

/** An error from a role surface (the list, the editor, a member's roles), translated with the
 * role wording for the hierarchy refusal; `fallbackKey` when there is nothing to say. */
export function roleErrorText(err: unknown, fallbackKey: string): string {
  return translateRoleApiError(err, t).join(' ') || t(fallbackKey);
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

/** Kick / ban: never yourself, never the owner; the owner may moderate anyone; otherwise the
 * target must rank below you. Unlike roles, these do depend on the member's rank (Discord too). */
export function canModerateMember(m: SpaceMember, ctx: HierarchyContext): boolean {
  if (m.id === ctx.ownerId || m.id === ctx.viewerId) return false;
  if (ctx.viewerId && ctx.viewerId === ctx.ownerId) return true;
  return targetHighest(m, ctx) < ctx.viewerHighest;
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

/** Members who could be given a role: not holding it, matching the search (max 50). Anyone - the
 * owner and members ranked above the viewer included: whether the role can be given is the
 * role's question (roleAssignable), not the member's. */
export function addableMembers<M extends ListedMember>(members: readonly M[], roleId: string, query: string): M[] {
  const q = query.trim().toLowerCase();
  return members
    .filter((m) => !m.roles?.includes(roleId))
    .filter((m) => !q || nameMatches(m, q))
    .slice(0, 50);
}
