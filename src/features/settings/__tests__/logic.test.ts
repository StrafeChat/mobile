/// <reference types="jest" />
import './settingsTestSetup';
import type { SpaceMember, SpaceRole } from '@web/api/spaces';
import { PermAdministrator, PermConnect, PermSendMessages, PermViewChannel } from '@web/lib/spacePermissions';
import {
  oauthConsentPath,
  overrideTargetParam,
  parseOverrideTarget,
  roomOverridePath,
  roomSettingsPath,
  spaceRolePath,
  spaceSettingsPage,
  spaceSettingsPath,
  themeEditorPath,
  userSettingsPath,
  adminPath,
} from '../routes';
import { hexToHsv, hexToInt, hsvToHex, intToHex, saturateHex } from '../color';
import { entryMatches, settingsGroups, ACCOUNT_ENTRIES } from '../sections';
import {
  addableMembers,
  canAssignRoleTo,
  canEditMemberRoles,
  canModerateMember,
  customRolesDesc,
  filterMembers,
  memberRolesWith,
  moveRole,
  roleLocked,
  rolePositionPatches,
  type HierarchyContext,
} from '../space/roleLogic';
import { isChannelInSection, isPrivateSection, isSyncLocked, overrideCounts, overrideRowsFor, privateSectionChange } from '../room/overrideLogic';
import { applyOverrideState, overrideState } from '../components/TriState';
import { auditChangeValue, auditLookups, auditSentence, auditTargetLabel } from '../space/auditFormat';
import { validateImage } from '../hooks/pickImage';

const role = (id: string, position: number, extra: Partial<SpaceRole> = {}): SpaceRole => ({
  id,
  name: id,
  permissions: 0,
  position,
  color: 0,
  hoist: false,
  mentionable: false,
  created_at: '',
  updated_at: '',
  ...extra,
});
const member = (id: string, roles: string[] = [], extra: Partial<SpaceMember> = {}): SpaceMember =>
  ({ id, username: id, display_name: '', roles, ...extra }) as SpaceMember;

describe('routes', () => {
  it('maps the web section ids to screens', () => {
    expect(userSettingsPath()).toBe('/settings');
    expect(userSettingsPath('instance')).toBe('/settings/instance');
    expect(userSettingsPath('authorizedApps')).toBe('/settings/authorizedApps');
    // Desktop-only and unknown sections open the list.
    expect(userSettingsPath('desktop')).toBe('/settings');
    expect(userSettingsPath('nope')).toBe('/settings');
  });

  it("accepts the web's space page ids, Overview as 'general' too", () => {
    expect(spaceSettingsPage('general')).toBe('overview');
    expect(spaceSettingsPage('roles')).toBe('roles');
    expect(spaceSettingsPage('zzz')).toBeNull();
    expect(spaceSettingsPath('1', 'general')).toBe('/space-settings/1/overview');
    expect(spaceSettingsPath('1')).toBe('/space-settings/1');
    expect(spaceRolePath('1', '2')).toBe('/space-settings/1/roles/2');
  });

  it('builds room settings paths, the web calling Permissions "overrides"', () => {
    expect(roomSettingsPath('9', 'overrides')).toBe('/room-settings/9/permissions');
    expect(roomSettingsPath('9', 'notifications')).toBe('/room-settings/9/notifications');
    expect(roomSettingsPath('9')).toBe('/room-settings/9');
  });

  it('round-trips override targets', () => {
    expect(parseOverrideTarget(overrideTargetParam({ kind: 'role', id: '42' }))).toEqual({ kind: 'role', id: '42' });
    expect(parseOverrideTarget(encodeURIComponent('user:7'))).toEqual({ kind: 'user', id: '7' });
    expect(parseOverrideTarget('bogus')).toBeNull();
    expect(parseOverrideTarget('channel:1')).toBeNull();
    expect(roomOverridePath('3', { kind: 'user', id: '7' })).toBe('/room-settings/3/permissions/user%3A7');
  });

  it('recognises consent URLs, with or without an origin', () => {
    expect(oauthConsentPath('https://chat.example/oauth2/authorize?client_id=1&scope=bot')).toBe('/oauth2/authorize?client_id=1&scope=bot');
    expect(oauthConsentPath('/oauth2/authorize?client_id=1')).toBe('/oauth2/authorize?client_id=1');
    expect(oauthConsentPath('https://chat.example/invite/abc')).toBeNull();
  });

  it('builds the theme editor and admin paths', () => {
    expect(themeEditorPath('custom-1')).toBe('/settings/theme-editor?base=custom-1');
    expect(themeEditorPath()).toBe('/settings/theme-editor');
    expect(adminPath('reports')).toBe('/admin?tab=reports');
    expect(adminPath('overview')).toBe('/admin');
  });
});

describe('settings list', () => {
  it('shows Instance only to an administrator', () => {
    expect(settingsGroups('', { instanceAdmin: false }).map((g) => g.id)).toEqual(['account', 'app', 'developers']);
    expect(settingsGroups('', { instanceAdmin: true }).map((g) => g.id)).toEqual(['account', 'app', 'developers', 'instance']);
  });

  it('filters by translated label or id and drops empty groups', () => {
    const groups = settingsGroups('secur', { instanceAdmin: true });
    expect(groups.map((g) => g.id)).toEqual(['account']);
    expect(groups[0]!.items.map((i) => i.id)).toEqual(['security']);
    expect(entryMatches(ACCOUNT_ENTRIES.find((e) => e.id === 'authorizedApps')!, 'authorizedapps')).toBe(true);
    expect(settingsGroups('zzzz', { instanceAdmin: true })).toEqual([]);
  });

  it('has no Desktop app page and calls keybinds Behaviour', () => {
    const ids = settingsGroups('', { instanceAdmin: true }).flatMap((g) => g.items.map((i) => i.id));
    expect(ids).not.toContain('desktop');
    const behaviour = settingsGroups('', { instanceAdmin: false })[1]!.items.find((i) => i.id === 'keybinds')!;
    expect(behaviour.label()).toBe('Behaviour');
  });
});

describe('colour helpers', () => {
  it("converts role colours like the web's role editor", () => {
    expect(intToHex(0x1abc9c)).toBe('#1abc9c');
    expect(intToHex(0)).toBe('#000000');
    expect(hexToInt('#1abc9c')).toBe(0x1abc9c);
    expect(hexToInt('nonsense')).toBe(0);
  });

  it('round-trips through HSV', () => {
    for (const hex of ['#509b6b', '#ffffff', '#000000', '#e91e63', '#3498db']) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
    expect(hexToHsv('#f00')).toEqual({ h: 0, s: 1, v: 1 });
  });

  it('desaturates like CSS saturate()', () => {
    expect(saturateHex('#509b6b', 100)).toBe('#509b6b');
    const grey = saturateHex('#ff0000', 0);
    expect(grey.slice(1, 3)).toBe(grey.slice(3, 5));
    expect(grey.slice(3, 5)).toBe(grey.slice(5, 7));
  });
});

describe('role hierarchy', () => {
  const roles = [role('everyone', 0, { name: '@everyone' }), role('mod', 2), role('helper', 1), role('admin', 3)];
  const ctx = (viewerId: string, viewerHighest: number): HierarchyContext => ({ ownerId: 'owner', viewerId, roles, everyoneId: 'everyone', viewerHighest });

  it('orders custom roles highest first', () => {
    expect(customRolesDesc(roles).map((r) => r.id)).toEqual(['admin', 'mod', 'helper']);
  });

  it('moves a role and patches only what changed', () => {
    const order = customRolesDesc(roles);
    const moved = moveRole(order, 'helper', 'up');
    expect(moved.map((r) => r.id)).toEqual(['admin', 'helper', 'mod']);
    expect(rolePositionPatches(moved)).toEqual([
      { id: 'mod', position: 1 },
      { id: 'helper', position: 2 },
    ]);
    expect(moveRole(order, 'admin', 'up').map((r) => r.id)).toEqual(['admin', 'mod', 'helper']);
    expect(rolePositionPatches(order)).toEqual([]);
  });

  it('locks roles at or above the viewer', () => {
    expect(roleLocked(role('x', 2), 2)).toBe(true);
    expect(roleLocked(role('x', 1), 2)).toBe(false);
    expect(roleLocked(role('x', 99), Number.POSITIVE_INFINITY)).toBe(false);
  });

  it('moderates only members ranked below, never self or the owner', () => {
    const viewer = ctx('me', 2);
    expect(canModerateMember(member('a', ['helper']), viewer)).toBe(true);
    expect(canModerateMember(member('b', ['mod']), viewer)).toBe(false);
    expect(canModerateMember(member('me', []), viewer)).toBe(false);
    expect(canModerateMember(member('owner', []), viewer)).toBe(false);
    expect(canModerateMember(member('b', ['admin']), ctx('owner', Number.POSITIVE_INFINITY))).toBe(true);
  });

  it('lets anyone with Manage Roles edit their own roles, the owner included', () => {
    expect(canEditMemberRoles(member('me', ['mod']), ctx('me', 2), true)).toBe(true);
    expect(canEditMemberRoles(member('owner'), ctx('owner', Number.POSITIVE_INFINITY), true)).toBe(true);
    expect(canEditMemberRoles(member('owner'), ctx('me', 3), true)).toBe(false);
    expect(canEditMemberRoles(member('a', ['helper']), ctx('me', 2), false)).toBe(false);
    expect(canAssignRoleTo('owner', { ownerId: 'owner', viewerId: 'me' })).toBe(false);
    expect(canAssignRoleTo('owner', { ownerId: 'owner', viewerId: 'owner' })).toBe(true);
  });

  it("keeps a member's other custom roles when one changes", () => {
    expect(memberRolesWith(member('a', ['everyone', 'helper']), roles, 'mod', true).sort()).toEqual(['helper', 'mod']);
    expect(memberRolesWith(member('a', ['helper', 'mod']), roles, 'mod', false)).toEqual(['helper']);
  });

  it('searches, filters and sorts members like the web table', () => {
    const list = [
      member('1', ['mod'], { display_name: 'Zed', joined_at: '2024-01-01T00:00:00Z' }),
      member('2', [], { display_name: 'amy', joined_at: '2025-01-01T00:00:00Z' }),
      member('3', ['mod'], { username: 'bob', joined_at: '2023-01-01T00:00:00Z' }),
    ];
    expect(filterMembers(list, { query: '', roleId: '', sort: 'joined_desc' }).map((m) => m.id)).toEqual(['2', '1', '3']);
    expect(filterMembers(list, { query: '', roleId: '', sort: 'joined_asc' }).map((m) => m.id)).toEqual(['3', '1', '2']);
    expect(filterMembers(list, { query: '', roleId: 'mod', sort: 'name' }).map((m) => m.id)).toEqual(['3', '1']);
    expect(filterMembers(list, { query: '2', roleId: '', sort: 'name' }).map((m) => m.id)).toEqual(['2']);
    expect(addableMembers(list, 'mod', '', { ownerId: '2', viewerId: '1' }).map((m) => m.id)).toEqual([]);
    expect(addableMembers(list, 'mod', '', { ownerId: 'x', viewerId: '1' }).map((m) => m.id)).toEqual(['2']);
  });
});

describe('permission overrides', () => {
  it('reads and writes tri-states (deny wins)', () => {
    expect(overrideState(PermSendMessages, PermSendMessages, PermSendMessages)).toBe('deny');
    expect(overrideState(PermSendMessages, 0, PermSendMessages)).toBe('allow');
    expect(overrideState(0, 0, PermSendMessages)).toBe('neutral');
    expect(applyOverrideState({ allow: 0, deny: PermSendMessages }, PermSendMessages, 'allow')).toEqual({ allow: PermSendMessages, deny: 0 });
    expect(applyOverrideState({ allow: PermSendMessages, deny: 0 }, PermSendMessages, 'neutral')).toEqual({ allow: 0, deny: 0 });
  });

  it('turns a section private by denying @everyone View, and back', () => {
    expect(privateSectionChange(undefined, true)).toEqual({ action: 'put', allow: 0, deny: PermViewChannel });
    expect(privateSectionChange({ allow: PermViewChannel | PermSendMessages, deny: 0 }, true)).toEqual({ action: 'put', allow: PermSendMessages, deny: PermViewChannel });
    expect(privateSectionChange({ allow: 0, deny: PermViewChannel }, false)).toEqual({ action: 'delete' });
    expect(privateSectionChange({ allow: 0, deny: PermViewChannel | PermSendMessages }, false)).toEqual({ action: 'put', allow: 0, deny: PermSendMessages });
    expect(isPrivateSection([{ role_id: 'e', allow: 0, deny: PermViewChannel, created_at: '', updated_at: '' }], 'e')).toBe(true);
    expect(isPrivateSection([], 'e')).toBe(false);
  });

  it('locks a synced channel inside a section', () => {
    expect(isChannelInSection({ type: 3, parent_id: '5' })).toBe(true);
    expect(isChannelInSection({ type: 5, parent_id: undefined })).toBe(false);
    expect(isSyncLocked({ type: 3, parent_id: '5', permissions_synced: true })).toBe(true);
    expect(isSyncLocked({ type: 3, parent_id: undefined, permissions_synced: true })).toBe(false);
  });

  it('offers voice rows for voice rooms and counts an override', () => {
    expect(overrideRowsFor({ type: 4 }).some((r) => r.bit === PermConnect)).toBe(true);
    expect(overrideRowsFor({ type: 3 }).some((r) => r.bit === PermConnect)).toBe(false);
    expect(overrideCounts({ allow: PermSendMessages, deny: PermViewChannel }, overrideRowsFor({ type: 3 }))).toEqual({ allowed: 1, denied: 1 });
    expect(PermAdministrator).toBeGreaterThan(0);
  });
});

describe('audit log', () => {
  const lookups = auditLookups(
    { u1: { id: 'u1', username: 'alice', display_name: 'Alice' } },
    [role('r1', 1, { name: 'Mods' })],
    [{ id: 'c1', type: 3, name: 'general', position: 0, created_at: '' }, { id: 's1', type: 5, name: 'Info', position: 0, created_at: '' }],
    [],
  );

  it('labels targets the web way', () => {
    expect(auditTargetLabel({ id: '1', action_type: 'room_update', user_id: 'u1', target_id: 'c1', created_at: '' }, lookups)).toBe('#general');
    expect(auditTargetLabel({ id: '1', action_type: 'room_update', user_id: 'u1', target_id: 's1', created_at: '' }, lookups)).toBe('Info');
    expect(auditTargetLabel({ id: '1', action_type: 'override_update', user_id: 'u1', target_id: 'c1:role:r1', created_at: '' }, lookups)).toBe('Mods · #general');
    expect(auditTargetLabel({ id: '1', action_type: 'emoji_delete', user_id: 'u1', target_id: 'e9', changes: { name: { old: 'blob' } }, created_at: '' }, lookups)).toBe(':blob:');
    expect(auditTargetLabel({ id: '1', action_type: 'member_kick', user_id: 'u1', target_id: 'nobody', created_at: '' }, lookups)).toBe('Someone');
  });

  it('writes the sentence and prettifies changes', () => {
    expect(auditSentence({ id: '1', action_type: 'role_create', user_id: 'u1', target_id: 'r1', created_at: '' }, lookups)).toContain('Alice');
    expect(auditChangeValue('roles', ['r1', 'zz'], lookups)).toBe('Mods, zz');
    expect(auditChangeValue('system_room_id', 'c1', lookups)).toBe('#general');
    expect(auditChangeValue('widget_enabled', true, lookups)).toBe('Enabled');
    expect(auditChangeValue('afk_timeout', 300, lookups)).toBe('5 minutes');
    expect(auditChangeValue('name', '', lookups)).toBe('—');
  });
});

describe('image checks', () => {
  it("rejects what the web's pickers reject", () => {
    expect(validateImage({ type: 'image/png', size: 10 }, { maxBytes: 100 })).toBeNull();
    expect(validateImage({ type: 'video/mp4', size: 10 })).toMatch(/image file/i);
    expect(validateImage({ type: 'image/png', size: 1000 }, { maxBytes: 100 })).toMatch(/8MB/);
    expect(validateImage({ type: 'image/heic', size: 1 }, { accept: ['image/png'] })).toMatch(/image file/i);
  });
});
