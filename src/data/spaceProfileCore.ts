/**
 * Space profiles - a member's per-space nickname, avatar, banner, About Me, bio and pronouns -
 * the store-free half: the display rule, the nickname gates, the patch shape and the menu
 * entries. spaceProfileCompat.ts re-exports all of it and adds the half that needs the stores
 * (member lookups, the API calls, the gateway handler); import from there unless the module
 * has to load without the stores.
 *
 * TEMPORARY - replace every body with re-exports from @web at the submodule bump
 * (@web/lib/spaceProfile, @web/lib/spacePermissions, @web/api/spaces). The web pin (e31323f)
 * has none of this yet, so until then these are the only copies, with the web's names,
 * signatures and semantics - the reset helpers included (hasResettableSpaceProfile and
 * spaceProfileResetPatch from lib/spaceProfile, memberCanResetSpaceProfile from
 * lib/spacePermissions). Mobile's own, deleted rather than re-exported: overlaySenderDisplay,
 * overlayProfileSubject (only after data/users.ts and platform/presenters/profileSheet.ts hand
 * the web builders the spaceId) and nicknameMenuEntries. The full, ordered follow-up is in
 * spaceProfileCompat.ts's header.
 *
 * Why a separate file: the composer's completion, member sorting, the search pickers and the
 * settings role logic are pure modules whose tests load without the web stand-ins, and the
 * stores pull in the gateway client, which cannot load under jest. The web's lib/spaceProfile.ts
 * imports the stores too, so at the bump those modules' tests either load webMocks or this
 * rule keeps a store-free home.
 */
import type { SpaceRole } from '@web/api/spaces';
import type { SenderDisplay } from '@web/components/messageList/utils';
import type { ContextMenuItem } from '@web/stores/contextMenu';
import type { UserProfilePopoverSubject } from '@web/stores/userProfilePopover';
import { hasPerm, memberHighestRolePosition, PermAdministrator } from '@web/lib/spacePermissions';
import { t } from '@web/i18n/t';

// ---- permission bits (mirrors equinox permissions/bits.go) -------------------------------------

/**
 * Nicknames (appended after threads; space-scoped, never a room override). Change Nickname: a
 * member may set or clear their own nickname in the space (on for @everyone, as on Discord).
 * Manage Nicknames: change or clear other members' nicknames, subject to the role hierarchy,
 * and your own; also reset another member's space profile. Only the owner may change the
 * owner's nickname.
 *
 * Bit 30 is the last one the client's 32-bit bitwise maths can hold (bit 31 is its sign bit);
 * anything past 30 needs the client to move off `&`/`|` first.
 */
export const PermChangeNickname = 1 << 28;
export const PermManageNicknames = 1 << 29;

// ---- the member fields --------------------------------------------------------------------------

/** The six space-profile keys on a member object, always sent by the server (string or null). */
export const SPACE_PROFILE_KEYS = ['nick', 'space_avatar', 'space_banner', 'space_about_me', 'space_bio', 'space_pronouns'] as const;

/**
 * A member's space profile as the server sends it, flat on the member object and distinct from
 * the global keys (`avatar`, `bio`...), so a global profile change (USER_UPDATE) never touches
 * it. null, absent or whitespace-only all mean "no override - the global value shows".
 */
export interface SpaceProfileFields {
  nick?: string | null;
  space_avatar?: string | null;
  space_banner?: string | null;
  space_about_me?: string | null;
  space_bio?: string | null;
  space_pronouns?: string | null;
}

/** The global profile a space profile overlays: auth.user for yourself, else the member/participant. */
export interface ProfileBase {
  id?: string;
  username?: string | null;
  display_name?: string | null;
  avatar?: string | null;
  banner?: string | null;
  about_me?: string | null;
  bio?: string | null;
  pronouns?: string | null;
}

export interface ResolvedProfile {
  /** What to call them here: the nickname, else the display name, else the username. */
  name: string;
  /** Who they are everywhere: the display name, else the username. */
  globalName: string;
  username: string;
  nick?: string;
  avatar?: string;
  banner?: string;
  aboutMe?: string;
  bio?: string;
  pronouns?: string;
  /** Some space field (nick or space_*) overrode the global profile. */
  hasSpaceProfile: boolean;
}

/** PATCH /spaces/:id/members/:userId. Images are only ever cleared here (null); they are set
 * by the upload endpoints. A key left out is unchanged; null or "" clears it. */
export interface SpaceProfilePatch {
  nick?: string | null;
  avatar?: null;
  banner?: null;
  about_me?: string | null;
  bio?: string | null;
  pronouns?: string | null;
}

/** The overlay argument, as the web types it: `SpaceProfileFields & ProfileBase` rather than
 * the bare fields, so a member typed as a RoomParticipant can be passed as is (TypeScript
 * refuses an all-optional type that shares no keys with the value). */
type SpaceOverlay = SpaceProfileFields & ProfileBase;

/** A value that shows: a string with something in it besides whitespace. */
function filled(v: string | null | undefined): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

// ---- the one rule --------------------------------------------------------------------------------

/**
 * THE rule. `base` is the global profile (auth.user for yourself, else the participant or
 * member); `space` is the member row of the space being shown (undefined outside a space, which
 * leaves the global profile). Each space field, when it has a value, replaces its global one;
 * role colour, badges, tags and the handle are not part of it. Pure.
 */
export function resolveProfile(
  base: ProfileBase | null | undefined,
  space?: SpaceOverlay | null,
  fallback?: string,
): ResolvedProfile {
  const globalName = filled(base?.display_name) ?? filled(base?.username) ?? fallback ?? t('common.unknown');
  const nick = filled(space?.nick);
  const avatar = filled(space?.space_avatar) ?? filled(base?.avatar);
  const banner = filled(space?.space_banner) ?? filled(base?.banner);
  const aboutMe = filled(space?.space_about_me) ?? filled(base?.about_me);
  const bio = filled(space?.space_bio) ?? filled(base?.bio);
  const pronouns = filled(space?.space_pronouns) ?? filled(base?.pronouns);
  return {
    name: nick ?? globalName,
    globalName,
    username: filled(base?.username) ?? '',
    ...(nick ? { nick } : {}),
    ...(avatar ? { avatar } : {}),
    ...(banner ? { banner } : {}),
    ...(aboutMe ? { aboutMe } : {}),
    ...(bio ? { bio } : {}),
    ...(pronouns ? { pronouns } : {}),
    hasSpaceProfile: !!space && SPACE_PROFILE_KEYS.some((k) => filled(space[k]) !== undefined),
  };
}

export type SenderDisplayWithProfile = SenderDisplay & { globalName?: string; nick?: string };

/**
 * The web's getSenderDisplay with the space profile applied: what the pinned web leaves out
 * (it reads only the global fields). `s` is getSenderDisplay's result for the person, `member`
 * their row in the space being shown. Without a member (outside a space, or not loaded) `s` is
 * returned as it is. Idempotent: applying it again with the same member - or to a display the
 * bumped web already resolved - changes nothing, so it stays correct until it is deleted.
 */
export function overlaySenderDisplay(s: SenderDisplay, member?: (SpaceProfileFields & ProfileBase) | null): SenderDisplayWithProfile {
  if (!member) return s;
  const prior = s as SenderDisplayWithProfile;
  const { nick: _priorNick, ...rest } = prior;
  const globalName = prior.globalName ?? s.name;
  const nick = filled(member.nick);
  return {
    ...rest,
    name: nick ?? globalName,
    globalName,
    ...(nick ? { nick } : {}),
    avatar: filled(member.space_avatar) ?? s.avatar,
    banner: filled(member.space_banner) ?? s.banner,
    aboutMe: filled(member.space_about_me) ?? s.aboutMe,
    bio: filled(member.space_bio) ?? s.bio,
    pronouns: filled(member.space_pronouns) ?? s.pronouns,
  };
}

/** The profile sheet's subject with the bumped web's two extra fields: the global name shown
 * small under a nickname (only when it differs), and the space it was opened in. */
export type MobileProfileSubject = UserProfilePopoverSubject & { globalName?: string; spaceId?: string };

/**
 * A subject from the web's builders with the space profile applied - the subject-side twin of
 * overlaySenderDisplay, for a freshly built subject. Outside a space it is returned unchanged;
 * in one, `spaceId` is set and, when the member row is known, the nickname and space fields
 * replace the global ones, with `globalName` kept when it differs. Idempotent like
 * overlaySenderDisplay; goes with it at the bump, but only once both callers (data/users.ts
 * profileSubject, platform/presenters/profileSheet.ts) pass `{ spaceId }` to the web builders,
 * which add spaceId only when given it - this is the only thing setting it today.
 */
export function overlayProfileSubject(
  s: UserProfilePopoverSubject,
  member: SpaceProfileFields | null | undefined,
  spaceId: string | null | undefined,
): MobileProfileSubject {
  if (!spaceId) return s;
  if (!member) return { ...s, spaceId };
  const prior = s as MobileProfileSubject;
  const { globalName: _priorGlobal, ...rest } = prior;
  const globalName = prior.globalName ?? s.displayName;
  const name = filled(member.nick) ?? globalName;
  return {
    ...rest,
    displayName: name,
    ...(globalName !== name ? { globalName } : {}),
    avatar: filled(member.space_avatar) ?? s.avatar,
    banner: filled(member.space_banner) ?? s.banner,
    aboutMe: filled(member.space_about_me) ?? s.aboutMe,
    bio: filled(member.space_bio) ?? s.bio,
    pronouns: filled(member.space_pronouns) ?? s.pronouns,
    spaceId,
  };
}

// ---- nickname gates (the client copy of the server's nicknamePermission) -----------------------

type SpaceOwnerLike = { owner_id: string; everyone_role_id?: string };
type MemberRolesLike = { id: string; roles?: string[] };

/**
 * @everyone plus every role the member holds, OR-ed - the web's memberEffectivePermBase, which
 * it does not export. null for the owner (who needs no bits) and while roles are unknown.
 */
function memberPermBase(
  space: SpaceOwnerLike | undefined,
  roles: SpaceRole[] | undefined,
  member: { roles?: string[] } | undefined,
  userId: string | undefined,
): number | null {
  if (!space || !userId || !roles?.length) return null;
  if (space.owner_id === userId) return null;
  const everyoneId = space.everyone_role_id ?? roles.find((r) => r.name === '@everyone')?.id;
  const byId = new Map(roles.map((r) => [r.id, r]));
  let base = 0;
  if (everyoneId) base |= byId.get(everyoneId)?.permissions ?? 0;
  for (const rid of member?.roles ?? []) {
    if (rid === everyoneId) continue;
    base |= byId.get(rid)?.permissions ?? 0;
  }
  return base;
}

/** Change Nickname or Manage Nicknames (or Administrator / owner): may set their own nickname. */
export function memberCanChangeNickname(
  space: SpaceOwnerLike | undefined,
  roles: SpaceRole[] | undefined,
  member: { id: string; roles?: string[] } | undefined,
  userId: string | undefined,
): boolean {
  if (!space || !userId || !roles?.length) return false;
  if (space.owner_id === userId) return true;
  const base = memberPermBase(space, roles, member, userId);
  if (base === null) return false;
  return hasPerm(base, PermChangeNickname) || hasPerm(base, PermManageNicknames) || hasPerm(base, PermAdministrator);
}

/** Manage Nicknames (or Administrator / owner). */
export function memberCanManageNicknames(
  space: SpaceOwnerLike | undefined,
  roles: SpaceRole[] | undefined,
  member: { id: string; roles?: string[] } | undefined,
  userId: string | undefined,
): boolean {
  if (!space || !userId || !roles?.length) return false;
  if (space.owner_id === userId) return true;
  const base = memberPermBase(space, roles, member, userId);
  if (base === null) return false;
  return hasPerm(base, PermManageNicknames) || hasPerm(base, PermAdministrator);
}

export interface NicknameEditInput {
  viewerId?: string;
  targetId: string;
  spaceOwnerId?: string;
  canChangeOwnNickname?: boolean;
  canManageNicknames?: boolean;
  /** Number.MAX_SAFE_INTEGER (or Infinity) for the owner. */
  viewerHighestRolePosition?: number;
  /** memberHighestRolePosition of the target (-1 = no role above @everyone). */
  targetHighestRolePosition: number;
}

/**
 * THE client copy of the server's nicknamePermission, from precomputed inputs (used by menus):
 * the owner may change anyone's, themself included; nobody else may change the owner's
 * (Administrator is not enough); your own needs Change Nickname (or Manage Nicknames);
 * someone else's needs Manage Nicknames and a target ranked strictly below you - equal rank is
 * refused, as kick and ban are.
 */
export function canEditNicknameOf(o: NicknameEditInput): boolean {
  // Nobody signed in has no nickname to change, nor anyone else's.
  if (!o.viewerId) return false;
  if (o.spaceOwnerId && o.viewerId === o.spaceOwnerId) return true;
  if (o.spaceOwnerId && o.targetId === o.spaceOwnerId) return false;
  if (o.viewerId === o.targetId) return o.canChangeOwnNickname === true;
  return o.canManageNicknames === true && o.targetHighestRolePosition < (o.viewerHighestRolePosition ?? -1);
}

/** Convenience over canEditNicknameOf for surfaces holding member objects. */
export function memberCanEditNickname(
  space: SpaceOwnerLike | undefined,
  roles: SpaceRole[] | undefined,
  viewer: MemberRolesLike | undefined,
  target: MemberRolesLike | undefined,
): boolean {
  if (!space || !viewer || !target) return false;
  return canEditNicknameOf(nicknameInput(space, roles, viewer, target));
}

function nicknameInput(space: SpaceOwnerLike, roles: SpaceRole[] | undefined, viewer: MemberRolesLike, target: MemberRolesLike): NicknameEditInput {
  return {
    viewerId: viewer.id,
    targetId: target.id,
    spaceOwnerId: space.owner_id,
    canChangeOwnNickname: memberCanChangeNickname(space, roles, viewer, viewer.id),
    canManageNicknames: memberCanManageNicknames(space, roles, viewer, viewer.id),
    viewerHighestRolePosition:
      space.owner_id === viewer.id ? Number.MAX_SAFE_INTEGER : memberHighestRolePosition(space.everyone_role_id, roles, viewer),
    targetHighestRolePosition: memberHighestRolePosition(space.everyone_role_id, roles, target),
  };
}

// ---- resetting a space profile (the web's lib/spaceProfile + lib/spacePermissions helpers) -----

const RESET_MEMBER_KEYS = ['space_avatar', 'space_banner', 'space_about_me', 'space_bio', 'space_pronouns'] as const;

/**
 * Whether a member has anything a reset would clear: any of the space avatar, banner, About Me,
 * bio or pronouns, plus the nickname unless `ignoreNick`. A moderator's reset never touches the
 * nickname (that is its own action), and a member without Change Nickname leaves it out of
 * their own reset, so both ask with `ignoreNick` - a lone nickname then never offers a reset
 * that would only fail.
 */
export function hasResettableSpaceProfile(m: SpaceOverlay | null | undefined, opts?: { ignoreNick?: boolean }): boolean {
  if (!m) return false;
  if (!opts?.ignoreNick && filled(m.nick)) return true;
  return RESET_MEMBER_KEYS.some((k) => filled(m[k]) !== undefined);
}

/**
 * The PATCH body that resets a space profile to the global one. `includeNick` is false for a
 * moderator's reset of someone else (the server only lets those five be cleared, and the
 * nickname has its own action) and for your own reset when you lack Change Nickname - sending
 * `nick` then would make the server refuse the whole request (403), and nothing would reset.
 */
export function spaceProfileResetPatch(opts: { includeNick: boolean }): SpaceProfilePatch {
  return {
    ...(opts.includeNick ? { nick: null } : {}),
    avatar: null,
    banner: null,
    about_me: null,
    bio: null,
    pronouns: null,
  };
}

/**
 * Whether the viewer may reset (clear) someone else's space avatar, banner, pronouns, About Me
 * and bio - the moderator half of space profiles. The same rule as changing their nickname
 * (Manage Nicknames, a target ranked below you, the owner's profile only by the owner), but
 * never yourself: your own reset is in Settings > Space Profiles. Whether the target has
 * anything to reset is hasResettableSpaceProfile's question. The server checks it again.
 */
export function memberCanResetSpaceProfile(
  space: SpaceOwnerLike | undefined,
  roles: SpaceRole[] | undefined,
  viewer: MemberRolesLike | undefined,
  target: MemberRolesLike | undefined,
): boolean {
  if (!viewer || !target || viewer.id === target.id) return false;
  return memberCanEditNickname(space, roles, viewer, target);
}

// ---- menu entries --------------------------------------------------------------------------------

/**
 * The web's SpaceModerationContext as the bumped web extends it, plus the reset: the same
 * object can go to buildSpaceModerationItems after the bump.
 */
export interface NicknameMenuContext {
  spaceId?: string;
  targetUserId: string;
  targetRoleIds?: string[];
  currentUserId?: string;
  spaceOwnerId?: string;
  spaceRoles?: SpaceRole[];
  /** Number.MAX_SAFE_INTEGER (or Infinity) for the owner. */
  viewerHighestRolePosition?: number;
  /** memberCanChangeNickname(viewer). */
  canChangeOwnNickname?: boolean;
  /** memberCanManageNicknames(viewer). */
  canManageNicknames?: boolean;
  onEditNickname?: (userId: string) => void;
  /** Self only. */
  onEditSpaceProfile?: () => void;
  /** The target's member row: "Reset Space Profile" is offered only when it holds something
   * a reset would clear. */
  targetProfile?: SpaceProfileFields | null;
  onResetSpaceProfile?: (userId: string) => void;
}

/**
 * Mobile's nickname and space-profile entries for a user menu, used instead of the web
 * builder's (whose pinned copy ignores the new context fields): for yourself "Edit Space
 * Profile" and, when allowed, "Change Nickname"; for someone else "Change Nickname" and "Reset
 * Space Profile" when you outrank them. Put them before kick and ban. At the bump, delete this
 * and pass the fields to buildSpaceModerationItems instead - never both, or the entries show
 * twice (step 3 in spaceProfileCompat.ts's header: spaceProfileMenuItems' departed-author rule
 * moves into chat/people.ts, and Space Settings > Members keeps its own entries).
 */
export function nicknameMenuEntries(ctx: NicknameMenuContext): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  if (!ctx.spaceId) return items;
  const isSelf = !!ctx.currentUserId && ctx.targetUserId === ctx.currentUserId;
  const allowed = canEditNicknameOf({
    viewerId: ctx.currentUserId,
    targetId: ctx.targetUserId,
    spaceOwnerId: ctx.spaceOwnerId,
    canChangeOwnNickname: ctx.canChangeOwnNickname,
    canManageNicknames: ctx.canManageNicknames,
    viewerHighestRolePosition: ctx.viewerHighestRolePosition,
    targetHighestRolePosition: memberHighestRolePosition(undefined, ctx.spaceRoles, { roles: ctx.targetRoleIds }),
  });
  const changeNickname = (): ContextMenuItem => ({
    label: t('mobile.room.nickname.change'),
    icon: 'fa-pen',
    onClick: () => ctx.onEditNickname!(ctx.targetUserId),
  });
  if (isSelf) {
    if (ctx.onEditSpaceProfile) {
      items.push({ label: t('mobile.room.nickname.editSpaceProfile'), icon: 'fa-id-badge', onClick: () => ctx.onEditSpaceProfile!() });
    }
    if (allowed && ctx.onEditNickname) items.push(changeNickname());
    return items;
  }
  if (!allowed) return items;
  if (ctx.onEditNickname) items.push(changeNickname());
  if (ctx.onResetSpaceProfile && hasResettableSpaceProfile(ctx.targetProfile, { ignoreNick: true })) {
    items.push({
      label: t('mobile.room.resetSpaceProfile'),
      icon: 'fa-eraser',
      danger: true,
      onClick: () => ctx.onResetSpaceProfile!(ctx.targetUserId),
    });
  }
  return items;
}
