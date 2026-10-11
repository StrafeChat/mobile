/**
 * The re-render contract through React: what each hook re-renders on, and - as much the
 * point - what it does not.
 */
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import './testing/webMocks';
import { act, renderHook } from '@testing-library/react-native';
import { produce } from 'solid-js/store';
import { setMessages } from '@web/stores/messages';
import { setReadState } from '@web/stores/readState';
import { setAuth } from '@web/stores/auth';
import { rooms, setRooms } from '@web/stores/rooms';
import { setSpaces } from '@web/stores/spaces';
import { lastSpaceRoom } from '@web/stores/lastSpaceRoom';
import { addTyping } from '@web/stores/typing';
import { startSlowmode } from '@web/stores/slowmode';
import { ME, message, pm, resetStores, role, space, sroom, user } from './testing/fixtures';
import { derivedCount } from './derived';
import { useEntrySnapshot, useMessage, useMessageIds, useMessageList } from './messages';
import { useTypingUserIds } from './typing';
import { usePmRow, useSpaceChannelMirror } from './rooms';
import { useSlowmodeRemaining } from './reactions';

// Fake timers throughout: the shared memos dispose on a timer, and the typing/slowmode stores
// run their own; none of them may outlive the test file.
beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  setRooms({ rooms: [pm('r', user('a'), { last_message_id: '3' })] });
  setMessages('byRoom', 'r', [message('r', '1', 'a'), message('r', '2', 'a'), message('r', '3', ME)]);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

function counted<T>(hook: () => T) {
  const box = { renders: 0 };
  return { box, hook: () => (box.renders++, hook()) };
}

test('a message row re-renders for an in-place reaction, not for a message appended elsewhere', async () => {
  const { box, hook } = counted(() => useMessage('r', '2'));
  const { result } = await renderHook(hook);
  const before = box.renders;

  await act(async () => {
    setMessages('byRoom', 'r', (list) => [...list, message('r', '4', 'a')]);
  });
  expect(box.renders).toBe(before);

  await act(async () => {
    setMessages(
      'byRoom',
      'r',
      produce((list) => {
        list.find((m) => m.id === '2')!.reactions = [{ emoji: '👍', count: 1, me: true }];
      }),
    );
  });
  expect(box.renders).toBe(before + 1);
  expect(result.current?.reactions).toEqual([{ emoji: '👍', count: 1, me: true }]);
  expect(Object.isFrozen(result.current)).toBe(true);

  // A count bump inside the same reaction object (patchReaction mutates it in place).
  await act(async () => {
    setMessages(
      'byRoom',
      'r',
      produce((list) => {
        list.find((m) => m.id === '2')!.reactions![0]!.count = 2;
      }),
    );
  });
  expect(result.current?.reactions?.[0]?.count).toBe(2);
});

test('the id list ignores edits and follows appends', async () => {
  const { box, hook } = counted(() => useMessageIds('r'));
  const { result } = await renderHook(hook);
  const before = box.renders;
  await act(async () => {
    setMessages('byRoom', 'r', 0, 'plaintext', 'edited');
  });
  expect(box.renders).toBe(before);
  await act(async () => {
    setMessages('byRoom', 'r', (list) => [...list, message('r', '4', 'a')]);
  });
  expect(result.current).toEqual(['1', '2', '3', '4']);
});

test('the list structure does not change for a reaction', async () => {
  const entry = { lastReadMessageId: '3', maxMessageIdWhenEntered: '3' };
  const { box, hook } = counted(() => useMessageList('r', entry));
  await renderHook(hook);
  const before = box.renders;
  await act(async () => {
    setMessages('byRoom', 'r', 0, 'reactions', [{ emoji: 'x', count: 1, me: false }]);
  });
  expect(box.renders).toBe(before);
});

test('typing expires on its own, with no store write from the UI', async () => {
  const { result } = await renderHook(() => useTypingUserIds('r'));
  await act(async () => {
    addTyping('r', 'a');
    addTyping('r', ME); // yourself is never listed
  });
  expect(result.current).toEqual(['a']);
  await act(async () => {
    jest.advanceTimersByTime(10_001);
  });
  expect(result.current).toEqual([]);
});

test('slowmode re-renders once per second of countdown', async () => {
  const { box, hook } = counted(() => useSlowmodeRemaining('r'));
  const { result } = await renderHook(hook);
  await act(async () => {
    startSlowmode('r', 3);
  });
  expect(result.current).toBe(3);
  const before = box.renders;
  await act(async () => {
    jest.advanceTimersByTime(1000); // four 250 ms ticks, one second
  });
  expect(result.current).toBe(2);
  expect(box.renders).toBe(before + 1);
});

test('a PM row follows unread and the open room', async () => {
  setReadState('byRoom', 'r', { lastReadMessageId: '1', mentionCount: 0 });
  const { result, rerender } = await renderHook((p: { active: string | null }) => usePmRow('r', p.active), {
    initialProps: { active: null as string | null },
  });
  expect(result.current?.unread).toBe(1);
  await rerender({ active: 'r' });
  expect(result.current?.unread).toBe(0);
});

test('shared memos are released after the last reader unmounts', async () => {
  const start = derivedCount();
  const { unmount } = await renderHook(() => useMessage('r', '1'));
  expect(derivedCount()).toBe(start + 1);
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(derivedCount()).toBe(start);
});

describe('entry snapshot', () => {
  test('frozen on entry: the live cursor advancing does not move it', async () => {
    setReadState('byRoom', 'r', { lastReadMessageId: '1', mentionCount: 0 });
    const { result } = await renderHook(() => useEntrySnapshot('r'));
    expect(result.current).toEqual({ lastReadMessageId: '1', maxMessageIdWhenEntered: '3' });
    await act(async () => {
      setReadState('byRoom', 'r', { lastReadMessageId: '3', mentionCount: 0 });
      setMessages('byRoom', 'r', (list) => [...list, message('r', '4', 'a')]);
    });
    expect(result.current).toEqual({ lastReadMessageId: '1', maxMessageIdWhenEntered: '3' });
  });

  test('waits for hydration before reading the cursor', async () => {
    setAuth('hydrated', false);
    setMessages('byRoom', 'r', []);
    const { result } = await renderHook(() => useEntrySnapshot('r'));
    expect(result.current.lastReadMessageId).toBeNull();
    await act(async () => {
      setReadState('byRoom', 'r', { lastReadMessageId: '2', mentionCount: 0 });
      setAuth('hydrated', true);
    });
    expect(result.current.lastReadMessageId).toBe('2');
    expect(result.current.maxMessageIdWhenEntered).toBeNull();
    await act(async () => {
      setMessages('byRoom', 'r', [message('r', '5', 'a')]);
    });
    expect(result.current.maxMessageIdWhenEntered).toBe('5');
  });

  test('a new room starts a new visit', async () => {
    setRooms('rooms', (list) => [...list, pm('q', user('b'))]);
    setMessages('byRoom', 'q', [message('q', '7', 'b')]);
    setReadState('byRoom', 'q', { lastReadMessageId: '6', mentionCount: 0 });
    const { result, rerender } = await renderHook((p: { id: string }) => useEntrySnapshot(p.id), { initialProps: { id: 'r' } });
    expect(result.current.maxMessageIdWhenEntered).toBe('3');
    await rerender({ id: 'q' });
    expect(result.current).toEqual({ lastReadMessageId: '6', maxMessageIdWhenEntered: '7' });
  });
});

test('the open space channel is mirrored for the send path - once per id/E2EE change, not per message', async () => {
  setSpaces({
    spaces: [space('s1', [role('ev', 0, 0, { name: '@everyone' })])],
    spaceRoomsBySpaceId: { s1: [sroom('c', 3, { last_message_id: '5', last_read_message_id: '4', mention_count: 1 })] },
  });
  await renderHook(() => useSpaceChannelMirror('s1', 'c'));
  const mirror = () => rooms.rooms.find((r) => r.id === 'c');
  expect(mirror()).toMatchObject({ space_id: 's1', type: 3, last_read_message_id: '4', mention_count: 1 });
  expect(mirror()?.e2ee_enabled).toBeUndefined();
  expect(lastSpaceRoom.get('s1')).toBe('c');

  // A new message replaces the space's room object; the mirror is not rewritten for it.
  await act(async () => {
    setSpaces('spaceRoomsBySpaceId', 's1', 0, (r) => ({ ...r, last_message_id: '6' }));
  });
  expect(mirror()?.last_message_id).toBe('5');

  // Turning E2EE on is re-mirrored, so the next send goes out encrypted.
  await act(async () => {
    setSpaces('spaceRoomsBySpaceId', 's1', 0, (r) => ({ ...r, e2ee_enabled: true }));
  });
  expect(mirror()?.e2ee_enabled).toBe(true);
});
