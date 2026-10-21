/**
 * What every space settings screen needs, read from the shared stores (no per-page fetches):
 * the space, its roles, rooms and members, and the viewer's gates - computed with the web's
 * memberCan* helpers, exactly as SpaceSettingsModal does.
 *
 * Page gating (SpaceSettingsModal.allowed): Overview, System, Discover, Moderation, Invites
 * and Audit log need Manage Space; Roles needs Manage Roles; Emojis needs Manage Emojis (or
 * Manage Space); Members needs any of Manage Space, Manage Roles, Kick, Ban or Manage Nicknames
 * (where nicknames are changed and space profiles reset); Bans needs Ban.
 * The owner and Administrator pass every gate. A mirrored (federated) space is not gated here:
 * the server forwards management to its origin.
 */
import type { SpaceMember, SpaceRole, SpaceRoom } from '@web/api/spaces';
import { spaces } from '@web/stores/spaces';
import { spaceMembers } from '@web/stores/spaceMembers';
import { useSolid } from '@/bridge/solid';
import { useEnsureSpaceData, useMyId, useSpace, useSpaceAbilities, useSpaceRoles, type SpaceView } from '@/data';
import type { SpaceSettingsPageId } from '../routes';

export interface SpaceGates {
  canManageSpace: boolean;
  canManageRoles: boolean;
  canManageEmojis: boolean;
  canKick: boolean;
  canBan: boolean;
  canSeeMembers: boolean;
  isOwner: boolean;
  /** Roles at or above this position are out of the viewer's reach (owner: no ceiling). */
  viewerHighestPosition: number;
}

export function pageAllowed(page: SpaceSettingsPageId, g: SpaceGates): boolean {
  switch (page) {
    case 'overview':
    case 'system':
    case 'discover':
    case 'moderation':
    case 'invites':
    case 'audit':
      return g.canManageSpace;
    case 'roles':
      return g.canManageRoles;
    case 'emojis':
      return g.canManageEmojis;
    case 'members':
      return g.canSeeMembers;
    case 'bans':
      return g.canBan;
  }
}

export interface SpaceSettingsData {
  spaceId: string;
  space: SpaceView | undefined;
  roles: SpaceRole[];
  rolesLoaded: boolean;
  rooms: SpaceRoom[];
  members: SpaceMember[];
  membersLoading: boolean;
  viewerId: string | null;
  gates: SpaceGates;
}

export function useSpaceSettings(spaceId: string): SpaceSettingsData {
  useEnsureSpaceData(spaceId);
  const space = useSpace(spaceId);
  const roles = useSpaceRoles(spaceId);
  const abilities = useSpaceAbilities(spaceId);
  const viewerId = useMyId();
  const rooms = useSolid(() => spaces.spaceRoomsBySpaceId[spaceId] ?? [], [spaceId]) as SpaceRoom[];
  const members = useSolid(() => spaceMembers.bySpaceId[spaceId] ?? [], [spaceId]) as SpaceMember[];
  const membersLoading = useSolid(() => !!spaceMembers.loading[spaceId] && !spaceMembers.bySpaceId[spaceId], [spaceId]);
  const gates: SpaceGates = {
    canManageSpace: abilities.canManageSpace,
    canManageRoles: abilities.canManageRoles,
    canManageEmojis: abilities.canManageEmojis,
    canKick: abilities.canKickMembers,
    canBan: abilities.canBanMembers,
    canSeeMembers:
      abilities.canManageSpace || abilities.canManageRoles || abilities.canKickMembers || abilities.canBanMembers || abilities.canManageNicknames,
    isOwner: abilities.isOwner,
    viewerHighestPosition: abilities.isOwner ? Number.POSITIVE_INFINITY : abilities.viewerHighestRolePosition,
  };
  return { spaceId, space, roles: roles ?? [], rolesLoaded: !!roles, rooms, members, membersLoading, viewerId, gates };
}
