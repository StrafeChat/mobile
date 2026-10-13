/**
 * The mobile viewport ack: the web's read-cursor rules (web/src/lib/viewportAck.ts) driven by
 * a message list's bottom row and AppState instead of the DOM, and only for the conversation on
 * screen (the real shell state: its room in front, or a thread's screen over it). readState and
 * pendingAck are the real web stores; rooms and messages are Solid stores shaped like the web's,
 * so the effect re-runs on their changes as it does in the app.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createRoot, createSignal } from 'solid-js';
import { reconcile } from 'solid-js/store';
import { AppState } from 'react-native';

type Listener = (state: string) => void;
const appStateListeners: Listener[] = [];
Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true, writable: true });
jest.spyOn(AppState, 'addEventListener').mockImplementation(((_type: string, fn: Listener) => {
  appStateListeners.push(fn);
  return { remove: () => undefined };
}) as never);

const mockAckRoom = jest.fn((_roomId: string, _messageId: string) => Promise.resolve());
const mockKeepalive = jest.fn((_roomId: string, _messageId: string) => undefined);

jest.mock('@web/api/rooms', () => ({
  ackRoom: (r: string, m: string) => mockAckRoom(r, m),
  ackRoomKeepalive: (r: string, m: string) => mockKeepalive(r, m),
}));
jest.mock('@web/services/stargate/client', () => ({ onStargateEvent: () => () => undefined }));
jest.mock('@web/stores/rooms', () => {
  const { createStore } = require('solid-js/store') as typeof import('solid-js/store');
  const [rooms, setRooms] = createStore({ rooms: [] as { id: string; last_message_id?: string; last_read_message_id?: string }[] });
  return { rooms, setRooms };
});
jest.mock('@web/stores/messages', () => {
  const { createStore } = require('solid-js/store') as typeof import('solid-js/store');
  const [messages, setMessages] = createStore({
    byRoom: {} as Record<string, { id: string }[]>,
    loading: {} as Record<string, boolean>,
    hasMoreOlder: {} as Record<string, boolean>,
    hasMoreNewer: {} as Record<string, boolean>,
  });
  return { messages, setMessages };
});

const viewportAck = require('./viewportAck') as typeof import('./viewportAck');
const { createViewportAck } = viewportAck;
const { readState, setReadState } = require('@web/stores/readState') as typeof import('@web/stores/readState');
const { getPendingAck } = require('@web/stores/pendingAck') as typeof import('@web/stores/pendingAck');
const { setRooms } = require('@web/stores/rooms') as unknown as {
  setRooms: (k: 'rooms', v: { id: string; last_message_id?: string; last_read_message_id?: string }[]) => void;
};
const { setMessages } = require('@web/stores/messages') as unknown as {
  setMessages: (...args: unknown[]) => void;
};
const shellState = require('@/shell/state') as typeof import('@/shell/state');
const { claimScreenRoom, closeView, openNav, openRoom, setShellFocused, setShellWide } = shellState;

// Every tracker a test starts is stopped after it, even when an expectation fails midway.
const live: { dispose(): void }[] = [];
function createRoomViewportAck(roomId: string) {
  const ack = viewportAck.createRoomViewportAck(roomId);
  live.push(ack);
  return ack;
}

function setAppState(state: 'active' | 'inactive' | 'background'): void {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true, writable: true });
  for (const fn of appStateListeners) fn(state);
}

function loadRoom(roomId: string, ids: string[], extra: { hasMoreNewer?: boolean } = {}): void {
  setMessages('byRoom', roomId, ids.map((id) => ({ id })));
  setMessages('loading', roomId, false);
  setMessages('hasMoreOlder', roomId, false);
  setMessages('hasMoreNewer', roomId, extra.hasMoreNewer ?? false);
}

/** Room `roomId` open in the shell, the conversation in front, nothing pushed over it. */
function showRoom(roomId: string): void {
  setShellFocused(true);
  setShellWide(false);
  openRoom(roomId, null);
}

beforeEach(() => {
  mockAckRoom.mockClear();
  mockKeepalive.mockClear();
  setAppState('active');
  showRoom('1');
  // Store setters merge; reconcile replaces, so no state leaks between tests.
  setReadState('byRoom', reconcile({}));
  for (const key of ['byRoom', 'loading', 'hasMoreOlder', 'hasMoreNewer']) setMessages(key, reconcile({}));
  setRooms('rooms', [
    { id: '1', last_message_id: '105', last_read_message_id: '100' },
    { id: '2', last_message_id: '205', last_read_message_id: '200' },
  ]);
});

afterEach(() => {
  for (const ack of live.splice(0)) ack.dispose();
  closeView();
});

describe('createRoomViewportAck', () => {
  it('acks the bottom message once it is past the read cursor', () => {
    loadRoom('1', ['100', '101', '105']);
    const ack = createRoomViewportAck('1');
    ack.setBottomVisibleMessageId('101');
    expect(mockAckRoom).toHaveBeenCalledWith('1', '101');
    expect(readState.byRoom['1']?.lastReadMessageId).toBe('101');
    expect(getPendingAck()).toEqual({ roomId: '1', messageId: '101' });

    // Not again for something already read.
    mockAckRoom.mockClear();
    ack.setBottomVisibleMessageId('100');
    expect(mockAckRoom).not.toHaveBeenCalled();
    ack.dispose();
    expect(getPendingAck()).toBeNull();
  });

  it('waits while the app is not in front, then acks on return', () => {
    loadRoom('1', ['100', '101', '105']);
    const ack = createRoomViewportAck('1');
    setAppState('inactive');
    ack.setBottomVisibleMessageId('101');
    expect(mockAckRoom).not.toHaveBeenCalled();
    expect(getPendingAck()).toEqual({ roomId: '1', messageId: '101' });

    setAppState('active');
    expect(mockAckRoom).toHaveBeenCalledWith('1', '101');
    ack.dispose();
  });

  it('flushes a pending position as a keepalive when the app goes to the background', () => {
    loadRoom('1', ['100', '101', '105']);
    const ack = createRoomViewportAck('1');
    setAppState('inactive');
    ack.setBottomVisibleMessageId('101');
    setAppState('background');
    expect(mockKeepalive).toHaveBeenCalledWith('1', '101');
    ack.dispose();
  });

  it('sends no keepalive for what is already acked', () => {
    loadRoom('1', ['100', '101', '105']);
    const ack = createRoomViewportAck('1');
    ack.setBottomVisibleMessageId('101');
    setAppState('background');
    expect(mockKeepalive).not.toHaveBeenCalled();
    ack.dispose();
  });

  it('heals a dangling last_message_id at the live tail, but not inside a jumped-to window', () => {
    // 105 was deleted: the newest loaded is 103 but the room still claims 105.
    loadRoom('1', ['100', '103']);
    const ack = createRoomViewportAck('1');
    ack.setBottomVisibleMessageId('103');
    expect(mockAckRoom).toHaveBeenLastCalledWith('1', '105');
    ack.dispose();

    mockAckRoom.mockClear();
    setReadState('byRoom', reconcile({}));
    loadRoom('1', ['100', '103'], { hasMoreNewer: true });
    const reading = createRoomViewportAck('1');
    reading.setBottomVisibleMessageId('103');
    expect(mockAckRoom).toHaveBeenLastCalledWith('1', '103');
    reading.dispose();
  });

  it('acks a truly empty room straight to its last_message_id once loaded', () => {
    setMessages('loading', '1', true);
    const ack = createRoomViewportAck('1');
    expect(mockAckRoom).not.toHaveBeenCalled();
    loadRoom('1', []);
    expect(mockAckRoom).toHaveBeenCalledWith('1', '105');
    ack.dispose();
  });

  it('clears a stranded mention with a non-advancing ack, only while in front', () => {
    loadRoom('1', ['100']);
    setRooms('rooms', [{ id: '1', last_message_id: '100', last_read_message_id: '100' }]);
    setReadState('byRoom', '1', { lastReadMessageId: '100', mentionCount: 1 });
    setAppState('inactive');
    const ack = createRoomViewportAck('1');
    ack.setBottomVisibleMessageId('100');
    expect(mockAckRoom).not.toHaveBeenCalled();
    setAppState('active');
    expect(mockAckRoom).toHaveBeenCalledWith('1', '100');
    expect(readState.byRoom['1']?.mentionCount).toBe(0);
    ack.dispose();
  });
});

describe('createViewportAck (the web signature)', () => {
  it('forgets the previous room bottom id on a room change', () => {
    loadRoom('1', ['100', '101', '105']);
    loadRoom('2', ['200', '205']);
    const [room, setRoom] = createSignal<string | undefined>('1');
    let set!: (id: string | null) => void;
    const dispose = createRoot((d) => {
      set = createViewportAck(room).setBottomVisibleMessageId;
      return d;
    });
    set('105');
    expect(mockAckRoom).toHaveBeenLastCalledWith('1', '105');
    mockAckRoom.mockClear();
    // Room 1's 105 is "newer" than room 2's cursor; it must not ack room 2.
    showRoom('2');
    setRoom('2');
    expect(mockAckRoom).not.toHaveBeenCalled();
    set('205');
    expect(mockAckRoom).toHaveBeenLastCalledWith('2', '205');
    setRoom(undefined);
    expect(getPendingAck()).toBeNull();
    dispose();
  });
});

describe('only the conversation on screen is read', () => {
  it('acks nothing while the rails are in front, then catches up when the conversation is back', () => {
    loadRoom('1', ['100', '101', '105']);
    const ack = createRoomViewportAck('1');
    // Swiped back to the room list: the list stays mounted and keeps following new messages.
    openNav();
    ack.setBottomVisibleMessageId('105');
    expect(mockAckRoom).not.toHaveBeenCalled();
    expect(readState.byRoom['1']?.lastReadMessageId).toBeUndefined();

    showRoom('1');
    expect(mockAckRoom).toHaveBeenCalledWith('1', '105');
  });

  it('keeps nothing unseen for the background keepalive', () => {
    loadRoom('1', ['100', '101', '105']);
    const ack = createRoomViewportAck('1');
    openNav();
    ack.setBottomVisibleMessageId('105');
    expect(getPendingAck()).toBeNull();
    setAppState('background');
    expect(mockKeepalive).not.toHaveBeenCalled();
  });

  it('does not clear a stranded mention behind the rails', () => {
    loadRoom('1', ['100']);
    setRooms('rooms', [{ id: '1', last_message_id: '100', last_read_message_id: '100' }]);
    setReadState('byRoom', '1', { lastReadMessageId: '100', mentionCount: 1 });
    openNav();
    const ack = createRoomViewportAck('1');
    ack.setBottomVisibleMessageId('100');
    expect(mockAckRoom).not.toHaveBeenCalled();
    expect(readState.byRoom['1']?.mentionCount).toBe(1);
  });

  it('reads the room beside the rails on a tablet, whichever panel is in front', () => {
    loadRoom('1', ['100', '101', '105']);
    const ack = createRoomViewportAck('1');
    setShellWide(true);
    openNav();
    ack.setBottomVisibleMessageId('101');
    expect(mockAckRoom).toHaveBeenCalledWith('1', '101');
  });

  it('a screen over the shell hides its room; a thread on that screen is the one read', () => {
    loadRoom('1', ['100', '101', '105']);
    loadRoom('2', ['200', '205']);
    const channel = createRoomViewportAck('1');
    const thread = createRoomViewportAck('2');
    // The thread's screen is pushed and comes into focus; the shell under it loses it.
    setShellFocused(false);
    const release = claimScreenRoom('2', null);
    channel.setBottomVisibleMessageId('105');
    thread.setBottomVisibleMessageId('205');
    expect(mockAckRoom).toHaveBeenCalledTimes(1);
    expect(mockAckRoom).toHaveBeenCalledWith('2', '205');
    // The channel's off-screen run left the thread's pending position alone.
    expect(getPendingAck()).toEqual({ roomId: '2', messageId: '205' });

    // Back to the shell: the channel is read up to what its list shows.
    release();
    setShellFocused(true);
    expect(mockAckRoom).toHaveBeenLastCalledWith('1', '105');
  });

  it('another screen over the thread hides it too, and a stale release changes nothing', () => {
    loadRoom('2', ['200', '205']);
    const thread = createRoomViewportAck('2');
    setShellFocused(false);
    const releaseFirst = claimScreenRoom('2', null);
    const releaseSecond = claimScreenRoom('2', null);
    // The first claim's late release (its blur after the second's focus) is not current.
    releaseFirst();
    thread.setBottomVisibleMessageId('205');
    expect(mockAckRoom).toHaveBeenCalledWith('2', '205');

    mockAckRoom.mockClear();
    releaseSecond();
    setMessages('byRoom', '2', [{ id: '200' }, { id: '205' }, { id: '206' }]);
    setRooms('rooms', [{ id: '2', last_message_id: '206', last_read_message_id: '205' }]);
    thread.setBottomVisibleMessageId('206');
    expect(mockAckRoom).not.toHaveBeenCalled();
  });
});
