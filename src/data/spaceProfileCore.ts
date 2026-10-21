/**
 * Space profiles - a member's per-space nickname, avatar, banner, About Me, bio and pronouns -
 * the rule and the gates: the web's, re-exported (one implementation, as AGENTS.md wants).
 *
 * - lib/spaceProfile: resolveProfile (space nickname > display name > username; each space
 *   field over its global one), the reset helpers (hasResettableSpaceProfile,
 *   spaceProfileResetPatch) and the profile types;
 * - lib/spacePermissions: the Change / Manage Nicknames bits (28, 29) and the client copy of
 *   the server's nickname rule (canEditNicknameOf, memberCanChangeNickname,
 *   memberCanManageNicknames, memberCanEditNickname, memberCanResetSpaceProfile);
 * - api/spaces: the six profile keys on a member and the PATCH shape.
 *
 * The composer's completion, member sorting, the search pickers and the settings role logic
 * import from here. This is no longer a store-free home: lib/spaceProfile reads the stores
 * (auth, spaceMembers) for its lookups, so those modules' tests load the web stand-ins
 * (src/data/testing/webMocks). spaceProfileCompat.ts re-exports all of this and adds the
 * lookups and the API calls; import from there (or `@/data`) unless a module only needs
 * these.
 *
 * Mobile's own stand-ins from before the web submodule carried space profiles are gone:
 * the web builders now resolve the space profile themselves (getSenderDisplay,
 * popoverSubjectFromParticipant / popoverSubjectFromSender with `spaceId`), and the menu
 * entries are buildSpaceModerationItems' (lib/userContextMenu), given the nickname fields.
 */
export {
  resolveProfile,
  hasResettableSpaceProfile,
  spaceProfileResetPatch,
  type ProfileBase,
  type ResolvedProfile,
} from '@web/lib/spaceProfile';
export {
  PermChangeNickname,
  PermManageNicknames,
  canEditNicknameOf,
  memberCanChangeNickname,
  memberCanEditNickname,
  memberCanManageNicknames,
  memberCanResetSpaceProfile,
} from '@web/lib/spacePermissions';
export { SPACE_PROFILE_KEYS, type SpaceProfileFields, type SpaceProfilePatch } from '@web/api/spaces';
