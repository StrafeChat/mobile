/**
 * Mentions in a space where nicknames copy usernames, through the composer's own path: the
 * member store -> useComposerContext (people with their space profiles, and the MentionCatalog)
 * -> serializeDraft on send and wireText on edit. A mention is the exact `@username` and
 * nothing else: a nickname (or a display name) only helps find someone in the suggestions, so
 * nobody can take another person's mentions by naming themself after them.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import { serializeDraft } from '@web/lib/utils/mentions';
import { setSpaces } from '@web/stores/spaces';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { ME, member, resetStores, role, space, sroom } from '@/data/testing/fixtures';
import { useComposerContext } from '../hooks/useComposerContext';
import { computeCompletion, type CompletionContext } from '../logic/completion';
import { readableToWire, wireToReadable } from '../logic/wireText';

beforeEach(() => {
  // The shared memos the hook reads are disposed on a timer after unmount; run it here.
  jest.useFakeTimers();
  resetStores();
  setSpaces({ spaces: [space('s1', [role('ev', 0, 1 | 2, { name: '@everyone' })])], spaceRoomsBySpaceId: { s1: [sroom('t1', 3)] } });
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

/** Alice's nickname is "bob", Carol's display name is "bob", and Bob's username is bob. */
function seed(opts: { withBob?: boolean } = {}) {
  setSpaceMembers('bySpaceId', 's1', [
    member(ME, [], { username: 'me', display_name: 'Me' }),
    member('1', [], { username: 'alice', display_name: 'Alice', nick: 'bob' }),
    member('3', [], { username: 'carol', display_name: 'bob' }),
    ...(opts.withBob === false ? [] : [member('2', [], { username: 'bob', display_name: 'Bobby' })]),
  ]);
}

/** The composer's reference data for the space channel, as the composer computes it. */
async function composer() {
  const { result, unmount } = await renderHook(() => useComposerContext('t1', 's1'));
  const ctx = result.current;
  await unmount();
  return ctx;
}

describe('a nickname that copies a username never takes its mentions', () => {
  test('sending "@bob" mentions Bob, by his username', async () => {
    seed();
    const ctx = await composer();
    // The composer does have Alice's nickname (the suggestions use it)...
    expect(ctx.participants.find((p) => p.id === '1')).toMatchObject({ nick: 'bob' });
    // ...but serialising matches the username only.
    expect(serializeDraft('hi @bob', ctx.catalog)).toBe('hi <@2>');
    expect(serializeDraft('hi @alice and @carol', ctx.catalog)).toBe('hi <@1> and <@3>');
  });

  test('without Bob in the room "@bob" stays text: never Alice by her nickname, nor Carol by her name', async () => {
    seed({ withBob: false });
    const ctx = await composer();
    expect(serializeDraft('hi @bob', ctx.catalog)).toBe('hi @bob');
  });

  test('editing reads mentions back as @username, and saves them unchanged', async () => {
    seed();
    const ctx = await composer();
    expect(wireToReadable('<@1> and <@2>', ctx.catalog)).toBe('@alice and @bob');
    expect(readableToWire(wireToReadable('<@1> and <@2>', ctx.catalog), ctx.catalog)).toBe('<@1> and <@2>');
  });

  test('typing "@bob" suggests all three; picking Alice inserts her own username', async () => {
    seed();
    const ctx = await composer();
    const completion: CompletionContext = {
      participants: ctx.participants,
      roles: [],
      rooms: [],
      canMentionEveryone: false,
      currentUserId: ME,
      customEmojis: [],
      emojiCatalog: null,
      skinTone: 0,
    };
    const list = computeCompletion('@bob', 4, completion)!.list;
    const byId = Object.fromEntries(list.map((c) => [c.key, c.insertText]));
    expect(byId).toEqual({ 'user:1': '@alice ', 'user:2': '@bob ', 'user:3': '@carol ' });
    expect(serializeDraft(`hi ${byId['user:1']}`, ctx.catalog)).toBe('hi <@1> ');
  });
});
