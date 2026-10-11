/**
 * The nav area's pure rules: invite codes from any instance, reorder scopes and bodies, the
 * Friends tabs, Discover's filter, and the small layout helpers.
 */
import './navTestSetup';
import { describe, expect, test } from '@jest/globals';
import { setPresence } from '@web/stores/presence';
import type { Relationship } from '@web/api/relationships';
import type { DiscoverEntry } from '@web/api/discover';
import type { InvitePreview } from '@web/api/spaces';
import { sroom } from '@/data/testing/fixtures';
import { inviteCodeFromAnyInput } from '../invites';
import { reorderBody, scopeIds, scopeOf, stepOrder } from '../reorder';
import { friendSections, friendSubtitle, hasAnyRelationship, incomingCount, normalizeHandle } from '../friendsModel';
import { hasRemoteListings, isJoinedListing, matchesDiscover, visibleListings } from '../discover/model';
import { greetingKey } from '../HomeLanding';
import { railItems } from '../rail/SpaceRail';
import { notificationRows, spaceIdFromHref } from '../notifications/NotificationsPanel';
import { decodeInviteParam, memberSpaceId } from '../invite/InviteScreen';
import { defaultParentSection } from '../sheets/CreateRoomSheet';
import { filterFriends } from '../sheets/FriendPickerSheets';
import { myHandle } from '../sheets/AddFriendSheet';

describe('invite codes from what people paste', () => {
  const local = new Set(['chat.local.test']);
  test('a bare code and code@domain pass through', () => {
    expect(inviteCodeFromAnyInput('abc123', local)).toBe('abc123');
    expect(inviteCodeFromAnyInput('  abc123@other.example ', local)).toBe('abc123@other.example');
  });
  test('a link from this instance is its bare code', () => {
    expect(inviteCodeFromAnyInput('https://chat.local.test/invite/abc123', local)).toBe('abc123');
  });
  test('a link from another instance names that instance', () => {
    expect(inviteCodeFromAnyInput('https://other.example/invite/Zz9', local)).toBe('Zz9@other.example');
    expect(inviteCodeFromAnyInput('other.example:8443/invite/Zz9', local)).toBe('Zz9@other.example:8443');
  });
  test('a link that already names the origin keeps it', () => {
    expect(inviteCodeFromAnyInput('https://other.example/invite/Zz9%40third.example', local)).toBe('Zz9@third.example');
  });
  test('garbage is refused', () => {
    expect(inviteCodeFromAnyInput('not an invite!', local)).toBeNull();
    expect(inviteCodeFromAnyInput('', local)).toBeNull();
  });
});

describe('reordering', () => {
  const rooms = [
    sroom('secB', 5, { position: 2 }),
    sroom('secA', 5, { position: 1 }),
    sroom('top2', 3, { position: 2 }),
    sroom('top1', 4, { position: 1 }),
    sroom('a1', 3, { position: 1, parent_id: 'secA' }),
    sroom('a2', 3, { position: 2, parent_id: 'secA' }),
    sroom('hidden', 3, { position: 3, parent_id: 'secA' }),
    sroom('th', 6, { position: 0, parent_id: 'a1' }),
  ];
  const canView = (r: { id: string }) => r.id !== 'hidden';

  test('scopes list what the list shows, by position', () => {
    expect(scopeIds(rooms, 'sections', canView)).toEqual(['secA', 'secB']);
    expect(scopeIds(rooms, 'top', canView)).toEqual(['top1', 'top2']);
    expect(scopeIds(rooms, 'sec:secA', canView)).toEqual(['a1', 'a2']);
    expect(scopeIds(rooms, 'sec:nope', canView)).toEqual([]);
  });

  test('a room is ordered within its parent; threads are not ordered', () => {
    expect(scopeOf(rooms, 'secB')).toBe('sections');
    expect(scopeOf(rooms, 'top2')).toBe('top');
    expect(scopeOf(rooms, 'a2')).toBe('sec:secA');
    expect(scopeOf(rooms, 'th')).toBeNull();
  });

  test('one step swaps neighbours, and stops at the ends', () => {
    expect(stepOrder(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c']);
    expect(stepOrder(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b']);
    expect(stepOrder(['a', 'b', 'c'], 'a', -1)).toBeNull();
    expect(stepOrder(['a', 'b', 'c'], 'c', 1)).toBeNull();
    expect(stepOrder(['a'], 'x', 1)).toBeNull();
  });

  test('request bodies are the web drag layer’s', () => {
    expect(reorderBody('sections', ['x'])).toEqual({ scope: 'sections', room_ids: ['x'] });
    expect(reorderBody('top', ['x'])).toEqual({ scope: 'channels', parent_section_id: null, room_ids: ['x'] });
    expect(reorderBody('sec:s1', ['x'])).toEqual({ scope: 'channels', parent_section_id: 's1', room_ids: ['x'] });
  });
});

function rel(id: string, type: number, extra: Partial<Relationship['user']> = {}): Relationship {
  return { id, type: type as Relationship['type'], user: { id, username: `u${id}`, display_name: `User ${id}`, ...extra } };
}

describe('friends', () => {
  const list = [
    rel('1', 1, { presence: { status: 'online' } }),
    rel('2', 1, { presence: { status: 'dnd' } }),
    rel('3', 1),
    rel('4', 3),
    rel('5', 4),
    rel('6', 2),
  ];

  test('Online is online or idle - not dnd - from live or embedded presence', () => {
    setPresence({ byUser: { '3': { status: 'idle' } } });
    const live = (id: string) => (id === '3' ? { status: 'idle' as const } : undefined);
    expect(friendSections(list, 'online', live)).toEqual([{ titleKey: 'friends.sections.online', kind: 'friend', userIds: ['1', '3'] }]);
  });

  test('Pending is incoming then sent; the tab count is incoming only', () => {
    expect(friendSections(list, 'pending', () => undefined).map((s) => [s.kind, s.userIds])).toEqual([
      ['incoming', ['4']],
      ['outgoing', ['5']],
    ]);
    expect(incomingCount(list)).toBe(1);
  });

  test('empty tabs have no sections; any relationship counts', () => {
    expect(friendSections([rel('1', 1)], 'blocked', () => undefined)).toEqual([]);
    expect(hasAnyRelationship([])).toBe(false);
    expect(hasAnyRelationship([rel('9', 2)])).toBe(true);
  });

  test('the second line is the custom status only while present, else the handle', () => {
    const r = rel('1', 1, { presence: { status: 'online', custom_status: 'coding' } });
    expect(friendSubtitle(r, undefined, 'u1')).toBe('coding');
    expect(friendSubtitle(r, { status: 'offline' }, 'u1')).toBe('u1');
    expect(friendSubtitle(r, { status: 'idle', custom_status: 'afk' }, 'u1')).toBe('afk');
  });

  test('handles follow the server grammar; a leading @ is dropped', () => {
    expect(normalizeHandle(' @turtle ')).toBe('turtle');
    expect(normalizeHandle('turtle@chat.example:8443')).toBe('turtle@chat.example:8443');
    expect(normalizeHandle('t')).toBeNull();
    expect(normalizeHandle('turtle@')).toBeNull();
    expect(normalizeHandle('has space')).toBeNull();
  });

  test('your handle carries the domain only when the instance federates', () => {
    expect(myHandle('me', true, 'a.example')).toBe('me@a.example');
    expect(myHandle('me', false, 'a.example')).toBe('me');
  });

  test('the friend picker searches names and handles', () => {
    const fs = [
      { id: '1', name: 'Alice', handle: 'alice' },
      { id: '2', name: 'Bob', handle: 'bob@b.example' },
    ];
    expect(filterFriends(fs, 'b.EX').map((f) => f.id)).toEqual(['2']);
    expect(filterFriends(fs, '').map((f) => f.id)).toEqual(['1', '2']);
  });
});

function listing(extra: Partial<DiscoverEntry>): DiscoverEntry {
  return { kind: 'space', id: 'x', status: 'approved', tagline: '', tags: [], requested_at: '', ...extra };
}

describe('discover', () => {
  const local = listing({ space: { id: 's1', name: 'Gardening', name_acronym: 'G', member_count: 3, online_count: 1 }, tags: ['plants'] });
  const remote = listing({
    tagline: 'Retro games',
    space: { id: 's9', origin_domain: 'b.example', name: 'Arcade', name_acronym: 'A', member_count: 9, online_count: 2 },
  });
  const bot = listing({ kind: 'bot', bot: { application_id: 'app', name: 'Helper', bot: { id: 'app', username: 'helperbot', display_name: 'Helper' } } });

  test('search covers tagline, tags, names and bot usernames', () => {
    expect(matchesDiscover(local, 'PLANT')).toBe(true);
    expect(matchesDiscover(remote, 'retro')).toBe(true);
    expect(matchesDiscover(bot, 'helperbot')).toBe(true);
    expect(matchesDiscover(local, 'zzz')).toBe(false);
  });

  test('"This instance" hides federated listings', () => {
    expect(visibleListings([local, remote], 'spaces', 'local', '')).toEqual([local]);
    expect(visibleListings([local, remote], 'spaces', 'all', '')).toEqual([local, remote]);
    expect(hasRemoteListings([local])).toBe(false);
    expect(hasRemoteListings([local, remote])).toBe(true);
  });

  test('a remote card is never "already joined" by its origin id', () => {
    expect(isJoinedListing(local, new Set(['s1']))).toBe(true);
    expect(isJoinedListing(remote, new Set(['s9']))).toBe(false);
  });
});

describe('invite preview membership', () => {
  const preview = (id: string, federation?: { origin_domain: string; origin_id: string }) =>
    ({ space: { id, name: 'S', ...(federation ? { federation } : {}) } }) as unknown as InvitePreview;

  test('matches a local space by id', () => {
    expect(memberSpaceId(preview('s1'), [{ id: 's1' }])).toBe('s1');
  });

  test('matches our mirror of a space previewed from its origin (code@domain)', () => {
    const mine = [{ id: 'local7', federation: { origin_id: 'o1', origin_domain: 'b.example' } }];
    expect(memberSpaceId(preview('o1'), mine, 'b.example')).toBe('local7');
    expect(memberSpaceId(preview('o1'), mine, 'c.example')).toBeNull();
    expect(memberSpaceId(preview('o1'), mine)).toBeNull();
  });

  test('decodes a percent-encoded federated code', () => {
    expect(decodeInviteParam('abc%40b.example')).toBe('abc@b.example');
    expect(decodeInviteParam(['x'])).toBe('x');
    expect(decodeInviteParam(undefined)).toBe('');
    expect(decodeInviteParam('%E0%A4%A')).toBe('%E0%A4%A');
  });
});

describe('small helpers', () => {
  test('greeting buckets', () => {
    expect(greetingKey(5)).toBe('home.greetingMorning');
    expect(greetingKey(12)).toBe('home.greetingAfternoon');
    expect(greetingKey(17)).toBe('home.greetingEvening');
    expect(greetingKey(21)).toBe('home.greetingNight');
    expect(greetingKey(3)).toBe('home.greetingNight');
  });

  test('the rail: home, unread PMs, divider, spaces, divider, add, discover', () => {
    expect(railItems(['p1'], ['s1', 's2']).map((i) => i.kind)).toEqual(['home', 'dm', 'divider', 'space', 'space', 'divider', 'add', 'discover']);
    expect(railItems([], []).map((i) => i.kind)).toEqual(['home', 'divider', 'add', 'discover']);
  });

  test('the default parent section follows the room type', () => {
    const sections = [
      { id: 'a', name: 'Text rooms' },
      { id: 'b', name: 'Voice Rooms' },
    ];
    expect(defaultParentSection(sections, 'text')).toBe('a');
    expect(defaultParentSection(sections, 'voice')).toBe('b');
    expect(defaultParentSection([{ id: 'c', name: 'General' }], 'text')).toBeNull();
  });

  test('notification rows: requests first, then recent; space ids from hrefs', () => {
    const rows = notificationRows(
      [{ userId: 'u', name: 'U', username: 'u' }],
      [{ roomId: 'r', href: '/spaces/s1/rooms/r', name: 'general', context: 'S', mention: true, count: 2, avatar: null, isChannel: true, lastMessageId: '5' }],
    );
    expect(rows.map((r) => r.kind)).toEqual(['header', 'request', 'header', 'item']);
    expect(spaceIdFromHref('/spaces/s1/rooms/r')).toBe('s1');
    expect(spaceIdFromHref('/rooms/r')).toBeNull();
  });
});
