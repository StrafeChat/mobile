/**
 * Game activity ("Playing X") as the app shows it, over the real web stores: where the line
 * appears and what beats it, that it never shows for someone offline or invisible, that it
 * comes only from the live presence store (never a row's snapshot), that every mobile copy of
 * a presence carries it, and that the payloads which carry none leave it alone.
 */
import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import { emitStargateEvent } from './testing/webMocks';
import i18next from 'i18next';
import en from '@web/i18n/locales/en';
import { addOrUpdateRoom, setRooms } from '@web/stores/rooms';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { initPresenceHandler, presence, setPresence, setUserPresence, type UserPresence } from '@web/stores/presence';
import { RelType, hydrateRelationshipsFromReady } from '@web/stores/relationships';
import type { Relationship } from '@web/api/relationships';
import { ME, group, member, pm, resetStores, user } from './testing/fixtures';
import { activityElapsedLabel, activityFor, dropActivitiesAfterReconnect, plainActivity, pmStatusLine, playingLabel } from './activity';
import { memberRowView } from './members';
import { pmRowView } from './rooms';
import { presenceOf } from './users';
import { selfPresence } from './me';
import { friendLine, friendSubtitle } from '@/features/nav/friendsModel';

const HADES = { type: 'playing' as const, name: 'Hades', started_at: 1_761_000_000_000 };
const playing = (name = 'Hades', started_at = HADES.started_at) => [{ type: 'playing' as const, name, started_at }];

beforeAll(() => {
  // The web's own English strings for the activity keys (webMocks' t() returns bare keys).
  i18next.addResourceBundle('en', 'translation', { activity: en.activity }, true, true);
  initPresenceHandler();
});

beforeEach(resetStores);

describe('what someone is playing', () => {
  test('only from the presence store, only while they are online, idle or dnd', () => {
    for (const status of ['online', 'idle', 'dnd'] as const) {
      setPresence('byUser', 'a', { status, activities: playing() });
      expect(activityFor('a')).toEqual(HADES);
    }
    for (const status of ['offline', 'invisible'] as const) {
      setPresence('byUser', 'a', { status, activities: playing() });
      expect(activityFor('a')).toBeUndefined();
    }
    expect(activityFor('nobody')).toBeUndefined();
    expect(activityFor(null)).toBeUndefined();
  });

  test('is handed out as a plain copy, never the store proxy', () => {
    setPresence('byUser', 'a', { status: 'online', activities: playing() });
    const a = activityFor('a')!;
    setPresence('byUser', 'a', 'activities', 0, 'name', 'Celeste');
    expect(a.name).toBe('Hades');
    expect(plainActivity({ type: 'playing', name: 'X' })).toEqual({ type: 'playing', name: 'X' });
  });

  test('"Playing <name>" keeps the name as it is: no markdown, links or mentions', () => {
    expect(playingLabel('Hades')).toBe('Playing Hades');
    expect(playingLabel('**x** <@1> https://x.example $t(activity.playingGame) {{name}}')).toBe(
      'Playing **x** <@1> https://x.example $t(activity.playingGame) {{name}}',
    );
  });

  test('how long: "for 1 hr 2 min", nothing without a start', () => {
    const now = HADES.started_at + 62 * 60_000;
    expect(activityElapsedLabel(HADES.started_at, now, 'en')).toBe('for 1 hr 2 min');
    expect(activityElapsedLabel(undefined, now, 'en')).toBe('');
  });
});

describe('whitelist copies of a presence carry the activity', () => {
  test('presenceOf (friends, the PM header, the info sheet)', () => {
    setPresence('byUser', 'a', { status: 'online', custom_status: 'hi', activities: playing() });
    expect(presenceOf('a')).toEqual({ status: 'online', custom_status: 'hi', activities: [HADES] });
    setPresence('byUser', 'b', { status: 'idle' });
    expect(presenceOf('b')).toEqual({ status: 'idle' });
    expect(presenceOf('nobody')).toEqual({ status: 'offline' });
  });

  test('our own presence (the You tab)', () => {
    setPresence('byUser', ME, { status: 'dnd', activities: playing('Celeste') });
    expect(selfPresence()).toEqual({ status: 'dnd', activities: [{ ...HADES, name: 'Celeste' }] });
  });
});

describe('payloads without an activity leave it alone', () => {
  test('PRESENCE_UPDATE sets and clears it; a room open, a group or a status-only write does not touch it', () => {
    emitStargateEvent('PRESENCE_UPDATE', { user_id: 'a', presence: { status: 'online', activities: playing() } });
    expect(activityFor('a')).toEqual(HADES);
    // GET /rooms/:id on every room open: participants embed the "others" presence, no activity.
    addOrUpdateRoom(pm('p', user('a', { presence: { status: 'online' } })));
    addOrUpdateRoom(group('g', [user('a', { presence: { status: 'idle' } })]));
    expect(activityFor('a')).toEqual(HADES);
    setUserPresence('a', { status: 'dnd' });
    expect(presence.byUser.a?.status).toBe('dnd');
    expect(activityFor('a')).toEqual(HADES);
    // The game ended: the next PRESENCE_UPDATE has none.
    emitStargateEvent('PRESENCE_UPDATE', { user_id: 'a', presence: { status: 'dnd' } });
    expect(activityFor('a')).toBeUndefined();
  });

  test('our own presence is never seeded from a room participant (the view others get)', () => {
    setPresence('byUser', ME, { status: 'invisible', activities: playing() });
    addOrUpdateRoom(pm('p', user('a')));
    // Our participant entry says offline, as everyone else sees us.
    addOrUpdateRoom({ ...pm('n', null), participants: [user(ME, { presence: { status: 'offline' } })] });
    expect(presence.byUser[ME]).toMatchObject({ status: 'invisible', activities: [HADES] });
  });

  test('a malformed or foreign activity is dropped, not shown', () => {
    emitStargateEvent('PRESENCE_UPDATE', {
      user_id: 'a',
      presence: { status: 'online', activities: [{ type: 'listening', name: 'x' }, { type: 'playing', name: '\u202E\u0007  ' }] },
    });
    expect(activityFor('a')).toBeUndefined();
  });
});

describe('member list rows', () => {
  beforeEach(() => {
    setSpaceMembers('bySpaceId', 's1', [member('a'), member('b'), member('c', [], { presence: { status: 'online', custom_status: 'old' } })]);
  });

  test('"Playing <name>" (name bold) when there is no custom status', () => {
    setPresence('byUser', 'a', { status: 'online', activities: playing() });
    expect(memberRowView({ spaceId: 's1' }, 'a')).toMatchObject({ subline: 'Playing Hades', playing: 'Hades', online: true });
  });

  test('a custom status beats it; no activity, the status label', () => {
    setPresence('byUser', 'a', { status: 'idle', custom_status: 'brb', activities: playing() });
    const row = memberRowView({ spaceId: 's1' }, 'a');
    expect(row?.subline).toBe('brb');
    expect(row?.playing).toBeUndefined();
    setPresence('byUser', 'b', { status: 'dnd' });
    expect(memberRowView({ spaceId: 's1' }, 'b')).toMatchObject({ subline: 'presence.dnd' });
    expect(memberRowView({ spaceId: 's1' }, 'b')?.playing).toBeUndefined();
  });

  test('nothing while offline or invisible', () => {
    for (const status of ['offline', 'invisible'] as const) {
      setPresence('byUser', 'a', { status, activities: playing() });
      const row = memberRowView({ spaceId: 's1' }, 'a');
      expect(row?.subline).toBeUndefined();
      expect(row?.playing).toBeUndefined();
    }
  });

  test("a custom status cleared since the list was fetched does not come back from the row's snapshot", () => {
    setPresence('byUser', 'c', { status: 'online', activities: playing() });
    expect(memberRowView({ spaceId: 's1' }, 'c')).toMatchObject({ subline: 'Playing Hades', playing: 'Hades' });
  });

  test("the row's own embedded presence never supplies a game", () => {
    setSpaceMembers('bySpaceId', 's1', [member('d', [], { presence: { status: 'online', activities: playing() } })]);
    expect(memberRowView({ spaceId: 's1' }, 'd')?.playing).toBeUndefined();
  });

  test("a group PM's participants show it too", () => {
    setRooms({ rooms: [group('g', [user('a')])] });
    setPresence('byUser', 'a', { status: 'online', activities: playing() });
    expect(memberRowView({ pmRoomId: 'g' }, 'a')?.playing).toBe('Hades');
  });
});

describe('PM list rows and the PM header', () => {
  test('a 1:1 shows the game when there is no custom status; a group never', () => {
    setRooms({ rooms: [pm('p', user('a')), group('g', [user('a'), user('b')])] });
    setPresence('byUser', 'a', { status: 'online', activities: playing() });
    expect(pmRowView('p', null)).toMatchObject({ playing: 'Hades' });
    expect(pmRowView('p', null)?.subtitle).toBeUndefined();
    expect(pmRowView('g', null)?.playing).toBeUndefined();
    setPresence('byUser', 'a', 'custom_status', 'busy');
    expect(pmRowView('p', null)).toMatchObject({ subtitle: 'busy' });
    expect(pmRowView('p', null)?.playing).toBeUndefined();
    setPresence('byUser', 'a', { status: 'invisible', custom_status: undefined });
    expect(pmRowView('p', null)?.playing).toBeUndefined();
  });

  test("a cleared custom status does not come back from the participant's snapshot", () => {
    setRooms({ rooms: [pm('p', user('a', { presence: { status: 'online', custom_status: 'old' } }))] });
    setPresence('byUser', 'a', { status: 'online', activities: playing() });
    expect(pmRowView('p', null)).toMatchObject({ playing: 'Hades' });
    expect(pmRowView('p', null)?.subtitle).toBeUndefined();
  });

  test('the header line: custom status, then the game (isolated), then the status', () => {
    const label = (s: string) => `status:${s}`;
    const p = (x: UserPresence) => pmStatusLine(x, label);
    const [fsi, pdi] = [String.fromCodePoint(0x2068), String.fromCodePoint(0x2069)];
    expect(p({ status: 'online', custom_status: 'hi', activities: [HADES] })).toBe('hi');
    // One plain string on screen: the name is a bidi isolate, so a right-to-left one cannot
    // reorder the words around it.
    expect(p({ status: 'idle', activities: [HADES] })).toBe(`Playing ${fsi}Hades${pdi}`);
    expect(p({ status: 'dnd' })).toBe('status:dnd');
    expect(p({ status: 'offline', custom_status: 'hi', activities: [HADES] })).toBe('status:offline');
    expect(p({ status: 'invisible', activities: [HADES] })).toBe('status:invisible');
  });
});

describe('friends rows', () => {
  const rel = (id: string, extra: Partial<Relationship['user']> = {}): Relationship => ({ id, type: RelType.Friend, user: user(id, extra) });

  test('custom status, then the game, then the handle', () => {
    const r = rel('1');
    expect(friendLine(r, { status: 'online', activities: [HADES] }, 'u1')).toEqual({ text: 'Playing Hades', playing: 'Hades' });
    expect(friendLine(r, { status: 'online', custom_status: 'coding', activities: [HADES] }, 'u1')).toEqual({ text: 'coding' });
    expect(friendLine(r, { status: 'online' }, 'u1')).toEqual({ text: 'u1' });
    expect(friendSubtitle(r, { status: 'idle', activities: [HADES] }, 'u1')).toBe('Playing Hades');
  });

  test('hidden while offline or invisible', () => {
    expect(friendLine(rel('1'), { status: 'offline', activities: [HADES] }, 'u1')).toEqual({ text: 'u1' });
    expect(friendLine(rel('1'), { status: 'invisible', activities: [HADES] }, 'u1')).toEqual({ text: 'u1' });
  });

  test("without a store entry the relationship's presence gives the status, never a game", () => {
    const r = rel('1', { presence: { status: 'online', activities: [HADES] } });
    expect(friendLine(r, undefined, 'u1')).toEqual({ text: 'u1' });
    const withCustom = rel('2', { presence: { status: 'online', custom_status: 'old' } });
    expect(friendLine(withCustom, undefined, 'u2')).toEqual({ text: 'old' });
    // A store entry without one: the relationship's stale custom status does not come back.
    expect(friendLine(withCustom, { status: 'online', activities: [HADES] }, 'u2')).toEqual({ text: 'Playing Hades', playing: 'Hades' });
  });
});

describe('after a reconnect', () => {
  test("drops games only a member list vouched for, keeps friends' and our own", () => {
    hydrateRelationshipsFromReady([{ id: 'f', type: RelType.Friend, user: user('f') }]);
    setUserPresence('f', { status: 'online', activities: playing('Celeste') }, { activities: true });
    setUserPresence('co', { status: 'online', activities: playing() }, { activities: true });
    setUserPresence(ME, { status: 'online', activities: playing('Outer Wilds') }, { activities: true });
    dropActivitiesAfterReconnect();
    expect(activityFor('co')).toBeUndefined();
    expect(activityFor('f')?.name).toBe('Celeste');
    expect(presence.byUser[ME]?.activities?.[0]?.name).toBe('Outer Wilds');
    // The status itself stays; only the game goes until a list or PRESENCE_UPDATE brings it back.
    expect(presence.byUser.co?.status).toBe('online');
  });
});
