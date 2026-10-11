/**
 * People in a conversation: the profile sheet for an author or a mention, and the long-press
 * user menu - the web list's openProfileForUser / openAuthorMenu, with the same builders
 * (lib/userProfilePopoverHelpers through src/data's profileSubject, lib/userContextMenu).
 */
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { spaces, spaceRoles } from '@web/stores/spaces';
import { spaceMembers, loadSpaceMembers } from '@web/stores/spaceMembers';
import { confirmDialog } from '@web/stores/confirmDialog';
import { banSpaceMember, kickSpaceMember } from '@web/api/spaces';
import { viewerRoleCeiling } from '@web/lib/spacePermissions';
import { buildSpaceModerationItems, buildUserMenuItems } from '@web/lib/userContextMenu';
import type { SpaceMemberRoleEditContext } from '@web/stores/userProfilePopover';
import { findParticipant, profileSubject, roomGates, userDisplay, type UserContext } from '@/data';
import { presentProfileSheet } from '@/platform/presenters';
import { showActionSheet, toast } from '@/ui';
import { errorText, messageUser } from './navigation';

function spaceIdFor(ctx: UserContext): string | null {
  return ctx.spaceId ?? null;
}

/** The role editor inside the profile sheet, when this is a space with roles (web: openProfileForUser). */
function roleContext(userId: string, ctx: UserContext): SpaceMemberRoleEditContext | null {
  const spaceId = spaceIdFor(ctx);
  if (!spaceId) return null;
  const roles = spaceRoles(spaceId);
  if (!roles || roles.length === 0) return null;
  const space = spaces.spaces.find((s) => s.id === spaceId);
  const p = findParticipant(userId, ctx);
  const gates = ctx.roomId ? roomGates(ctx.roomId, spaceId) : undefined;
  return {
    spaceId,
    spaceOwnerId: space?.owner_id ?? '',
    subjectRoleIds: [...(p?.roles ?? [])],
    spaceRoles: roles,
    canManageMemberRoles: gates?.canManageRoles === true,
    viewerHighestPosition: viewerRoleCeiling(space?.owner_id, auth.user?.id, roles, spaceMembers.bySpaceId[spaceId]),
    onMemberRolesUpdated: () => void loadSpaceMembers(spaceId).catch(() => undefined),
  };
}

/** Tap on an avatar, a name or a mention pill. */
export function openUserProfile(userId: string, ctx: UserContext): void {
  presentProfileSheet({
    subject: profileSubject(userId, ctx),
    currentUserId: auth.user?.id,
    onMessageUser: messageUser,
    spaceRoleContext: roleContext(userId, ctx),
  });
}

async function kick(spaceId: string, userId: string): Promise<void> {
  const ok = await confirmDialog({
    title: t('room.members.kick'),
    body: t('space.kickConfirm'),
    confirmLabel: t('room.members.kick'),
    tone: 'danger',
    icon: 'fa-solid fa-user-minus',
  });
  if (!ok) return;
  try {
    await kickSpaceMember(spaceId, userId);
  } catch (err) {
    toast.error(errorText(err));
  }
}

async function ban(spaceId: string, userId: string): Promise<void> {
  const ok = await confirmDialog({
    title: t('room.members.ban'),
    body: t('space.banConfirm'),
    confirmLabel: t('room.members.ban'),
    tone: 'danger',
    icon: 'fa-solid fa-ban',
  });
  if (!ok) return;
  try {
    await banSpaceMember(spaceId, userId);
  } catch (err) {
    toast.error(errorText(err));
  }
}

/** The user menu items for a message author (the same as a member row's). */
export function authorMenuItems(userId: string, ctx: UserContext) {
  const me = auth.user?.id;
  const d = userDisplay(userId, ctx);
  const spaceId = spaceIdFor(ctx);
  const space = spaceId ? spaces.spaces.find((s) => s.id === spaceId) : undefined;
  const gates = ctx.roomId ? roomGates(ctx.roomId, spaceId) : undefined;
  const p = findParticipant(userId, ctx);
  return buildUserMenuItems({
    userId,
    bot: d.bot,
    username: d.username || '',
    displayName: d.name,
    homeDomain: d.homeDomain,
    currentUserId: me,
    onMessage: messageUser,
    spaceId: spaceId ?? undefined,
    roomId: ctx.roomId ?? undefined,
    extraItems: buildSpaceModerationItems({
      spaceId: spaceId ?? undefined,
      targetUserId: userId,
      targetRoleIds: p?.roles,
      currentUserId: me,
      spaceOwnerId: space?.owner_id,
      spaceRoles: spaceId ? spaceRoles(spaceId) : undefined,
      viewerHighestRolePosition: gates?.viewerHighestRolePosition,
      canKickMembers: gates?.canKickMembers,
      canBanMembers: gates?.canBanMembers,
      onKick: spaceId ? (uid) => void kick(spaceId, uid) : undefined,
      onBan: spaceId ? (uid) => void ban(spaceId, uid) : undefined,
    }),
  });
}

/** Long-press on an avatar or a name. */
export function showAuthorMenu(userId: string, ctx: UserContext): void {
  const items = authorMenuItems(userId, ctx);
  if (items.length === 0) return;
  void showActionSheet(items, { title: userDisplay(userId, ctx).name });
}
