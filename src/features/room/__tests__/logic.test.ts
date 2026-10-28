/**
 * The room area's rules without a screen: the recovery-code field's re-grouping and caret, the
 * role editor's hierarchy rules, the search query the chips build (read back by the web's own
 * parser), the result rows, the header's buttons per kind of room, the thread browser's order,
 * and the route builder.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import { parseSearchQuery, type SearchMatch } from '@web/lib/messageSearch';
import { setSpaces } from '@web/stores/spaces';
import { setMessages, type DecryptedMessage } from '@web/stores/messages';
import type { SpaceRole } from '@web/api/spaces';
import { resetStores, sroom, message } from '@/data/testing/fixtures';
import { caretAfterEdit, recoveryCodeComplete, reformatRecoveryInput } from '../e2ee/recoveryInput';
import {
  canEditMemberRoles,
  displayedRoles,
  mergedRoleIds,
  pickedFromContext,
  roleRemovable,
  rolesAvailableToAdd,
} from '../profile/roles';
import { buildSearchQuery, filterKeysFor, filterPeople, groupMatches, personLabel, searchRows } from '../search/searchModel';
import { headerActionKeys } from '../headerModel';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false, canDismiss: () => false, dismissAll: jest.fn() } }));
jest.mock('@/platform/crypto', () => ({ cryptoHost: { state: 'ready', onStateChange: () => () => undefined } }));
jest.mock('@web/lib/e2ee/keyBackup', () => ({ getBackupStatus: jest.fn(async () => ({ exists: false })), stopBackupSync: () => undefined }));

 
const { routeWithParams } = require('../navigation') as typeof import('../navigation');
const { channelThreadIds, sortThreads } = require('../threads/data') as typeof import('../threads/data');
const { pendingDecryptCount } = require('../hooks') as typeof import('../hooks');
 

beforeEach(() => resetStores());

describe('recovery code field', () => {
  test('groups typed characters into blocks of four', () => {
    expect(reformatRecoveryInput('abcd2345', 8)).toEqual({ value: 'ABCD-2345', caret: 9 });
    expect(reformatRecoveryInput('abcd-2345-x', 11).value).toBe('ABCD-2345-X');
  });

  test('keeps the caret after the same code character when editing the middle', () => {
    // "ABCD-2345" with the caret after "AB": typing "Z" there.
    const prev = 'ABCD-2345';
    const raw = 'ABZCD-2345';
    const caret = caretAfterEdit(prev, { start: 2, end: 2 }, raw);
    expect(caret).toBe(3);
    const next = reformatRecoveryInput(raw, caret);
    expect(next.value).toBe('ABZC-D234-5');
    expect(next.caret).toBe(3);
  });

  test('a deletion moves the caret back, a replaced selection lands after the insert', () => {
    expect(caretAfterEdit('ABCD', { start: 4, end: 4 }, 'ABC')).toBe(3);
    expect(caretAfterEdit('ABCD-EFGH', { start: 0, end: 9 }, 'X')).toBe(1);
  });

  test('normalises the read-back aliases and needs every character', () => {
    expect(reformatRecoveryInput('o1il', 4).value).toBe('0111');
    expect(recoveryCodeComplete('A'.repeat(27))).toBe(false);
    expect(recoveryCodeComplete('A'.repeat(28))).toBe(true);
  });
});

function role(id: string, position: number, extra: Partial<SpaceRole> = {}): SpaceRole {
  return { id, name: id, permissions: 0, position, color: 0, hoist: false, mentionable: false, created_at: '', updated_at: '', ...extra };
}

describe('role editor rules', () => {
  const roles = [role('everyone', 0, { name: '@everyone' }), role('mod', 5), role('admin', 9), role('helper', 2), role('botrole', 3, { bot_id: 'b' })];
  const ctx = {
    spaceOwnerId: 'owner',
    subjectRoleIds: ['everyone', 'helper', 'admin'],
    spaceRoles: roles,
    canManageMemberRoles: true,
    viewerHighestPosition: 5,
  };

  test('needs Manage Roles and nothing about the member: the owner and higher-ranked members too', () => {
    expect(canEditMemberRoles(ctx, 'u')).toBe(true);
    expect(canEditMemberRoles({ ...ctx, canManageMemberRoles: false }, 'u')).toBe(false);
    // Discord's rule (and the server's since member roles stopped checking the member's rank):
    // the owner's roles are open to anyone with Manage Roles, within the role ceiling.
    expect(canEditMemberRoles(ctx, 'owner')).toBe(true);
    // A member who outranks the viewer (holds "admin" at 9, above the viewer's 5) is editable too.
    expect(canEditMemberRoles({ ...ctx, subjectRoleIds: ['everyone', 'admin'] }, 'u')).toBe(true);
    expect(canEditMemberRoles({ ...ctx, spaceRoles: [roles[0]!] }, 'u')).toBe(false);
    expect(canEditMemberRoles(ctx, undefined)).toBe(false);
  });

  test("on the owner, the chips and the add list are the viewer's ceiling's, not the owner's rank", () => {
    const ownerCtx = { ...ctx, spaceOwnerId: 'owner', subjectRoleIds: ['everyone', 'admin', 'helper'] };
    const picked = pickedFromContext(ownerCtx);
    const editable = canEditMemberRoles(ownerCtx, 'owner');
    expect(roleRemovable(roles[3]!, ownerCtx, editable)).toBe(true); // helper (2) is below the viewer (5)
    expect(roleRemovable(roles[2]!, ownerCtx, editable)).toBe(false); // admin (9) is not
    expect(rolesAvailableToAdd({ ...ownerCtx, viewerHighestPosition: 6 }, picked, editable).map((r) => r.id)).toEqual(['mod']);
  });

  test('ties in position read as the server breaks them: the older (smaller) id ranks higher', () => {
    const tied = [role('everyone', 0, { name: '@everyone' }), role('20', 4), role('3', 4), role('100', 4)];
    const tiedCtx = { ...ctx, spaceRoles: tied, subjectRoleIds: ['everyone', '20', '3', '100'] };
    expect(displayedRoles(tiedCtx, pickedFromContext(tiedCtx), true).map((r) => r.id)).toEqual(['3', '20', '100']);
    expect(rolesAvailableToAdd(tiedCtx, new Set(), true).map((r) => r.id)).toEqual(['3', '20', '100']);
  });

  test('chips are the held roles without @everyone, highest first; locks follow the ceiling', () => {
    const picked = pickedFromContext(ctx);
    expect([...picked].sort()).toEqual(['admin', 'helper']);
    expect(displayedRoles(ctx, picked, true).map((r) => r.id)).toEqual(['admin', 'helper']);
    expect(roleRemovable(roles[2]!, ctx, true)).toBe(false); // admin is above the viewer
    expect(roleRemovable(roles[3]!, ctx, true)).toBe(true);
    expect(roleRemovable(roles[4]!, ctx, true)).toBe(false); // a bot's managed role
  });

  test('the add list leaves out held, locked, bot-managed and @everyone', () => {
    const picked = pickedFromContext(ctx);
    expect(rolesAvailableToAdd(ctx, picked, true).map((r) => r.id)).toEqual([]);
    expect(rolesAvailableToAdd({ ...ctx, viewerHighestPosition: Number.MAX_SAFE_INTEGER }, picked, true).map((r) => r.id)).toEqual(['mod']);
    expect(rolesAvailableToAdd(ctx, picked, false)).toEqual([]);
  });

  test('a save stores @everyone first', () => {
    expect(mergedRoleIds(ctx, ['mod', 'helper'])).toEqual(['everyone', 'mod', 'helper']);
  });
});

describe('search query from chips', () => {
  test('serialises to the web grammar and parses back by id', () => {
    const raw = buildSearchQuery('  hello world ', {
      from: { value: '42', label: 'Alice' },
      has: { value: 'image', label: 'Images' },
      in: { value: '7', label: '#general' },
    });
    expect(raw).toBe('hello world from:42 in:7 has:image');
    const q = parseSearchQuery(raw, { people: [], channels: [] });
    expect(q).toMatchObject({ text: 'hello world', from: '42', in: '7', has: 'image' });
  });

  test('typed tokens still work beside chips', () => {
    const raw = buildSearchQuery('from:alice cats', { mentions: { value: '9', label: '@Bob' } });
    const q = parseSearchQuery(raw, { people: [{ id: '5', username: 'alice' }], channels: [] });
    expect(q).toMatchObject({ text: 'cats', from: '5', mentions: '9' });
  });

  test('in: is offered only for a space', () => {
    expect(filterKeysFor(true)).toEqual(['from', 'in', 'has', 'mentions']);
    expect(filterKeysFor(false)).toEqual(['from', 'has', 'mentions']);
  });

  test('people filter by name or username, a leading @ ignored', () => {
    const people = [
      { id: '1', username: 'alice', display_name: 'Alice Liddell' },
      { id: '2', username: 'bob' },
    ];
    expect(filterPeople(people, '@ALI').map((p) => p.id)).toEqual(['1']);
    expect(filterPeople(people, 'liddell').map((p) => p.id)).toEqual(['1']);
    expect(filterPeople(people, ' ')).toHaveLength(2);
    expect(personLabel(people[1]!)).toBe('bob');
  });
});

describe('search result rows', () => {
  const hit = (roomId: string, id: string): SearchMatch => ({ roomId, message: message(roomId, id, 'u') as DecryptedMessage });

  test('space hits are grouped under their room, consecutive runs only', () => {
    const list = [hit('a', '1'), hit('a', '2'), hit('b', '3'), hit('a', '4')];
    expect(groupMatches(list).map((g) => [g.roomId, g.matches.length])).toEqual([
      ['a', 2],
      ['b', 1],
      ['a', 1],
    ]);
    const rows = searchRows({ matches: list, grouped: true, notes: [{ icon: 'lock', text: 'note' }], hasMore: true });
    expect(rows.map((r) => r.kind)).toEqual(['note', 'room', 'hit', 'hit', 'room', 'hit', 'room', 'hit', 'more']);
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
  });

  test('a conversation search is a flat list', () => {
    const rows = searchRows({ matches: [hit('r', '1')], grouped: false, notes: [], hasMore: false });
    expect(rows.map((r) => r.kind)).toEqual(['hit']);
  });
});

describe('header buttons', () => {
  const base = { callable: false, hasMemberList: false, spaceId: undefined as string | undefined };

  test('phones keep two or three per kind of room', () => {
    expect(headerActionKeys({ ...base, kind: 'pm', callable: true }, { wide: false, voiceEnabled: true })).toEqual(['call', 'video', 'search']);
    expect(headerActionKeys({ ...base, kind: 'pm', callable: true }, { wide: false, voiceEnabled: false })).toEqual(['search']);
    expect(headerActionKeys({ ...base, kind: 'group', callable: true, hasMemberList: true }, { wide: false, voiceEnabled: true })).toEqual([
      'call',
      'video',
      'members',
    ]);
    expect(headerActionKeys({ ...base, kind: 'notes' }, { wide: false, voiceEnabled: true })).toEqual(['pins', 'search']);
    expect(headerActionKeys({ ...base, kind: 'text', hasMemberList: true, spaceId: 's' }, { wide: false, voiceEnabled: true })).toEqual([
      'threads',
      'search',
      'members',
    ]);
    expect(headerActionKeys({ ...base, kind: 'thread', hasMemberList: true, spaceId: 's' }, { wide: false, voiceEnabled: true })).toEqual([
      'search',
      'members',
    ]);
  });

  test('a tablet shows the whole set the room has', () => {
    expect(headerActionKeys({ ...base, kind: 'text', hasMemberList: true, spaceId: 's' }, { wide: true, voiceEnabled: true })).toEqual([
      'threads',
      'pins',
      'notify',
      'search',
      'members',
    ]);
  });
});

describe('threads and other reads', () => {
  test('the browser lists a channel’s live threads, joined first, then by activity', () => {
    const thread = (id: string, joined: boolean, last: string, archived = false) =>
      sroom(id, 6, {
        parent_id: 'c',
        thread: { archived, locked: false, private: false, invitable: true, auto_archive_minutes: 60, owner_id: 'u', message_count: 0, member_count: 0, joined, last_active_at: last },
      });
    setSpaces({
      spaceRoomsBySpaceId: {
        s: [
          sroom('c', 3),
          thread('t1', false, '2026-10-03T00:00:00Z'),
          thread('t2', true, '2026-10-01T00:00:00Z'),
          thread('t3', false, '2026-10-05T00:00:00Z'),
          thread('t4', true, '2026-10-06T00:00:00Z', true),
          sroom('other', 6, { parent_id: 'x' }),
        ],
      },
    });
    expect(channelThreadIds('s', 'c')).toEqual(['t2', 't3', 't1']);
    expect(sortThreads([]).length).toBe(0);
  });

  test('waiting-for-key messages are counted, temp and system ones are not', () => {
    (setMessages as unknown as (k: string, id: string, v: unknown) => void)('byRoom', 'r', [
      message('r', '1', 'u', { decryptPending: true }),
      message('r', '2', 'u'),
      message('r', 'temp-3', 'u', { decryptPending: true }),
      message('r', '4', 'u', { decryptPending: true, system_type: 'x' }),
    ]);
    expect(pendingDecryptCount('r')).toBe(1);
  });

  test('routes carry only the params that are set', () => {
    expect(routeWithParams('/pins/1', { spaceId: 's 1', roomId: null, x: '' })).toBe('/pins/1?spaceId=s%201');
    expect(routeWithParams('/group/2')).toBe('/group/2');
  });
});
