/**
 * @-completion with space profiles: a member can be found by nickname, display name or username
 * and is shown by their space profile, while what gets inserted - and what serializeDraft turns
 * into a mention - stays the exact `@username`. So a nickname that copies someone else's
 * username never takes their mentions.
 */
import '@/data/testing/webMocks';
import { beforeEach, describe, expect, test } from '@jest/globals';
import { buildMentionCatalog, serializeDraft } from '@web/lib/utils/mentions';
import type { RoomParticipant } from '@web/api/rooms';
import { setSpaces } from '@web/stores/spaces';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { setRooms } from '@web/stores/rooms';
import { member, pm, resetStores, role, sroom, space, user } from '@/data/testing/fixtures';
import { computeCompletion, type CompletionContext, type CompletionPerson } from '../logic/completion';
import { composerContextData } from '../hooks/useComposerContext';

const ctx = (participants: CompletionPerson[]): CompletionContext => ({
  participants,
  roles: [],
  rooms: [],
  canMentionEveryone: false,
  currentUserId: '100',
  customEmojis: [],
  emojiCatalog: null,
  skinTone: 0,
});

const people: CompletionPerson[] = [
  { id: '1', username: 'alice', display_name: 'Alice A', avatar: 'a.png', nick: 'Captain', space_avatar: 'space-a.png' },
  { id: '2', username: 'bob', display_name: 'Bobby' },
  { id: '100', username: 'me', display_name: 'Myself', nick: 'Boss' },
];

describe('matching and labels', () => {
  test('nickname, display name and username prefixes all match', () => {
    expect(computeCompletion('@cap', 4, ctx(people))!.list.map((c) => c.key)).toEqual(['user:1']);
    expect(computeCompletion('@ali', 4, ctx(people))!.list.map((c) => c.key)).toEqual(['user:1']);
    expect(computeCompletion('@alice a', 6, ctx(people))!.list.map((c) => c.key)).toEqual(['user:1']);
    expect(computeCompletion('@bo', 3, ctx(people))!.list.map((c) => c.key)).toEqual(['user:2', 'user:100']);
  });

  test('the row shows the space profile; the insert stays @username', () => {
    const [alice] = computeCompletion('@cap', 4, ctx(people))!.list;
    expect(alice).toMatchObject({ kind: 'user', label: 'Captain', sublabel: '@alice', insertText: '@alice ', avatar: 'space-a.png' });
    const me = computeCompletion('@boss', 5, ctx(people))!.list[0]!;
    expect(me).toMatchObject({ label: 'Boss', insertText: '@me ' });
    expect(computeCompletion('@bob', 4, ctx(people))!.list[0]).toMatchObject({ label: 'Bobby', insertText: '@bob ' });
  });

  test('a blank nickname is no nickname', () => {
    const list = computeCompletion('@', 1, ctx([{ id: '3', username: 'cy', display_name: 'Cy', nick: '  ', space_avatar: '', avatar: 'cy.png' }]))!.list;
    expect(list[0]).toMatchObject({ label: 'Cy', avatar: 'cy.png' });
  });
});

describe('a nickname that copies a username', () => {
  // Alice set her nickname to "bob"; Bob's username is bob.
  const pool: CompletionPerson[] = [
    { id: '1', username: 'alice', display_name: 'Alice', nick: 'bob' },
    { id: '2', username: 'bob', display_name: 'Bobby' },
  ];

  test('@bob still mentions Bob', () => {
    const catalog = buildMentionCatalog({ participants: pool as unknown as RoomParticipant[] });
    expect(serializeDraft('hi @bob', catalog)).toBe('hi <@2>');
    expect(serializeDraft('hi @alice', catalog)).toBe('hi <@1>');
  });

  test('completion lists both, and picking Alice inserts her own username', () => {
    const list = computeCompletion('@bob', 4, ctx(pool))!.list;
    expect(list.map((c) => [c.key, c.label, c.insertText])).toEqual([
      ['user:1', 'bob', '@alice '],
      ['user:2', 'Bobby', '@bob '],
    ]);
  });
});

describe("the composer's people carry their space profile", () => {
  beforeEach(resetStores);

  test('a space channel: the six keys are copied (blank ones dropped)', () => {
    setSpaces({ spaces: [space('s1', [role('ev', 0, 1, { name: '@everyone' })])], spaceRoomsBySpaceId: { s1: [sroom('t1', 3)] } });
    setSpaceMembers('bySpaceId', 's1', [
      member('1', [], { username: 'alice', display_name: 'Alice', nick: 'Captain', space_avatar: 'space-a.png', space_bio: '', space_pronouns: null }),
    ]);
    const data = composerContextData('t1', 's1');
    expect(data.participants).toEqual([{ id: '1', username: 'alice', display_name: 'Alice', nick: 'Captain', space_avatar: 'space-a.png' }]);
    expect(computeCompletion('@cap', 4, ctx(data.participants))!.list[0]).toMatchObject({ label: 'Captain', avatar: 'space-a.png' });
  });

  test('a PM: no space profile', () => {
    setRooms({ rooms: [pm('p1', user('2', { username: 'bob', display_name: 'Bobby' }))] });
    const data = composerContextData('p1', null);
    expect(data.participants.find((p) => p.id === '2')).toEqual({ id: '2', username: 'bob', display_name: 'Bobby' });
  });
});
