/**
 * Nicknames and space profiles from a person's menus: the "Change Nickname" sheet (the web's
 * NicknameDialog, as a bottom sheet), the menu entries that open it, and a moderator's reset
 * of someone's space profile.
 *
 * Plain functions and a subscribable value, no React, so the chat's author menu, the member
 * drawer, the profile sheet and the space settings' member list share one rule; the host
 * (members/NicknameSheet.tsx, mounted by RoomHosts) renders the sheet.
 *
 * Until the web submodule bump the menu entries are mobile's own (nicknameMenuEntries in
 * src/data/spaceProfileCompat), because the pinned web builder ignores the new context fields.
 * At the bump (step 3 in spaceProfileCompat.ts's header) spaceProfileMenuItems' two callers,
 * room/members/memberActions.ts and chat/people.ts, pass those fields to their
 * buildSpaceModerationItems call instead and spaceProfileMenuItems goes - never both, or the
 * entries show twice. chat/people.ts then passes onEditNickname only for someone with a member
 * row, the rule spaceProfileMenuItems applies here. Space Settings > Members is not a caller:
 * it builds its own entries and keeps them, swapping only resetMemberSpaceProfile below for the
 * web's confirmResetSpaceProfile. presentNicknameSheet stays.
 */
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { confirmDialog } from '@web/stores/confirmDialog';
import type { ContextMenuItem } from '@web/stores/contextMenu';
import { spaces, spaceRoles } from '@web/stores/spaces';
import { upsertSpaceMember } from '@web/stores/spaceMembers';
import {
  mySpaceMember,
  nicknameMenuEntries,
  patchSpaceMember,
  resolveSpaceUser,
  spaceAbilities,
  spaceMemberOf,
  spaceProfileResetPatch,
} from '@/data';
import { openSpaceProfile } from '@/features/settings';
import { createExternalStore, toast } from '@/ui';
import { errorMessage } from './util';

// ---- the sheet ------------------------------------------------------------------------------------

export interface NicknameSheetRequest {
  spaceId: string;
  userId: string;
}

export const nicknameSheetStore = createExternalStore<(NicknameSheetRequest & { id: number }) | null>(null);

let seq = 0;

/** "Change Nickname" for `userId` in `spaceId` - yourself or, with Manage Nicknames, someone
 * ranked below you. The server checks the same rule again. */
export function presentNicknameSheet(request: NicknameSheetRequest): void {
  nicknameSheetStore.set({ ...request, id: ++seq });
}

export function dismissNicknameSheet(): void {
  nicknameSheetStore.set(null);
}

/** What a nickname field's text sends: the trimmed text, or null (cleared) when it is empty,
 * which shows the display name again. */
export function nicknameValue(input: string): string | null {
  return input.trim() || null;
}

// ---- a moderator's reset --------------------------------------------------------------------------

/**
 * Reset someone else's space profile (Manage Nicknames over a lower-ranked member): their
 * avatar, banner, pronouns, About Me and bio here go back to their main profile. The nickname
 * is never part of it - that has its own action, and stays. Confirms first; the server checks
 * the rule again and logs it. At the bump its one remaining caller, Space Settings > Members,
 * calls the web's confirmResetSpaceProfile (@web/lib/userContextMenu) instead and this goes.
 */
export async function resetMemberSpaceProfile(spaceId: string, userId: string): Promise<void> {
  const ok = await confirmDialog({
    title: t('mobile.room.resetSpaceProfile'),
    body: t('mobile.room.resetSpaceProfileBody', { name: resolveSpaceUser(spaceId, userId).name }),
    confirmLabel: t('mobile.room.resetSpaceProfile'),
    tone: 'danger',
    icon: 'fa-solid fa-eraser',
  });
  if (!ok) return;
  try {
    const member = await patchSpaceMember(spaceId, userId, spaceProfileResetPatch({ includeNick: false }));
    // The API calls never touch the stores; the gateway's update would follow, later.
    upsertSpaceMember(spaceId, member);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

// ---- menu entries ---------------------------------------------------------------------------------

/**
 * The nickname and space-profile entries of a person's menu in a space, read from the stores
 * now: for yourself "Edit Space Profile" and, when the space lets you, "Change Nickname"; for
 * someone you outrank with Manage Nicknames, "Change Nickname" and - when they have something
 * set - "Reset Space Profile". Put them before kick and ban. Empty outside a space, and for
 * someone without a member row there (an old message's author who has left): there is no
 * profile to change.
 */
export function spaceProfileMenuItems(spaceId: string | null | undefined, userId: string, targetRoleIds?: string[]): ContextMenuItem[] {
  if (!spaceId) return [];
  const me = auth.user?.id;
  const target = spaceMemberOf(spaceId, userId);
  if (me !== userId && !target) return [];
  const sp = spaces.spaces.find((s) => s.id === spaceId);
  const roles = spaceRoles(spaceId);
  const abilities = spaceAbilities(sp, roles, mySpaceMember(spaceId), me);
  return nicknameMenuEntries({
    spaceId,
    targetUserId: userId,
    targetRoleIds: targetRoleIds ?? target?.roles,
    currentUserId: me,
    spaceOwnerId: sp?.owner_id,
    spaceRoles: roles,
    viewerHighestRolePosition: abilities.viewerHighestRolePosition,
    canChangeOwnNickname: abilities.canChangeOwnNickname,
    canManageNicknames: abilities.canManageNicknames,
    onEditNickname: (uid) => presentNicknameSheet({ spaceId, userId: uid }),
    onEditSpaceProfile: () => openSpaceProfile(spaceId),
    targetProfile: target,
    onResetSpaceProfile: (uid) => void resetMemberSpaceProfile(spaceId, uid),
  });
}
