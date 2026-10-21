/**
 * Member list grouping - RoomMembersSidebar's partition, pure, so the RN list and the web
 * sidebar sort and group people identically.
 *
 * Group PMs (no space roles): one flat list, online people first then offline (dimmed), each
 * by name. Spaces: one section per hoisted role (highest position first) holding the online
 * members whose highest hoisted role it is, then "Online" for online members with none, then
 * "Offline" (dimmed). Online means online, idle or dnd - the live presence map first, the
 * member object's own presence as the fallback.
 */
import type { SpaceRole, SpaceRoomOverride, SpaceRoomUserOverride } from '@web/api/spaces';
import { effectiveChannelPermissionsForMember, hasPerm, highestHoistedRole, PermViewChannel } from '@web/lib/spacePermissions';
import { resolveProfile } from './spaceProfileCore';

export interface MemberLike {
  id: string;
  username: string;
  display_name: string;
  /** Their nickname in the space, which they are listed (and sorted) by. */
  nick?: string | null;
  roles?: string[];
}

export function isOnlineStatus(status: string | undefined): boolean {
  return status === 'online' || status === 'idle' || status === 'dnd';
}

/** Case- and accent-insensitive by the name the list shows: the nickname, else the display
 * name, else the username. */
export function compareByDisplayName(a: MemberLike, b: MemberLike): number {
  const name = (m: MemberLike) => resolveProfile(m, m, m.username).name;
  return name(a).localeCompare(name(b), undefined, { sensitivity: 'base' });
}

export type MemberListItem =
  | {
      kind: 'header';
      key: string;
      /** A role's name, or the translated Online / Offline / Members label. */
      label: string;
      count: number;
      group: 'role' | 'online' | 'offline' | 'members';
      roleId?: string;
    }
  | { kind: 'member'; key: string; userId: string; dim: boolean };

export interface MemberListLabels {
  online: string;
  offline: string;
  members: string;
}

export interface BuildMemberListInput<M extends MemberLike> {
  members: readonly M[];
  /** The space's roles; undefined for a group PM (or roles not loaded yet) - the flat list. */
  roles: readonly SpaceRole[] | undefined;
  statusOf: (member: M) => string | undefined;
  labels: MemberListLabels;
  /** Group PMs: lead with "Members — N" (the web's showMembersHeader). Default true. */
  showMembersHeader?: boolean;
}

export function buildMemberList<M extends MemberLike>(input: BuildMemberListInput<M>): MemberListItem[] {
  const online: M[] = [];
  const offline: M[] = [];
  for (const m of input.members) (isOnlineStatus(input.statusOf(m)) ? online : offline).push(m);
  offline.sort(compareByDisplayName);
  const out: MemberListItem[] = [];
  const member = (m: M, dim: boolean): MemberListItem => ({ kind: 'member', key: `m:${m.id}`, userId: m.id, dim });

  if (input.roles === undefined) {
    online.sort(compareByDisplayName);
    if (input.showMembersHeader !== false) {
      out.push({ kind: 'header', key: 'h:members', label: input.labels.members, count: input.members.length, group: 'members' });
    }
    for (const m of online) out.push(member(m, false));
    for (const m of offline) out.push(member(m, true));
    return out;
  }

  const roles = input.roles as SpaceRole[];
  const groups = new Map<string, M[]>();
  for (const m of online) {
    const hr = highestHoistedRole(m.roles?.length ? m.roles : undefined, roles);
    const key = hr ? hr.id : '';
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(m);
  }
  const hoisted = [...roles].filter((r) => r.hoist).sort((a, b) => b.position - a.position);
  for (const r of hoisted) {
    const list = groups.get(r.id);
    if (!list?.length) continue;
    list.sort(compareByDisplayName);
    out.push({ kind: 'header', key: `h:role:${r.id}`, label: r.name, count: list.length, group: 'role', roleId: r.id });
    for (const m of list) out.push(member(m, false));
  }
  const ungrouped = groups.get('');
  if (ungrouped?.length) {
    ungrouped.sort(compareByDisplayName);
    out.push({ kind: 'header', key: 'h:online', label: input.labels.online, count: ungrouped.length, group: 'online' });
    for (const m of ungrouped) out.push(member(m, false));
  }
  if (offline.length) {
    out.push({ kind: 'header', key: 'h:offline', label: input.labels.offline, count: offline.length, group: 'offline' });
    for (const m of offline) out.push(member(m, true));
  }
  return out;
}

export interface ChannelViewContext {
  ownerId: string;
  everyoneRoleId: string | undefined;
  roles: SpaceRole[] | undefined;
  overrides: SpaceRoomOverride[] | undefined;
  userOverrides: SpaceRoomUserOverride[] | undefined;
}

/**
 * The members who can see a channel (SpacePage's visibleMembers): it feeds the channel's member
 * list, mention autocomplete and typing names. Everyone while roles or overrides are unknown.
 */
export function membersWhoCanView<M extends { id: string; roles?: string[] }>(
  members: readonly M[],
  ctx: ChannelViewContext,
): M[] {
  if (ctx.roles === undefined || ctx.overrides === undefined || ctx.userOverrides === undefined) return [...members];
  const roles = ctx.roles;
  const overrides = ctx.overrides;
  const userOverrides = ctx.userOverrides;
  return members.filter((m) => {
    const mask = effectiveChannelPermissionsForMember({
      memberUserId: m.id,
      ownerId: ctx.ownerId,
      everyoneRoleId: ctx.everyoneRoleId,
      memberRoleIds: m.roles,
      roles,
      overrides,
      userOverrides,
    });
    return mask === null || hasPerm(mask, PermViewChannel);
  });
}
