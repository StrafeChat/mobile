/**
 * Space profiles as the app gets them from the web (src/data/spaceProfileCompat re-exports
 * lib/spaceProfile, lib/spacePermissions and api/spaces): the display rule, the web builders
 * showing the space profile (sender display, profile subject with its space), the nickname
 * gates against the server's table, the menu entries of buildSpaceModerationItems, the reset
 * helpers, the web member handlers carrying the profile keys, and the API calls' wire shapes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { emitStargateEvent } from './testing/webMocks';
import { ApiError } from '@web/api/ApiError';
import type { SpaceMember, SpaceProfileFields } from '@web/api/spaces';
import { getSenderDisplay } from '@web/components/messageList/utils';
import { popoverSubjectFromParticipant } from '@web/lib/userProfilePopoverHelpers';
import { buildSpaceModerationItems } from '@web/lib/userContextMenu';
import { confirmDialogState, settleConfirmDialog } from '@web/stores/confirmDialog';
import { PermAdministrator, PermBanMembers, PermSendMessages, PermViewChannel } from '@web/lib/spacePermissions';
import { initSpaceMembersHandlers, setSpaceMembers, spaceMembers } from '@web/stores/spaceMembers';
import { ME, member, resetStores, role, space, user } from './testing/fixtures';

import {
  PermChangeNickname,
  PermManageNicknames,
  SPACE_PROFILE_KEYS,
  canEditNicknameOf,
  getSpaceMember,
  hasResettableSpaceProfile,
  memberCanChangeNickname,
  memberCanEditNickname,
  memberCanManageNicknames,
  memberCanResetSpaceProfile,
  patchSpaceMember,
  resolveProfile,
  resolveSpaceUser,
  spaceMemberOf,
  spaceProfileResetPatch,
  uploadSpaceMemberAvatar,
  uploadSpaceMemberBanner,
} from './spaceProfileCompat';

// lib/userContextMenu's "Add to space" opens a window through the desktop shell's native
// hooks (expo-router, notifications); not under test here.
jest.mock('@web/lib/openWindow', () => ({ openAppWindow: jest.fn() }));

beforeEach(resetStores);

const GLOBAL = {
  id: 'u',
  username: 'turtle',
  display_name: 'Tom',
  avatar: 'g-avatar.png',
  banner: 'g-banner.png',
  about_me: 'global about',
  bio: 'global bio',
  pronouns: 'he/him',
};
const SPACE = {
  nick: 'Shell',
  space_avatar: 's-avatar.png',
  space_banner: 's-banner.png',
  space_about_me: 'space about',
  space_bio: 'space bio',
  space_pronouns: 'they/them',
};

describe('the bits', () => {
  test('match the server (bits 28 and 29)', () => {
    expect(PermChangeNickname).toBe(268435456);
    expect(PermManageNicknames).toBe(536870912);
    expect(SPACE_PROFILE_KEYS).toEqual(['nick', 'space_avatar', 'space_banner', 'space_about_me', 'space_bio', 'space_pronouns']);
  });
});

describe('resolveProfile', () => {
  test('every space field wins over its global one', () => {
    expect(resolveProfile(GLOBAL, SPACE)).toEqual({
      name: 'Shell',
      globalName: 'Tom',
      username: 'turtle',
      nick: 'Shell',
      avatar: 's-avatar.png',
      banner: 's-banner.png',
      aboutMe: 'space about',
      bio: 'space bio',
      pronouns: 'they/them',
      hasSpaceProfile: true,
    });
  });

  test('without a space profile, the global one', () => {
    expect(resolveProfile(GLOBAL)).toEqual({
      name: 'Tom',
      globalName: 'Tom',
      username: 'turtle',
      avatar: 'g-avatar.png',
      banner: 'g-banner.png',
      aboutMe: 'global about',
      bio: 'global bio',
      pronouns: 'he/him',
      hasSpaceProfile: false,
    });
  });

  test("'', whitespace and null are unset - field by field", () => {
    const r = resolveProfile(GLOBAL, { nick: '   ', space_avatar: '', space_banner: null, space_bio: 'only bio', space_pronouns: '\n' });
    expect(r).toMatchObject({ name: 'Tom', avatar: 'g-avatar.png', banner: 'g-banner.png', aboutMe: 'global about', bio: 'only bio', pronouns: 'he/him', hasSpaceProfile: true });
    expect(r.nick).toBeUndefined();
    expect(resolveProfile(GLOBAL, { nick: ' ', space_avatar: null }).hasSpaceProfile).toBe(false);
  });

  test('globalName: display name, else username, else the fallback', () => {
    expect(resolveProfile({ username: 'turtle', display_name: ' ' }, SPACE)).toMatchObject({ name: 'Shell', globalName: 'turtle' });
    expect(resolveProfile(undefined, { nick: 'Shell' }, 'Someone')).toMatchObject({ name: 'Shell', globalName: 'Someone', username: '' });
    expect(resolveProfile(null).name).toBe('common.unknown');
  });
});

/** GLOBAL as a space's member row, with these space fields. */
const row = (fields: SpaceProfileFields): SpaceMember => ({ ...GLOBAL, ...fields });

describe('the sender display (getSenderDisplay over the member row)', () => {
  test('a member row shows its space profile over the global one', () => {
    expect(getSenderDisplay('u', [row(SPACE)], ME)).toMatchObject({
      name: 'Shell',
      globalName: 'Tom',
      nick: 'Shell',
      avatar: 's-avatar.png',
      banner: 's-banner.png',
      aboutMe: 'space about',
      bio: 'space bio',
      pronouns: 'they/them',
    });
  });

  test('a member with no space profile keeps the global display', () => {
    const r = getSenderDisplay('u', [row({ nick: null, space_avatar: '' })], ME);
    expect(r).toMatchObject({ name: 'Tom', globalName: 'Tom', avatar: 'g-avatar.png' });
    expect(r.nick).toBeUndefined();
  });

  test('outside a space (no space fields): the global profile', () => {
    const r = getSenderDisplay('u', [GLOBAL], ME);
    expect(r).toMatchObject({ name: 'Tom', avatar: 'g-avatar.png', bio: 'global bio' });
    expect(r.nick).toBeUndefined();
  });

  test('yourself: your global profile from auth.user, your nickname from your member row', () => {
    expect(getSenderDisplay(ME, [member(ME, [], { display_name: 'Stale me', nick: 'Captain' })], ME)).toMatchObject({ name: 'Captain', globalName: 'Me', nick: 'Captain' });
  });
});

describe('the profile subject (popoverSubjectFromParticipant given the space)', () => {
  test('in a space: nickname over the name, globalName only when it differs, spaceId set', () => {
    expect(popoverSubjectFromParticipant(row(SPACE), undefined, { spaceId: 's1' })).toMatchObject({
      displayName: 'Shell',
      globalName: 'Tom',
      avatar: 's-avatar.png',
      aboutMe: 'space about',
      bio: 'space bio',
      pronouns: 'they/them',
      spaceId: 's1',
    });
    const plain = popoverSubjectFromParticipant(row({ nick: null }), undefined, { spaceId: 's1' });
    expect(plain).toMatchObject({ displayName: 'Tom', spaceId: 's1' });
    expect(plain.globalName).toBeUndefined();
    // A nickname equal to the global name shows no second line.
    expect(popoverSubjectFromParticipant(row({ nick: 'Tom' }), undefined, { spaceId: 's1' }).globalName).toBeUndefined();
  });

  test('outside a space: no space on the subject', () => {
    const subject = popoverSubjectFromParticipant(GLOBAL);
    expect(subject.spaceId).toBeUndefined();
    expect(subject).toMatchObject({ displayName: 'Tom', avatar: 'g-avatar.png' });
  });
});

describe('who may change a nickname (the server table)', () => {
  const OWNER = 'owner';
  const base = { spaceOwnerId: OWNER, canChangeOwnNickname: false, canManageNicknames: false };

  test('the owner: anyone, themself included', () => {
    expect(canEditNicknameOf({ ...base, viewerId: OWNER, targetId: OWNER, targetHighestRolePosition: -1 })).toBe(true);
    expect(canEditNicknameOf({ ...base, viewerId: OWNER, targetId: 'a', viewerHighestRolePosition: Number.MAX_SAFE_INTEGER, targetHighestRolePosition: 99 })).toBe(true);
  });

  test("nobody else may change the owner's", () => {
    expect(
      canEditNicknameOf({ ...base, viewerId: 'admin', targetId: OWNER, canManageNicknames: true, viewerHighestRolePosition: 50, targetHighestRolePosition: -1 }),
    ).toBe(false);
  });

  test('yourself: Change Nickname (or Manage Nicknames) decides', () => {
    expect(canEditNicknameOf({ ...base, viewerId: 'a', targetId: 'a', canChangeOwnNickname: true, targetHighestRolePosition: -1 })).toBe(true);
    expect(canEditNicknameOf({ ...base, viewerId: 'a', targetId: 'a', canChangeOwnNickname: false, targetHighestRolePosition: -1 })).toBe(false);
  });

  test('someone else: Manage Nicknames over a lower-ranked member only', () => {
    const mod = { ...base, viewerId: 'mod', canManageNicknames: true, viewerHighestRolePosition: 5 };
    expect(canEditNicknameOf({ ...mod, targetId: 'a', targetHighestRolePosition: 4 })).toBe(true);
    expect(canEditNicknameOf({ ...mod, targetId: 'a', targetHighestRolePosition: 5 })).toBe(false);
    expect(canEditNicknameOf({ ...mod, targetId: 'a', targetHighestRolePosition: 6 })).toBe(false);
    expect(canEditNicknameOf({ ...mod, canManageNicknames: false, targetId: 'a', targetHighestRolePosition: 1 })).toBe(false);
    // No roles on either side: refused, as the server does.
    expect(canEditNicknameOf({ ...mod, viewerHighestRolePosition: -1, targetId: 'a', targetHighestRolePosition: -1 })).toBe(false);
  });

  test('no viewer (signed out, or not known yet): nothing, whatever the bits say', () => {
    expect(
      canEditNicknameOf({ ...base, viewerId: undefined, targetId: 'a', canManageNicknames: true, viewerHighestRolePosition: 5, targetHighestRolePosition: 1 }),
    ).toBe(false);
  });
});

describe('the nickname bits on members', () => {
  const EVERYONE = role('ev', 0, PermViewChannel | PermSendMessages | PermChangeNickname, { name: '@everyone' });
  const LOCKED = role('ev', 0, PermViewChannel | PermSendMessages, { name: '@everyone' });
  const MODS = role('mods', 5, PermManageNicknames);
  const ADMINS = role('admins', 9, PermAdministrator);
  const BANNERS = role('banners', 4, PermBanMembers);

  test('Change Nickname: @everyone default; Manage Nicknames and Administrator imply it; the owner always', () => {
    const open = space('s1', [EVERYONE]);
    const locked = space('s1', [LOCKED, MODS, ADMINS]);
    expect(memberCanChangeNickname(open, open.roles, member('a'), 'a')).toBe(true);
    expect(memberCanChangeNickname(locked, locked.roles, member('a'), 'a')).toBe(false);
    expect(memberCanChangeNickname(locked, locked.roles, member('m', ['mods']), 'm')).toBe(true);
    expect(memberCanChangeNickname(locked, locked.roles, member('x', ['admins']), 'x')).toBe(true);
    expect(memberCanChangeNickname(locked, locked.roles, member('owner'), 'owner')).toBe(true);
  });

  test('Manage Nicknames: the bit or Administrator, not Ban Members', () => {
    const sp = space('s1', [EVERYONE, MODS, ADMINS, BANNERS]);
    expect(memberCanManageNicknames(sp, sp.roles, member('a'), 'a')).toBe(false);
    expect(memberCanManageNicknames(sp, sp.roles, member('b', ['banners']), 'b')).toBe(false);
    expect(memberCanManageNicknames(sp, sp.roles, member('m', ['mods']), 'm')).toBe(true);
    expect(memberCanManageNicknames(sp, sp.roles, member('x', ['admins']), 'x')).toBe(true);
  });

  test('memberCanEditNickname: the same table from member objects', () => {
    const sp = space('s1', [LOCKED, MODS, ADMINS, role('low', 1, 0)]);
    const mod = member('m', ['mods']);
    const admin = member('x', ['admins']);
    expect(memberCanEditNickname(sp, sp.roles, mod, member('a', ['low']))).toBe(true);
    expect(memberCanEditNickname(sp, sp.roles, mod, member('m2', ['mods']))).toBe(false);
    expect(memberCanEditNickname(sp, sp.roles, mod, admin)).toBe(false);
    expect(memberCanEditNickname(sp, sp.roles, admin, member('owner'))).toBe(false);
    expect(memberCanEditNickname(sp, sp.roles, member('owner'), admin)).toBe(true);
    expect(memberCanEditNickname(sp, sp.roles, member('a'), member('a'))).toBe(false);
    expect(memberCanEditNickname(sp, sp.roles, mod, mod)).toBe(true);
    expect(memberCanEditNickname(undefined, sp.roles, mod, mod)).toBe(false);
  });
});

describe('the nickname entries of buildSpaceModerationItems', () => {
  const roles = [role('ev', 0, 0, { name: '@everyone' }), role('mods', 5, PermManageNicknames), role('low', 1, 0)];
  /** `a` is in the space's list, with a space avatar set (something a reset would clear). */
  function seedTarget(extra: object = { space_avatar: 'x.png' }) {
    setSpaceMembers('bySpaceId', 's1', [member('me', ['mods']), member('a', ['low'], extra)]);
  }
  const call = (over: Partial<Parameters<typeof buildSpaceModerationItems>[0]>) =>
    buildSpaceModerationItems({
      spaceId: 's1',
      targetUserId: 'a',
      currentUserId: 'me',
      spaceOwnerId: 'owner',
      spaceRoles: roles,
      viewerHighestRolePosition: 5,
      canChangeOwnNickname: true,
      canManageNicknames: true,
      onEditNickname: jest.fn(),
      onEditSpaceProfile: jest.fn(),
      ...over,
    }).map((i) => i.label);

  beforeEach(() => seedTarget());
  afterEach(() => settleConfirmDialog(false));

  test('yourself: Edit Space Profile, and Change Nickname when allowed', () => {
    expect(call({ targetUserId: 'me' })).toEqual(['spaceProfile.edit', 'spaceProfile.changeNickname']);
    expect(call({ targetUserId: 'me', canChangeOwnNickname: false })).toEqual(['spaceProfile.edit']);
  });

  test('someone below you: Change Nickname, and Reset Space Profile when they have one', () => {
    expect(call({ targetRoleIds: ['low'] })).toEqual(['spaceProfile.changeNickname', 'contextMenu.resetSpaceProfile']);
    seedTarget({ nick: 'only a nick' });
    expect(call({ targetRoleIds: ['low'] })).toEqual(['spaceProfile.changeNickname']);
  });

  test('someone at or above you, the owner, or without the bit: nothing', () => {
    expect(call({ targetRoleIds: ['mods'] })).toEqual([]);
    expect(call({ targetUserId: 'owner' })).toEqual([]);
    expect(call({ canManageNicknames: false })).toEqual([]);
    expect(call({ spaceId: undefined })).toEqual([]);
  });

  test('the owner reaches everyone', () => {
    expect(call({ currentUserId: 'owner', targetRoleIds: ['mods'], viewerHighestRolePosition: Number.MAX_SAFE_INTEGER })).toEqual([
      'spaceProfile.changeNickname',
      'contextMenu.resetSpaceProfile',
    ]);
  });

  test('the actions get the target; the reset confirms first', async () => {
    seedTarget({ space_bio: 'x' });
    const onEditNickname = jest.fn();
    const items = buildSpaceModerationItems({
      spaceId: 's1',
      targetUserId: 'a',
      targetRoleIds: ['low'],
      currentUserId: 'me',
      spaceOwnerId: 'owner',
      spaceRoles: roles,
      viewerHighestRolePosition: 5,
      canManageNicknames: true,
      onEditNickname,
    });
    items[0]!.onClick();
    expect(onEditNickname).toHaveBeenCalledWith('a');
    expect(items[1]).toMatchObject({ label: 'contextMenu.resetSpaceProfile', danger: true });
    items[1]!.onClick();
    await Promise.resolve();
    expect(confirmDialogState.pending?.options).toMatchObject({ title: 'contextMenu.resetSpaceProfile', tone: 'danger' });
  });
});

describe('resetting a space profile', () => {
  test('the patch clears the five, the nickname only when asked', () => {
    expect(spaceProfileResetPatch({ includeNick: false })).toEqual({ avatar: null, banner: null, about_me: null, bio: null, pronouns: null });
    expect(spaceProfileResetPatch({ includeNick: true })).toEqual({ nick: null, avatar: null, banner: null, about_me: null, bio: null, pronouns: null });
  });

  test('a lone nickname counts unless it is ignored (the web\'s ignoreNick default)', () => {
    expect(hasResettableSpaceProfile({ nick: 'Shell' })).toBe(true);
    expect(hasResettableSpaceProfile({ nick: 'Shell' }, { ignoreNick: true })).toBe(false);
    expect(hasResettableSpaceProfile({ space_pronouns: 'x' }, { ignoreNick: true })).toBe(true);
    expect(hasResettableSpaceProfile({ space_avatar: ' ', space_bio: null })).toBe(false);
    expect(hasResettableSpaceProfile(undefined)).toBe(false);
  });

  test("someone else's by the nickname rule; never your own (that is Settings > Space Profiles)", () => {
    const sp = space('s1', [role('ev', 0, 0, { name: '@everyone' }), role('mods', 5, PermManageNicknames), role('low', 1, 0)]);
    const mod = member('m', ['mods']);
    expect(memberCanResetSpaceProfile(sp, sp.roles, mod, member('a', ['low']))).toBe(true);
    expect(memberCanResetSpaceProfile(sp, sp.roles, mod, member('m2', ['mods']))).toBe(false);
    expect(memberCanResetSpaceProfile(sp, sp.roles, mod, member('owner'))).toBe(false);
    expect(memberCanResetSpaceProfile(sp, sp.roles, mod, mod)).toBe(false);
    expect(memberCanResetSpaceProfile(sp, sp.roles, member('owner'), member('m2', ['mods']))).toBe(true);
  });
});

describe('member lookups', () => {
  test('spaceMemberOf and resolveSpaceUser: yourself from auth.user, others from the base or the member', () => {
    setSpaceMembers('bySpaceId', 's1', [member(ME, [], { display_name: 'Stale me', nick: 'Captain' }), member('a', [], { display_name: 'Alice', space_avatar: 'sa.png' })]);
    expect(spaceMemberOf('s1', 'a')?.display_name).toBe('Alice');
    expect(spaceMemberOf(null, 'a')).toBeUndefined();
    expect(resolveSpaceUser('s1', ME)).toMatchObject({ name: 'Captain', globalName: 'Me' });
    expect(resolveSpaceUser('s1', 'a')).toMatchObject({ name: 'Alice', avatar: 'sa.png' });
    expect(resolveSpaceUser('s1', 'a', { display_name: 'From voice' })).toMatchObject({ name: 'From voice', avatar: 'sa.png' });
    expect(resolveSpaceUser('s2', 'a', user('a'))).toMatchObject({ name: 'User a', hasSpaceProfile: false });
  });
});

describe('the web member handlers carry the profile keys', () => {
  let stop: (() => void)[] = [];
  beforeAll(() => {
    stop = [initSpaceMembersHandlers()];
  });
  afterAll(() => stop.forEach((f) => f()));

  test('SPACE_MEMBER_UPDATE: the nickname lands with the roles', () => {
    setSpaceMembers('bySpaceId', 's1', [member('a', ['r1'], { display_name: 'Alice' })]);
    emitStargateEvent('SPACE_MEMBER_UPDATE', {
      space_id: 's1',
      user_id: 'a',
      role_ids: ['r1', 'r2'],
      nick: 'Ally',
      space_avatar: null,
      space_banner: null,
      space_about_me: '',
      space_bio: 'hi',
      space_pronouns: null,
    });
    expect(spaceMembers.bySpaceId.s1![0]).toMatchObject({ id: 'a', display_name: 'Alice', roles: ['r1', 'r2'], nick: 'Ally', space_about_me: null, space_bio: 'hi' });
  });

  test('a cleared nickname is cleared; keys the payload lacks are left alone', () => {
    setSpaceMembers('bySpaceId', 's1', [member('a', ['r1'], { nick: 'Ally', space_bio: 'kept' })]);
    emitStargateEvent('SPACE_MEMBER_UPDATE', { space_id: 's1', user_id: 'a', role_ids: ['r1'], nick: null });
    expect(spaceMembers.bySpaceId.s1![0]).toMatchObject({ nick: null, space_bio: 'kept', roles: ['r1'] });
  });

  test('SPACE_MEMBER_ADD carries the keys', () => {
    setSpaceMembers('bySpaceId', 's1', [member('a')]);
    emitStargateEvent('SPACE_MEMBER_ADD', {
      space_id: 's1',
      id: 'b',
      username: 'bob',
      display_name: 'Bob',
      role_ids: [],
      joined_at: '2026-10-13T12:00:00Z',
      nick: 'Bobby',
      space_avatar: 'https://cdn.example/v1/spaces/members/s1/b/avatar-0123456789abcdef.png',
      space_banner: null,
      space_about_me: null,
      space_bio: null,
      space_pronouns: null,
    });
    const b = spaceMembers.bySpaceId.s1!.find((m) => m.id === 'b');
    expect(b).toMatchObject({ username: 'bob', nick: 'Bobby', space_avatar: 'https://cdn.example/v1/spaces/members/s1/b/avatar-0123456789abcdef.png', space_banner: null });
  });

  test('a member the list does not hold is not added', () => {
    setSpaceMembers('bySpaceId', 's1', [member('b')]);
    emitStargateEvent('SPACE_MEMBER_UPDATE', { space_id: 's1', user_id: 'a', role_ids: [], nick: 'x' });
    expect(spaceMembers.bySpaceId.s1!.map((m) => [m.id, (m as { nick?: string | null }).nick])).toEqual([['b', undefined]]);
  });
});

describe('the API calls', () => {
  type Call = { url: string; init?: RequestInit };
  let calls: Call[] = [];
  const realFetch = globalThis.fetch;

  function answer(status: number, body: unknown) {
    calls = [];
    globalThis.fetch = jest.fn(async (input: unknown, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
    }) as unknown as typeof fetch;
  }

  beforeEach(() => localStorage.setItem('session_token', 'tok'));
  afterEach(() => {
    globalThis.fetch = realFetch;
    localStorage.removeItem('session_token');
  });

  const reply = { id: ME, username: 'me', display_name: 'Me', roles: [], nick: 'Captain', space_avatar: null };

  test('GET one member, @me unencoded', async () => {
    answer(200, reply);
    await expect(getSpaceMember('s1', '@me')).resolves.toMatchObject({ nick: 'Captain' });
    expect(calls[0]!.url.endsWith('/spaces/s1/members/@me')).toBe(true);
    expect(calls[0]!.init?.method ?? 'GET').toBe('GET');
  });

  test('PATCH sends only the given keys, as JSON', async () => {
    answer(200, reply);
    await patchSpaceMember('s1', 'a', { nick: null, avatar: null });
    expect(calls[0]!.url.endsWith('/spaces/s1/members/a')).toBe(true);
    expect(calls[0]!.init?.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ nick: null, avatar: null });
    expect((calls[0]!.init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  test('uploads post the file as multipart `file` to @me/avatar and @me/banner', async () => {
    answer(200, reply);
    const file = { uri: 'file:///a.png', name: 'a.png', type: 'image/png' } as unknown as File;
    await uploadSpaceMemberAvatar('s1', file);
    await uploadSpaceMemberBanner('s1', file);
    expect(calls.map((c) => c.url.replace(/^.*(\/spaces\/)/, '$1'))).toEqual(['/spaces/s1/members/@me/avatar', '/spaces/s1/members/@me/banner']);
    expect(calls[0]!.init?.method).toBe('POST');
    expect(calls[0]!.init?.body).toBeInstanceOf(FormData);
    expect((calls[0]!.init?.body as FormData).get('file')).toBeTruthy();
    expect((calls[0]!.init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  test("errors carry the server's message, status and code", async () => {
    answer(403, { error: 'only the member can change their own space avatar, banner, pronouns, about me or bio', code: 'cannot_edit_member_profile' });
    const err = await patchSpaceMember('s1', 'a', { bio: 'x' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: 'cannot_edit_member_profile' });
    answer(400, { error: 'invalid file size' });
    const upload = await uploadSpaceMemberAvatar('s1', {} as File).catch((e: unknown) => e);
    expect(upload).toMatchObject({ status: 400, message: 'invalid file size' });
  });

  test('the calls never write the store: callers upsert', async () => {
    setSpaceMembers('bySpaceId', 's1', [member(ME)]);
    answer(200, reply);
    await patchSpaceMember('s1', '@me', { nick: 'Captain' });
    await uploadSpaceMemberAvatar('s1', {} as File);
    expect((spaceMembers.bySpaceId.s1![0] as { nick?: string | null }).nick).toBeUndefined();
  });
});
