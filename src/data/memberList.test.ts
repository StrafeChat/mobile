import { describe, expect, test } from '@jest/globals';
import './testing/webMocks';
import type { SpaceRole, SpaceRoomOverride } from '@web/api/spaces';
import { PermSendMessages, PermViewChannel } from '@web/lib/spacePermissions';
import { buildMemberList, membersWhoCanView, type MemberListItem } from './memberList';

function role(id: string, position: number, extra: Partial<SpaceRole> = {}): SpaceRole {
  return {
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
  };
}

const ROLES = [
  role('everyone', 0, { name: '@everyone', permissions: PermViewChannel | PermSendMessages }),
  role('mods', 5, { hoist: true, name: 'Mods' }),
  role('vip', 3, { hoist: true, name: 'VIP' }),
  role('colour', 9, { hoist: false, name: 'Colour' }),
];

const people = [
  { id: 'a', username: 'zed', display_name: 'Zed', roles: ['vip'] },
  { id: 'b', username: 'amy', display_name: 'amy', roles: ['mods', 'vip'] },
  { id: 'c', username: 'bob', display_name: '', roles: ['colour'] },
  { id: 'd', username: 'cy', display_name: 'Cy' },
  { id: 'e', username: 'eve', display_name: 'Ève' },
];
const status: Record<string, string> = { a: 'online', b: 'dnd', c: 'idle', d: 'offline', e: 'invisible' };
const labels = { online: 'ONLINE', offline: 'OFFLINE', members: 'MEMBERS' };

const short = (items: MemberListItem[]) =>
  items.map((i) => (i.kind === 'header' ? `# ${i.label} ${i.count}` : `${i.userId}${i.dim ? ' (dim)' : ''}`));

test('space: one section per hoisted role by position, then Online, then Offline', () => {
  const items = buildMemberList({ members: people, roles: ROLES, statusOf: (m) => status[m.id], labels });
  expect(short(items)).toEqual(['# Mods 1', 'b', '# VIP 1', 'a', '# ONLINE 1', 'c', '# OFFLINE 2', 'd (dim)', 'e (dim)']);
});

test('group PM: one flat list, online then offline, each by name, under a Members header', () => {
  const items = buildMemberList({ members: people, roles: undefined, statusOf: (m) => status[m.id], labels });
  // amy < bob (no display name: username) < Zed; offline Cy < Ève (accent-insensitive).
  expect(short(items)).toEqual(['# MEMBERS 5', 'b', 'c', 'a', 'd (dim)', 'e (dim)']);
  expect(short(buildMemberList({ members: people, roles: undefined, statusOf: () => 'online', labels, showMembersHeader: false }))[0]).toBe('b');
});

test('unknown status counts as offline', () => {
  const items = buildMemberList({ members: people.slice(0, 1), roles: ROLES, statusOf: () => undefined, labels });
  expect(short(items)).toEqual(['# OFFLINE 1', 'a (dim)']);
});

describe('membersWhoCanView', () => {
  const overrides: SpaceRoomOverride[] = [
    { role_id: 'everyone', allow: 0, deny: PermViewChannel, created_at: '', updated_at: '' },
    { role_id: 'vip', allow: PermViewChannel, deny: 0, created_at: '', updated_at: '' },
  ];
  const ctx = { ownerId: 'd', everyoneRoleId: 'everyone', roles: ROLES, overrides, userOverrides: [] };

  test('a private channel shows the roles it allows, and the owner', () => {
    expect(membersWhoCanView(people, ctx).map((m) => m.id)).toEqual(['a', 'b', 'd']);
  });

  test('everyone while roles or overrides are unknown', () => {
    expect(membersWhoCanView(people, { ...ctx, overrides: undefined })).toHaveLength(5);
    expect(membersWhoCanView(people, { ...ctx, roles: undefined })).toHaveLength(5);
  });

  test('a user override grants a single person', () => {
    const withUser = { ...ctx, userOverrides: [{ user_id: 'e', allow: PermViewChannel, deny: 0, created_at: '', updated_at: '' }] };
    expect(membersWhoCanView(people, withUser).map((m) => m.id)).toEqual(['a', 'b', 'd', 'e']);
  });
});
