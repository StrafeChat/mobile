/**
 * Nicknames and space profiles from a person's menus: the "Change Nickname" sheet (the web's
 * NicknameDialog, as a bottom sheet) and the fields that put the nickname entries into the
 * web's menu builder.
 *
 * Plain functions and a subscribable value, no React, so the chat's author menu, the member
 * drawer, the profile sheet and the space settings' member list share one rule; the host
 * (members/NicknameSheet.tsx, mounted by RoomHosts) renders the sheet.
 *
 * The entries themselves - Edit Space Profile and Change Nickname on yourself, Change Nickname
 * and Reset Space Profile on someone you outrank with Manage Nicknames, before kick and ban -
 * are the web's buildSpaceModerationItems (lib/userContextMenu), with its confirmResetSpaceProfile
 * behind the reset. spaceProfileMenuFields gives a caller the four fields that builder needs
 * from the stores. Space Settings > Members builds its own entries, as the web's
 * SpaceMembersPage does, and runs the same confirmResetSpaceProfile.
 */
import { auth } from '@web/stores/auth';
import type { SpaceModerationContext } from '@web/lib/userContextMenu';
import { spaces, spaceRoles } from '@web/stores/spaces';
import { mySpaceMember, spaceAbilities, spaceMemberOf } from '@/data';
import { openSpaceProfile } from '@/features/settings';
import { createExternalStore } from '@/ui';

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

// ---- menu fields ----------------------------------------------------------------------------------

export type SpaceProfileMenuFields = Pick<
  SpaceModerationContext,
  'canChangeOwnNickname' | 'canManageNicknames' | 'onEditNickname' | 'onEditSpaceProfile'
>;

/**
 * The nickname fields of buildSpaceModerationItems' context for `userId` in `spaceId`, read
 * from the stores now: the viewer's Change / Manage Nicknames, and the actions - the nickname
 * sheet and Settings > Space Profiles. Empty outside a space. The actions are left out for
 * someone without a member row there (an old message's author who has left): the web builder
 * offers Change Nickname without checking, and there is no nickname to change (the PATCH
 * answers 404); the reset needs a row anyway. Your own entries stay while your row loads.
 * Pass the viewer's highest role position from the same spaceAbilities (or the room's gates,
 * which carry it) alongside, as the builder ranks the target against it.
 */
export function spaceProfileMenuFields(spaceId: string | null | undefined, userId: string): SpaceProfileMenuFields {
  if (!spaceId) return {};
  const me = auth.user?.id;
  const abilities = spaceAbilities(
    spaces.spaces.find((s) => s.id === spaceId),
    spaceRoles(spaceId),
    mySpaceMember(spaceId),
    me,
  );
  const reachable = userId === me || !!spaceMemberOf(spaceId, userId);
  return {
    canChangeOwnNickname: abilities.canChangeOwnNickname,
    canManageNicknames: abilities.canManageNicknames,
    ...(reachable
      ? {
          onEditNickname: (uid: string) => presentNicknameSheet({ spaceId, userId: uid }),
          onEditSpaceProfile: () => openSpaceProfile(spaceId),
        }
      : {}),
  };
}
