/**
 * A member row's long-press menu: the shared web builders (lib/userContextMenu) with the
 * space moderation extras - kick / ban against members below the viewer, or "Remove from
 * group" for a group's creator - and the confirms the web's pages put in front of them.
 */
import { banSpaceMember, kickSpaceMember } from '@web/api/spaces';
import { buildSpaceModerationItems, buildUserMenuItems } from '@web/lib/userContextMenu';
import { confirmDialog } from '@web/stores/confirmDialog';
import type { ContextMenuItem } from '@web/stores/contextMenu';
import { spaces, spaceRoles } from '@web/stores/spaces';
import { rooms } from '@web/stores/rooms';
import { auth } from '@web/stores/auth';
import { t } from '@web/i18n/t';
import { mySpaceMember, spaceAbilities, type MemberRowView } from '@/data';
import { toast, type ActionItem } from '@/ui';
import { messageUser } from '../navigation';
import { removeFromGroup } from '../roomActions';
import { errorMessage } from '../util';

export async function kickMember(spaceId: string, userId: string): Promise<void> {
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
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export async function banMember(spaceId: string, userId: string): Promise<void> {
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
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

export interface MemberMenuContext {
  /** A space channel / thread's space, or null for a group PM. */
  spaceId: string | null;
  roomId: string;
}

/** The items for one member, in the web's order (message, friend, copy, block, report, then moderation). */
export function memberMenuItems(row: MemberRowView, ctx: MemberMenuContext): ActionItem[] {
  const me = auth.user?.id;
  let extraItems: ContextMenuItem[];
  if (ctx.spaceId) {
    const sid = ctx.spaceId;
    const sp = spaces.spaces.find((s) => s.id === sid);
    const roles = spaceRoles(sid);
    const abilities = spaceAbilities(sp, roles, mySpaceMember(sid), me);
    extraItems = buildSpaceModerationItems({
      spaceId: sid,
      targetUserId: row.id,
      targetRoleIds: row.roleIds,
      currentUserId: me,
      spaceOwnerId: sp?.owner_id,
      spaceRoles: roles,
      viewerHighestRolePosition: abilities.viewerHighestRolePosition,
      canKickMembers: abilities.canKickMembers,
      canBanMembers: abilities.canBanMembers,
      onKick: (id) => void kickMember(sid, id),
      onBan: (id) => void banMember(sid, id),
    });
  } else {
    const room = rooms.rooms.find((r) => r.id === ctx.roomId);
    const creator = room?.creator_id && room.creator_id !== '0' ? room.creator_id : undefined;
    extraItems = buildSpaceModerationItems({
      targetUserId: row.id,
      currentUserId: me,
      canRemoveFromGroup: !!creator && creator === me && row.id !== me,
      onRemoveFromGroup: (id) => void removeFromGroup(ctx.roomId, id, row.displayName),
    });
  }
  return buildUserMenuItems({
    userId: row.id,
    bot: row.bot,
    username: row.username,
    displayName: row.displayName,
    homeDomain: row.homeDomain,
    currentUserId: me,
    onMessage: (id) => void messageUser(id),
    ...(ctx.spaceId ? { spaceId: ctx.spaceId } : {}),
    roomId: ctx.roomId,
    extraItems,
  });
}
