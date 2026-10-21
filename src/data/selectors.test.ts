/**
 * The store-backed selectors against READY-shaped fixtures: rail badges, the PM list, room
 * rows, member lists, the notifications feed and voice occupants. The web stores are the real
 * ones (rooms, spaces, readState, presence...); only the gateway, voice and messages modules
 * are the stand-ins from webMocks.
 */
import { beforeEach, describe, expect, test } from '@jest/globals';
import './testing/webMocks';
import { setRooms } from '@web/stores/rooms';
import { setSpaces } from '@web/stores/spaces';
import { setReadState } from '@web/stores/readState';
import { setSpaceMembers, upsertSpaceMember } from '@web/stores/spaceMembers';
import { setPresence } from '@web/stores/presence';
import { setRelationships, RelType } from '@web/stores/relationships';
import { setMessages } from '@web/stores/messages';
import { setVoice } from '@web/stores/voice';
import { PermSendMessages, PermViewChannel } from '@web/lib/spacePermissions';
import { notificationItems, notificationBadgeCount } from '@web/lib/mobileNotifications';
import { ME, group, member, message, pm, resetStores, role, sroom, space, user, voiceState } from './testing/fixtures';
import { railDmRoomIds, spaceMentionCount, spaceUnreadCount, spaceAbilities } from './spaces';
import { pmRoomIds, pmRowView, roomInfo, latestMessageIdForRoom } from './rooms';
import { channelRowView, sectionRowView, spaceRoomTree, threadRowView } from './spaceRoomList';
import { memberListItems, memberRowView } from './members';
import { friendIds, profileSubject, userDisplay } from './users';
import { voiceOccupants } from './voice';
import { replyReferenceView } from './messages';
import { PermChangeNickname, PermManageNicknames } from './spaceProfileCompat';

beforeEach(resetStores);

const EVERYONE = role('ev', 0, PermViewChannel | PermSendMessages, { name: '@everyone' });

describe('space rail badges', () => {
  beforeEach(() => {
    setSpaces({
      spaces: [space('s1', [EVERYONE])],
      spaceRoomsBySpaceId: {
        s1: [
          sroom('t1', 3, { last_message_id: '50', last_read_message_id: '40' }),
          sroom('t2', 3, { last_message_id: '60', last_read_message_id: '60' }),
          sroom('v1', 4, { last_message_id: '70' }),
          sroom('th-joined', 6, { parent_id: 't1', last_message_id: '80', last_read_message_id: '79', thread: thread(true) }),
          sroom('th-out', 6, { parent_id: 't1', last_message_id: '90', last_read_message_id: '1', thread: thread(false) }),
        ],
      },
    });
    setReadState({
      byRoom: {
        t1: { lastReadMessageId: '40', mentionCount: 2 },
        t2: { lastReadMessageId: '60', mentionCount: 0 },
        'th-joined': { lastReadMessageId: '79', mentionCount: 1 },
        'th-out': { lastReadMessageId: '1', mentionCount: 5 },
      },
    });
  });

  test('unread counts text channels and joined threads; voice and unjoined threads never', () => {
    // t1 unread (50 > 40) + th-joined (80 > 79); th-out ignored though unread.
    expect(spaceUnreadCount('s1', null)).toBe(2);
  });

  test('the channel on screen is excluded', () => {
    expect(spaceUnreadCount('s1', 't1')).toBe(1);
  });

  test('mentions sum the server counters of text channels and joined threads', () => {
    expect(spaceMentionCount('s1')).toBe(3);
  });

  test('a channel mirrored into the rooms store adds its mentions once, its unread once', () => {
    setRooms({ rooms: [{ id: 't1', type: 3, space_id: 's1', recipients: [], created_at: '', last_message_id: '50' }] });
    expect(spaceMentionCount('s1')).toBe(3);
    expect(spaceUnreadCount('s1', null)).toBe(2);
  });

  test('loaded messages win over metadata (own messages never unread)', () => {
    setMessages('byRoom', 't1', [message('t1', '41', ME), message('t1', '42', 'x'), message('t1', '43', 'x')]);
    expect(spaceUnreadCount('s1', null)).toBe(3);
  });
});

describe('PM list and the rail under Home', () => {
  beforeEach(() => {
    setRooms({
      rooms: [
        pm('p-old', user('a'), { last_message_id: '10', last_read_message_id: '5' }),
        pm('p-new', user('b', { bot: true }), { last_message_id: '30', last_read_message_id: '30' }),
        group('g1', [user('c'), user('d')], { last_message_id: '20', last_read_message_id: '1', muted: true }),
        pm('notes', null, { last_message_id: '99' }),
        { id: 'chan', type: 3, space_id: 's', recipients: [], created_at: '', last_message_id: '100' },
      ],
    });
    setReadState({ byRoom: { 'p-old': { lastReadMessageId: '5', mentionCount: 0 }, g1: { lastReadMessageId: '1', mentionCount: 0 } } });
  });

  test('newest first, no notes, no space channels', () => {
    expect(pmRoomIds()).toEqual(['p-new', 'g1', 'p-old']);
  });

  test('rail: unread, unmuted, not open', () => {
    expect(railDmRoomIds(null)).toEqual(['p-old']);
    expect(railDmRoomIds('p-old')).toEqual([]);
  });

  test('a PM row: names, bot tag, unread, mute, custom status only while present', () => {
    setPresence('byUser', 'a', { status: 'offline', custom_status: 'away' });
    expect(pmRowView('p-old', null)).toMatchObject({ name: 'User a', unread: 1, muted: false, canMarkRead: true, otherUserId: 'a' });
    expect(pmRowView('p-old', null)?.subtitle).toBeUndefined();
    setPresence('byUser', 'a', { status: 'dnd', custom_status: 'busy' });
    expect(pmRowView('p-old', null)?.subtitle).toBe('busy');
    expect(pmRowView('p-old', 'p-old')).toMatchObject({ unread: 0, canMarkRead: false });
    expect(pmRowView('p-new', null)).toMatchObject({ bot: true, unread: 0 });
    expect(pmRowView('g1', null)).toMatchObject({ isGroup: true, name: 'User c, User d', avatar: null, muted: true, unread: 1 });
  });

  test('mark-as-read target: newest loaded snowflake, else last_message_id', () => {
    expect(latestMessageIdForRoom('p-old')).toBe('10');
    setMessages('byRoom', 'p-old', [message('p-old', '9', 'a'), message('p-old', '12', 'a'), message('p-old', 'temp-1-x', ME)]);
    expect(latestMessageIdForRoom('p-old')).toBe('12');
  });

  test('header facts for a PM, the notes room and a group', () => {
    expect(roomInfo('p-old')).toMatchObject({ kind: 'pm', e2ee: true, otherUserId: 'a', callable: true });
    expect(roomInfo('notes')).toMatchObject({ kind: 'notes', name: 'nav.notes', callable: false });
    expect(roomInfo('g1')).toMatchObject({ kind: 'group', e2ee: true, muted: true, hasMemberList: true });
  });

  test("the official account's PM is one-way: no calls", () => {
    setRooms({ rooms: [pm('p-official', user('o', { system: true }), { last_message_id: '40' })] });
    expect(roomInfo('p-official')).toMatchObject({ kind: 'pm', official: true, callable: false });
  });
});

describe('space room list rows', () => {
  const everyoneDenied = { role_id: 'ev', allow: 0, deny: PermViewChannel, created_at: '', updated_at: '' };
  beforeEach(() => {
    setSpaces({
      spaces: [space('s1', [EVERYONE])],
      spaceRoomsBySpaceId: {
        s1: [
          sroom('sec', 5, { position: 0 }),
          sroom('t1', 3, { parent_id: 'sec', last_message_id: '50', e2ee_enabled: true }),
          sroom('t2', 3, { parent_id: 'sec', last_message_id: '60', permission_overrides: [everyoneDenied] }),
          sroom('t3', 3, { position: 1, muted: true, last_message_id: '70' }),
          sroom('v1', 4, { user_limit: 5 }),
          sroom('th', 6, { parent_id: 't3', last_message_id: '9', thread: { ...thread(true), locked: true } }),
        ],
      },
    });
    setReadState({
      byRoom: {
        t1: { lastReadMessageId: '40', mentionCount: 0 },
        t2: { lastReadMessageId: '60', mentionCount: 0 },
        t3: { lastReadMessageId: '1', mentionCount: 4 },
        th: { lastReadMessageId: '1', mentionCount: 2 },
      },
    });
  });

  test('channel rows: pip, bold, mention pill, mute, lock badges', () => {
    expect(channelRowView('s1', 't1', null)).toMatchObject({ unread: 1, mentions: 0, showUnreadPip: true, bold: true, e2ee: true, isPrivate: false });
    // A member who can still see t2 sees it as private (@everyone denied View).
    expect(channelRowView('s1', 't2', null)).toMatchObject({ isPrivate: true, unread: 0 });
    // Muted suppresses the pip, the bold name and the pill, but the counts stay.
    expect(channelRowView('s1', 't3', null)).toMatchObject({ muted: true, mentions: 4, showUnreadPip: false, bold: false, showMentionBadge: false });
    expect(channelRowView('s1', 't1', 't1')).toMatchObject({ unread: 0, showUnreadPip: false });
  });

  test('voice rows count occupants against the limit', () => {
    setVoice('byRoom', 'v1', [voiceState('v1', 'a', '2026-10-10T10:00:00Z')]);
    expect(channelRowView('s1', 'v1', null)).toMatchObject({ isVoice: true, voiceCount: 1, userLimit: 5, showVoiceCount: true, unread: 0 });
  });

  test('thread rows', () => {
    expect(threadRowView('s1', 'th', null)).toMatchObject({ locked: true, mentions: 2, unread: 1, highlight: true, showMentionBadge: true });
    expect(threadRowView('s1', 'th', 'th')).toMatchObject({ unread: 0, highlight: false, showMentionBadge: false });
  });

  test('the tree hides private rooms from a member without access, never from the owner', () => {
    setSpaceMembers('bySpaceId', 's1', [member(ME, [])]);
    const ids = (items: ReturnType<typeof spaceRoomTree>) => items.map((i) => ('roomId' in i ? i.roomId : `[${i.sectionId}]`));
    expect(ids(spaceRoomTree('s1', null, true))).toEqual(['v1', 't3', 'th', '[sec]', 't1']);
    setSpaces('spaces', 0, 'owner_id', ME);
    expect(ids(spaceRoomTree('s1', null, true))).toEqual(['v1', 't3', 'th', '[sec]', 't1', 't2']);
  });

  test('section facts for the long-press sheet', () => {
    expect(sectionRowView('s1', 'sec', null)).toMatchObject({
      hasUnread: true,
      anyUnmuted: true,
      markReadTargets: [
        { roomId: 't1', messageId: '50' },
        { roomId: 't2', messageId: '60' },
      ],
    });
    expect(sectionRowView('s1', 'sec', 't1')?.hasUnread).toBe(false);
  });

  test('abilities from roles: owner, Administrator-less member', () => {
    const sp = space('s1', [EVERYONE]);
    expect(spaceAbilities(sp, sp.roles, member(ME), ME)).toMatchObject({ isOwner: false, canManageRooms: false, canLeave: true, viewerHighestRolePosition: -1 });
    expect(spaceAbilities({ ...sp, owner_id: ME }, sp.roles, member(ME), ME)).toMatchObject({
      isOwner: true,
      canManageRooms: true,
      canLeave: false,
      viewerHighestRolePosition: Number.MAX_SAFE_INTEGER,
    });
  });
});

describe('member lists and people', () => {
  test('a space channel lists who can see it, grouped by hoisted role', () => {
    const mods = role('mods', 3, 0, { hoist: true, name: 'Mods', color: 0xff0000 });
    setSpaces({
      spaces: [space('s1', [EVERYONE, mods])],
      spaceRoomsBySpaceId: {
        s1: [sroom('t1', 3, { permission_overrides: [{ role_id: 'ev', allow: 0, deny: PermViewChannel, created_at: '', updated_at: '' }, { role_id: 'mods', allow: PermViewChannel, deny: 0, created_at: '', updated_at: '' }] })],
      },
    });
    setSpaceMembers('bySpaceId', 's1', [member('a', ['mods']), member('b', []), member('owner', [])]);
    setPresence({ byUser: { a: { status: 'online', custom_status: 'modding' }, owner: { status: 'idle' } } });
    const items = memberListItems({ spaceId: 's1', roomId: 't1' });
    expect(items.map((i) => (i.kind === 'header' ? `# ${i.label}` : i.userId))).toEqual(['# Mods', 'a', '# presence.online', 'owner']);
    // The whole space when no channel is given.
    expect(memberListItems({ spaceId: 's1' }).filter((i) => i.kind === 'member')).toHaveLength(3);
    expect(memberRowView({ spaceId: 's1' }, 'a')).toMatchObject({ nameColor: '#ff0000', subline: 'modding', online: true, isOwner: false });
    expect(memberRowView({ spaceId: 's1' }, 'owner')).toMatchObject({ isOwner: true, subline: 'presence.idle' });
    expect(memberRowView({ spaceId: 's1' }, 'b')).toMatchObject({ online: false, status: 'offline' });
    expect(memberRowView({ spaceId: 's1' }, 'b')?.subline).toBeUndefined();
  });

  test('a group PM lists its participants with a Members header', () => {
    setRooms({ rooms: [group('g', [user('a')], { creator_id: ME })] });
    const items = memberListItems({ pmRoomId: 'g' });
    expect(items[0]).toMatchObject({ kind: 'header', label: 'room.members.title', count: 2 });
    expect(memberRowView({ pmRoomId: 'g' }, ME)?.isOwner).toBe(true);
  });

  test('who a message author is: space member, else embedded author, else yourself', () => {
    setSpaces({ spaces: [space('s1', [EVERYONE])], spaceRoomsBySpaceId: { s1: [sroom('t1', 3)] } });
    setSpaceMembers('bySpaceId', 's1', [member('a', [], { display_name: 'Alice' })]);
    setMessages('byRoom', 't1', [message('t1', '1', 'ghost', { author: user('ghost', { display_name: 'Gone' }) })]);
    expect(userDisplay('a', { roomId: 't1' }).name).toBe('Alice');
    expect(userDisplay('ghost', { roomId: 't1' }).name).toBe('Gone');
    expect(userDisplay(ME, { roomId: 't1' }).name).toBe('Me');
    expect(userDisplay('nobody', { roomId: 't1' }).name).toBe('common.unknown');
  });

  test('friends tabs', () => {
    setRelationships({
      relationships: [
        { id: 'a', type: RelType.Friend, user: { ...user('a'), presence: { status: 'online' } } },
        { id: 'b', type: RelType.Friend, user: user('b') },
        // Do not disturb is not "online" on the web's Friends tab (isVisibleStatus).
        { id: 'f', type: RelType.Friend, user: { ...user('f'), presence: { status: 'dnd' } } },
        { id: 'c', type: RelType.IncomingRequest, user: user('c') },
        { id: 'd', type: RelType.OutgoingRequest, user: user('d') },
        { id: 'e', type: RelType.Blocked, user: user('e') },
      ],
    });
    expect(friendIds('all')).toEqual(['a', 'b', 'f']);
    expect(friendIds('online')).toEqual(['a']);
    expect(friendIds('pending')).toEqual(['c', 'd']);
    expect(friendIds('blocked')).toEqual(['e']);
  });
});

describe('notifications feed (lib/mobileNotifications through our fixtures)', () => {
  test('PMs by unread or mention, channels only when mentioned; mentions first', () => {
    setRooms({
      rooms: [
        pm('p1', user('a'), { last_message_id: '10', last_read_message_id: '5' }),
        pm('p2', user('b'), { last_message_id: '10', last_read_message_id: '5', muted: true }),
      ],
    });
    setSpaces({
      spaces: [space('s1', [EVERYONE])],
      spaceRoomsBySpaceId: { s1: [sroom('t1', 3, { last_message_id: '50' }), sroom('t2', 3, { last_message_id: '60' })] },
    });
    setReadState({
      byRoom: {
        p1: { lastReadMessageId: '5', mentionCount: 0 },
        t1: { lastReadMessageId: '1', mentionCount: 3 },
        t2: { lastReadMessageId: '1', mentionCount: 0 },
      },
    });
    setRelationships({ relationships: [{ id: 'z', type: RelType.IncomingRequest, user: user('z') }] });
    expect(notificationItems().map((i) => [i.roomId, i.mention, i.count])).toEqual([
      ['t1', true, 3],
      ['p1', false, 1],
    ]);
    expect(notificationBadgeCount()).toBe(5);
  });
});

describe('voice occupants', () => {
  test('in join order, names from the space member list first', () => {
    setSpaceMembers('bySpaceId', 's1', [member('a', [], { display_name: 'Alice', avatar: 'a.png' })]);
    setVoice('byRoom', 'v1', [
      voiceState('v1', 'b', '2026-10-10T10:05:00Z', { self_mute: true, user: { id: 'b', username: 'bob', display_name: 'Bob' } }),
      voiceState('v1', 'a', '2026-10-10T10:00:00Z', { mute: true }),
    ]);
    expect(voiceOccupants('v1', 's1')).toEqual([
      { userId: 'a', name: 'Alice', avatar: 'a.png', selfMute: false, selfDeaf: false, serverMute: true, serverDeaf: false, video: false, streaming: false },
      { userId: 'b', name: 'Bob', selfMute: true, selfDeaf: false, serverMute: false, serverDeaf: false, video: false, streaming: false },
    ]);
  });
});

describe('space profiles: who a person is inside a space', () => {
  const PROFILED = { nick: 'Ally', space_avatar: 'space-a.png' };

  beforeEach(() => {
    setSpaces({ spaces: [space('s1', [EVERYONE])], spaceRoomsBySpaceId: { s1: [sroom('t1', 3)] } });
    setSpaceMembers('bySpaceId', 's1', [
      member('a', [], { display_name: 'Alice', avatar: 'a.png', ...PROFILED }),
      member('b', [], { display_name: 'Bob', avatar: 'b.png' }),
      member(ME, [], { display_name: 'Me', nick: 'Captain', space_avatar: 'space-me.png' }),
    ]);
    setRooms({ rooms: [pm('p1', user('a', { display_name: 'Alice', avatar: 'a.png' }))] });
  });

  test("another member's nickname and space avatar, in their space's rooms", () => {
    expect(userDisplay('a', { roomId: 't1' })).toMatchObject({ name: 'Ally', globalName: 'Alice', nick: 'Ally', avatar: 'space-a.png' });
    expect(userDisplay('b', { roomId: 't1' })).toMatchObject({ name: 'Bob', avatar: 'b.png' });
    expect(userDisplay('b', { roomId: 't1' }).nick).toBeUndefined();
  });

  test('yourself: auth.user overlaid with your own member row', () => {
    expect(userDisplay(ME, { roomId: 't1' })).toMatchObject({ name: 'Captain', globalName: 'Me', avatar: 'space-me.png' });
  });

  test('a PM, or no space at all, shows the global profile', () => {
    expect(userDisplay('a', { roomId: 'p1' })).toMatchObject({ name: 'Alice', avatar: 'a.png' });
    expect(userDisplay('a', { roomId: 'p1' }).nick).toBeUndefined();
    expect(userDisplay(ME, {}).name).toBe('Me');
  });

  test('the profile subject: globalName only when a nickname replaces the name; spaceId in a space', () => {
    expect(profileSubject('a', { spaceId: 's1' })).toMatchObject({ displayName: 'Ally', globalName: 'Alice', avatar: 'space-a.png', spaceId: 's1' });
    const bob = profileSubject('b', { roomId: 't1' });
    expect(bob).toMatchObject({ displayName: 'Bob', spaceId: 's1' });
    expect(bob.globalName).toBeUndefined();
    expect(profileSubject(ME, { roomId: 't1' })).toMatchObject({ displayName: 'Captain', globalName: 'Me', spaceId: 's1' });
    const inPm = profileSubject('a', { roomId: 'p1' });
    expect(inPm).toMatchObject({ displayName: 'Alice', avatar: 'a.png' });
    expect(inPm.spaceId).toBeUndefined();
  });

  test('member rows: the effective name and avatar, the global name beside a nickname', () => {
    expect(memberRowView({ spaceId: 's1' }, 'a')).toMatchObject({ displayName: 'Ally', globalName: 'Alice', username: 'usera', avatar: 'space-a.png' });
    expect(memberRowView({ spaceId: 's1' }, 'b')?.globalName).toBeUndefined();
    expect(memberRowView({ spaceId: 's1' }, ME)).toMatchObject({ displayName: 'Captain', avatar: 'space-me.png' });
    // Members sort by the name they are listed by: Bob as "Aaron" comes first.
    upsertSpaceMember('s1', member('b', [], { display_name: 'Bob', nick: 'Aaron' }));
    const listed = memberListItems({ spaceId: 's1' }).flatMap((i) => (i.kind === 'member' ? [i.userId] : []));
    expect(listed).toEqual(['b', 'a', ME]);
  });

  test('voice occupants and the reply line use the space profile', () => {
    setVoice('byRoom', 'v1', [voiceState('v1', 'a', '2026-10-10T10:00:00Z', { user: { id: 'a', username: 'usera', display_name: 'Alice' } })]);
    expect(voiceOccupants('v1', 's1')[0]).toMatchObject({ name: 'Ally', avatar: 'space-a.png' });
    expect(voiceOccupants('v1', null)[0]).toMatchObject({ name: 'Alice' });
    setMessages('byRoom', 't1', [message('t1', '1', 'a'), message('t1', '2', 'b', { reply_to_id: '1' })]);
    expect(replyReferenceView('t1', '1', undefined)).toMatchObject({ state: 'found', authorName: 'Ally', authorAvatar: 'space-a.png' });
  });

  test('abilities: Change Nickname from @everyone, Manage Nicknames from a role', () => {
    const sp = space('s1', [role('ev', 0, PermViewChannel | PermChangeNickname, { name: '@everyone' }), role('mods', 4, PermManageNicknames)]);
    expect(spaceAbilities(sp, sp.roles, member(ME), ME)).toMatchObject({ canChangeOwnNickname: true, canManageNicknames: false });
    expect(spaceAbilities(sp, sp.roles, member(ME, ['mods']), ME)).toMatchObject({ canChangeOwnNickname: true, canManageNicknames: true });
    const locked = space('s1', [EVERYONE]);
    expect(spaceAbilities(locked, locked.roles, member(ME), ME)).toMatchObject({ canChangeOwnNickname: false, canManageNicknames: false });
    expect(spaceAbilities({ ...locked, owner_id: ME }, locked.roles, member(ME), ME)).toMatchObject({ canChangeOwnNickname: true, canManageNicknames: true });
  });
});

function thread(joined: boolean) {
  return {
    archived: false,
    locked: false,
    private: false,
    invitable: true,
    auto_archive_minutes: 1440,
    owner_id: 'x',
    message_count: 0,
    member_count: 1,
    joined,
  };
}
