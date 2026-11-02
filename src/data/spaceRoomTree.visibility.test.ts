/**
 * The room tree with the real visibility rule: a room synced to a section the viewer cannot see
 * is hidden, not promoted to the top level. The server leaves such a section out of the viewer's
 * list, so here it reads as "parent not found"; the same goes for a new room in a private
 * section, which a space-wide SPACE_ROOM_CREATE delivers with no overrides of its own.
 */
import { describe, expect, jest, test } from '@jest/globals';
import type { SpaceRole, SpaceRoom } from '@web/api/spaces';
import { PermAdministrator, PermViewChannel, canViewSpaceChannel } from '@web/lib/spacePermissions';
import { buildSpaceRoomTree } from './spaceRoomTree';

jest.mock('@web/i18n', () => ({ t: (key: string) => key }));

const EVERYONE = 'r-everyone';
const ADMIN = 'r-admin';

function role(id: string, permissions: number, name = id): SpaceRole {
  return { id, name, permissions, position: 0, color: 0, hoist: false, mentionable: false, created_at: '', updated_at: '' };
}
const ROLES = [role(EVERYONE, PermViewChannel, '@everyone'), role(ADMIN, PermAdministrator)];

function room(id: string, type: number, extra: Partial<SpaceRoom> = {}): SpaceRoom {
  return { id, type, name: id, position: 0, permission_overrides: [], user_overrides: [], created_at: '', updated_at: '', ...extra };
}

const denyEveryone = [{ role_id: EVERYONE, allow: 0, deny: PermViewChannel, created_at: '', updated_at: '' }];
const GENERAL = room('general', 3);
const STAFF_CHAT = room('staff-chat', 3, { parent_id: 'staff', permissions_synced: true });

function visible(rooms: SpaceRoom[], viewer: { id?: string; owner?: string; roles?: string[]; spaceRoles?: SpaceRole[] } = {}) {
  const spaceRoles = 'spaceRoles' in viewer ? viewer.spaceRoles : ROLES;
  const items = buildSpaceRoomTree({
    rooms,
    canView: (r) =>
      canViewSpaceChannel({
        room: r,
        allRooms: rooms,
        memberUserId: viewer.id ?? 'member',
        ownerId: viewer.owner ?? 'owner',
        everyoneRoleId: EVERYONE,
        memberRoleIds: viewer.roles ?? [],
        roles: spaceRoles,
      }),
    collapsedSectionIds: new Set<string>(),
    activeRoomId: null,
    hasUnreadOrMention: () => false,
  });
  return items.flatMap((i) => (i.kind === 'channel' ? [i.roomId] : []));
}

describe('a synced room whose section is missing', () => {
  test('is hidden from a member, not listed at the top level', () => {
    expect(visible([GENERAL, STAFF_CHAT])).toEqual(['general']);
  });

  test('stays hidden with no overrides known at all', () => {
    const { permission_overrides: _roles, user_overrides: _users, ...bare } = STAFF_CHAT;
    expect(visible([GENERAL, bare as SpaceRoom])).toEqual(['general']);
  });

  test('stays with the owner and an Administrator, for whom it is only dangling', () => {
    expect(visible([STAFF_CHAT], { id: 'owner' })).toEqual(['staff-chat']);
    expect(visible([STAFF_CHAT], { roles: [ADMIN] })).toEqual(['staff-chat']);
  });

  test('is listed while the roles to decide with are not loaded', () => {
    expect(visible([STAFF_CHAT], { spaceRoles: undefined })).toEqual(['staff-chat']);
  });
});

describe('the rest of the rule is unchanged', () => {
  test('an unsynced room keeps its own overrides when its section is missing', () => {
    expect(visible([room('public', 3, { parent_id: 'staff' })])).toEqual(['public']);
    expect(visible([room('private', 3, { parent_id: 'staff', permission_overrides: denyEveryone })])).toEqual([]);
  });

  test('a synced room follows a section that is there', () => {
    const section = room('staff', 5);
    expect(visible([section, STAFF_CHAT])).toEqual(['staff-chat']);
    expect(visible([{ ...section, permission_overrides: denyEveryone }, STAFF_CHAT])).toEqual([]);
  });
});
