/**
 * The composer's "Replying to" strip names the author by their space profile in a space
 * channel (yours included), and by their global name in a PM.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { beforeEach, expect, test } from '@jest/globals';
import { setRooms } from '@web/stores/rooms';
import { setSpaces } from '@web/stores/spaces';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { setMessages } from '@web/stores/messages';
import { ME, member, message, pm, resetStores, role, sroom, space, user } from '@/data/testing/fixtures';
import { replyTargetView } from '../hooks/useComposerTargets';

beforeEach(() => {
  resetStores();
  setSpaces({ spaces: [space('s1', [role('ev', 0, 1, { name: '@everyone' })])], spaceRoomsBySpaceId: { s1: [sroom('t1', 3)] } });
  setSpaceMembers('bySpaceId', 's1', [member('a', [], { display_name: 'Alice', nick: 'Captain' }), member(ME, [], { nick: 'Boss' })]);
  setRooms({ rooms: [pm('p1', user('a', { display_name: 'Alice' }))] });
});

test('a space channel: the nickname, yours too', () => {
  setMessages('byRoom', 't1', [message('t1', '1', 'a'), message('t1', '2', ME)]);
  expect(replyTargetView('t1', '1')).toMatchObject({ name: 'Captain', loaded: true });
  expect(replyTargetView('t1', '2').name).toBe('Boss');
});

test('a PM: the global name', () => {
  setMessages('byRoom', 'p1', [message('p1', '1', 'a')]);
  expect(replyTargetView('p1', '1').name).toBe('Alice');
});
