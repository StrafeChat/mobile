/**
 * Showing someone's profile from the room area: the profile sheet (the web's popover) with
 * the subject built by the web's canonical builders, and - in a space - the role context the
 * sheet needs to offer role editing, exactly as the web's member list and message authors
 * build it.
 */
import type { SpaceMemberRoleEditContext } from '@web/stores/userProfilePopover';
import { auth } from '@web/stores/auth';
import { spaces, spaceRoles } from '@web/stores/spaces';
import { spaceMembers, loadSpaceMembers } from '@web/stores/spaceMembers';
import { presentProfileSheet } from '@/platform/presenters';
import { mySpaceMember, profileSubject, spaceAbilities, spaceIdOfRoom } from '@/data';
import { messageUser } from '../navigation';

export interface ProfileContext {
  roomId?: string | null;
  spaceId?: string | null;
}

/**
 * The role editor's context for `userId` in a space (null when the space has no roles yet -
 * the web only passes one when there are roles to show). Plain copies, never store proxies:
 * the sheet keeps its own state and must not end up writing into the spaces store.
 */
export function spaceRoleContextFor(spaceId: string, userId: string): SpaceMemberRoleEditContext | null {
  const sp = spaces.spaces.find((s) => s.id === spaceId);
  const roles = spaceRoles(spaceId);
  if (!sp || !roles?.length) return null;
  const member = spaceMembers.bySpaceId[spaceId]?.find((m) => m.id === userId) as { roles?: string[] } | undefined;
  const me = auth.user?.id;
  const abilities = spaceAbilities(sp, roles, mySpaceMember(spaceId), me);
  return {
    spaceId,
    spaceOwnerId: sp.owner_id,
    subjectRoleIds: [...(member?.roles ?? [])],
    spaceRoles: roles.map((r) => ({ ...r })),
    canManageMemberRoles: abilities.canManageRoles,
    viewerHighestPosition: abilities.viewerHighestRolePosition,
    onMemberRolesUpdated: () => {
      void loadSpaceMembers(spaceId).catch(() => undefined);
    },
  };
}

/** Open the profile sheet for someone seen in a room or space. */
export function showUserProfile(userId: string, ctx: ProfileContext = {}): void {
  const spaceId = ctx.spaceId ?? (ctx.roomId ? spaceIdOfRoom(ctx.roomId) : undefined) ?? null;
  presentProfileSheet({
    subject: profileSubject(userId, { roomId: ctx.roomId ?? null, spaceId }),
    currentUserId: auth.user?.id,
    onMessageUser: (id) => void messageUser(id),
    spaceRoleContext: spaceId ? spaceRoleContextFor(spaceId, userId) : null,
  });
}
