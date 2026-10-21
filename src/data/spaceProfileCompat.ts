/**
 * Space profiles on mobile until the web submodule bump: everything the bumped web exports for
 * them, by the web's names (lib/spaceProfile, lib/spacePermissions, api/spaces), plus the two
 * stand-ins the pinned web needs - a gateway handler for the profile keys and the nickname
 * menu entries.
 *
 * TEMPORARY - replace every body with re-exports from @web at the submodule bump
 *
 * At the bump, in this order (this list is the follow-up; the notes at each site agree with it):
 *  1. Re-export resolveProfile, spaceMemberOf, resolveSpaceUser, hasResettableSpaceProfile,
 *     spaceProfileResetPatch and the types from @web/lib/spaceProfile, the bits and memberCan*
 *     (memberCanResetSpaceProfile included) / canEditNicknameOf / memberCanEditNickname from
 *     @web/lib/spacePermissions, the API calls, SpaceProfilePatch and SPACE_PROFILE_KEYS from
 *     @web/api/spaces. Delete initSpaceProfileCompatHandlers and its line in platform/boot.ts.
 *  2. Hand the web builders the space BEFORE deleting overlaySenderDisplay and
 *     overlayProfileSubject: the bumped builders set subject.spaceId only when given one, and
 *     the profile sheet's Edit Space Profile and Change Nickname, and the full profile's space,
 *     all hang on it. In data/users.ts profileSubject pass `{ spaceId }` as
 *     popoverSubjectFromParticipant's third argument and add `spaceId` to
 *     popoverSubjectFromSender's opts; in platform/presenters/profileSheet.ts
 *     presentProfileSheetForParticipant pass `{ spaceId }` (opts.spaceId, else the role
 *     context's). selectors.test.ts (`spaceId: 's1'`) and room/__tests__/nickname.test.tsx
 *     guard it. Let platform/overrides/stores/userProfilePopover.ts's
 *     openUserProfileFromParticipant take the web's new `spaceId` too.
 *  3. Menus. spaceProfileMenuItems (room/nicknameSheet.ts) has exactly two callers,
 *     room/members/memberActions.ts and chat/people.ts: each passes canChangeOwnNickname,
 *     canManageNicknames, onEditNickname and onEditSpaceProfile to its own
 *     buildSpaceModerationItems call instead, which then adds Reset Space Profile itself -
 *     never both, or the entries show twice. chat/people.ts passes onEditNickname only when
 *     spaceMemberOf(spaceId, userId) has a row: the web builder offers Change Nickname without
 *     checking, and an old message's author who has left has no nickname to change. Then
 *     delete spaceProfileMenuItems and nicknameMenuEntries. Space Settings > Members
 *     (settings/space/MembersScreen.tsx) uses neither builder - it builds its own entries, as
 *     the web's SpaceMembersPage does - and KEEPS its Change Nickname and Reset Space Profile;
 *     there only resetMemberSpaceProfile is swapped for the web's confirmResetSpaceProfile
 *     (@web/lib/userContextMenu), and the gates it reads become these re-exports.
 *  4. The profile sheet (room/profile/ProfileSheetHost.tsx) KEEPS useCanEditNickname, computed
 *     from the stores; do not switch it to spaceRoleContext.canEditNickname. On the web the UI
 *     that builds the context fills that in; mobile's builders (chat/people.ts roleContext,
 *     room/profile/present.ts spaceRoleContextFor) do not, the voice row and voice sheet pass
 *     no context, and the context is null while the space's roles load. Only its
 *     FullProfileSubject becomes the web's UserProfileFullSubject.
 *  5. settings/navigation.ts installSettingsWiring reads takePendingSpaceProfileSpaceId() and
 *     calls openSpaceProfile(id). The store-free tests (completion, memberList, searchModel,
 *     roleLogic) import spaceProfileCore today; the web's lib/spaceProfile imports the stores,
 *     so either load webMocks there or keep resolveProfile in a store-free home.
 *  Then run check:overrides. The pure half lives in spaceProfileCore.ts (see there for why).
 *
 * The API calls never touch the stores - the web's rule: every caller does
 * upsertSpaceMember(spaceId, member) itself, so the screen shows the result before the
 * gateway event arrives.
 */
import { api, getApiUrl } from '@web/api/client';
import { ApiError } from '@web/api/ApiError';
import type { SpaceMember } from '@web/api/spaces';
import { onStargateEvent } from '@web/services/stargate/client';
import { auth } from '@web/stores/auth';
import { setSpaceMembers, spaceMembers } from '@web/stores/spaceMembers';
import {
  resolveProfile,
  SPACE_PROFILE_KEYS,
  type ProfileBase,
  type ResolvedProfile,
  type SpaceProfileFields,
  type SpaceProfilePatch,
} from './spaceProfileCore';

export * from './spaceProfileCore';

/** A space member with the profile keys the bumped web's SpaceMember carries; plain
 * `SpaceMember` after the bump. */
export type MemberWithSpaceProfile = SpaceMember & SpaceProfileFields;

// ---- lookups --------------------------------------------------------------------------------------

/** The member row of userId in spaceId from the spaceMembers store (undefined if not loaded). */
export function spaceMemberOf(spaceId: string | null | undefined, userId: string | null | undefined): MemberWithSpaceProfile | undefined {
  if (!spaceId || !userId) return undefined;
  return spaceMembers.bySpaceId[spaceId]?.find((m) => m.id === userId);
}

/** For surfaces holding only ids: base = auth.user for yourself, else base ?? member; overlay = member. */
export function resolveSpaceUser(
  spaceId: string | null | undefined,
  userId: string,
  base?: ProfileBase | null,
  fallback?: string,
): ResolvedProfile {
  const member = spaceMemberOf(spaceId, userId);
  const me = auth.user;
  return resolveProfile(me && me.id === userId ? me : (base ?? member), member, fallback);
}

// ---- API ------------------------------------------------------------------------------------------

/** `userId` may be '@me'. Never percent-encode it: the server's route params stay encoded, so
 * '%40me' would not be read as the caller. */
function memberPath(spaceId: string, userId: string): string {
  return `/spaces/${spaceId}/members/${userId}`;
}

/** GET /spaces/:id/members/:userId - one member with their space profile (members only). */
export function getSpaceMember(spaceId: string, userId: string): Promise<MemberWithSpaceProfile> {
  return api<MemberWithSpaceProfile>(memberPath(spaceId, userId));
}

/** PATCH /spaces/:id/members/:userId - your own profile ('@me': any field), or as a moderator
 * another member's nickname and resets (clears only). Send only the changed keys. */
export function patchSpaceMember(spaceId: string, userId: string, patch: SpaceProfilePatch): Promise<MemberWithSpaceProfile> {
  return api<MemberWithSpaceProfile>(memberPath(spaceId, userId), { method: 'PATCH', json: patch });
}

/** The web's uploadAvatar for a member image: plain fetch + FormData, which React Native sends
 * as a file part when `file` is asUploadFile's `{ uri, name, type }`. */
async function uploadMemberImage(spaceId: string, kind: 'avatar' | 'banner', file: File): Promise<MemberWithSpaceProfile> {
  const form = new FormData();
  form.append('file', file);
  const token = localStorage.getItem('session_token');
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${getApiUrl()}${memberPath(spaceId, '@me')}/${kind}`, { method: 'POST', body: form, headers });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string; code?: string } & Record<string, unknown>;
    throw new ApiError(err.error ?? `HTTP ${res.status}`, res.status, err.error_description, err.code, err);
  }
  return res.json() as Promise<MemberWithSpaceProfile>;
}

/** POST /spaces/:id/members/@me/avatar (multipart `file`): your space avatar. */
export function uploadSpaceMemberAvatar(spaceId: string, file: File): Promise<MemberWithSpaceProfile> {
  return uploadMemberImage(spaceId, 'avatar', file);
}

/** POST /spaces/:id/members/@me/banner (multipart `file`): your space banner. */
export function uploadSpaceMemberBanner(spaceId: string, file: File): Promise<MemberWithSpaceProfile> {
  return uploadMemberImage(spaceId, 'banner', file);
}

// ---- gateway --------------------------------------------------------------------------------------

/** A profile key as the store keeps it: the text when there is any, else null (cleared). */
function profileValue(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

/**
 * The pinned web's member handlers drop the profile keys: SPACE_MEMBER_ADD builds the member
 * field by field and SPACE_MEMBER_UPDATE patches only roles. This listener runs after them
 * (register it right after initSpaceMembersHandlers - handlers run in registration order) and
 * writes only the six profile keys onto the member they just stored, each only when the
 * payload has it, so roles and the global profile stay the web's. Same payload unwrapping as
 * the web. Removed at the bump, where the web parses the keys itself.
 */
export function initSpaceProfileCompatHandlers(): () => void {
  return onStargateEvent((event) => {
    if (event.t !== 'SPACE_MEMBER_ADD' && event.t !== 'SPACE_MEMBER_UPDATE') return;
    const payload = (event.d as { d?: unknown } | undefined)?.d ?? event.d;
    if (!payload || typeof payload !== 'object') return;
    const d = payload as Record<string, unknown>;
    const spaceId = d.space_id != null ? String(d.space_id) : event.space_id;
    const rawId = event.t === 'SPACE_MEMBER_ADD' ? d.id : d.user_id;
    const userId = rawId != null ? String(rawId) : '';
    if (!spaceId || !userId) return;
    const patch: SpaceProfileFields = {};
    for (const key of SPACE_PROFILE_KEYS) if (key in d) patch[key] = profileValue(d[key]);
    if (Object.keys(patch).length === 0) return;
    // Nothing to patch in a list that was never loaded (or no longer holds them): writing
    // would create an empty list for the space.
    if (!spaceMembers.bySpaceId[spaceId]?.some((m) => m.id === userId)) return;
    setSpaceMembers('bySpaceId', spaceId, (prev) => (prev ?? []).map((m) => (m.id === userId ? { ...m, ...patch } : m)));
  });
}
