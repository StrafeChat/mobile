/**
 * Space profiles for the app, by the web's names: everything spaceProfileCore.ts re-exports
 * (the rule, the gates, the profile keys) plus the member lookups (spaceMemberOf,
 * resolveSpaceUser) from lib/spaceProfile and the API calls from api/spaces. All of it is the
 * web's own code; nothing here re-implements it. `@/data` re-exports this module.
 *
 * Until the web submodule carried space profiles this file held mobile copies, a gateway
 * stand-in and mobile menu entries; at the bump to 9d94504 they were replaced by these
 * re-exports and the web's own handling:
 * - SPACE_MEMBER_ADD / SPACE_MEMBER_UPDATE carry the profile keys into the store in the web's
 *   stores/spaceMembers (the stand-in handler is gone, and its line in platform/boot.ts);
 * - the web builders resolve the space profile (getSenderDisplay, the popover subject
 *   builders given `spaceId`), so the mobile overlays are gone;
 * - buildSpaceModerationItems (lib/userContextMenu) offers Edit Space Profile, Change
 *   Nickname and Reset Space Profile when handed canChangeOwnNickname, canManageNicknames,
 *   onEditNickname and onEditSpaceProfile (room/nicknameSheet.ts spaceProfileMenuFields), and
 *   Space Settings > Members runs the web's confirmResetSpaceProfile.
 *
 * The API calls never touch the stores - the web's rule: every caller does
 * upsertSpaceMember(spaceId, member) itself, so the screen shows the result before the
 * gateway event arrives.
 */
export * from './spaceProfileCore';
export { resolveSpaceUser, spaceMemberOf } from '@web/lib/spaceProfile';
export { getSpaceMember, patchSpaceMember, uploadSpaceMemberAvatar, uploadSpaceMemberBanner } from '@web/api/spaces';
