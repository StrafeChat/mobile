import { resetEnv } from './boot.testenv';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { SpaceRoom } from '@web/api/spaces';

type RoomsModule = typeof import('./rooms');
type SpacesStore = typeof import('@web/stores/spaces');
type RoomsStore = typeof import('@web/stores/rooms');
type MessagesMock = {
  messages: { byRoom: Record<string, { id: string }[]> };
  setMessages: (...args: unknown[]) => void;
  enterRoomView: jest.Mock;
  leaveRoomView: jest.Mock;
  loadMessages: jest.Mock;
};
type StargateClient = { subscribe: jest.Mock; unsubscribe: jest.Mock };

const CHANNEL: SpaceRoom = {
  id: '200',
  type: 3,
  name: 'general',
  topic: 'hello',
  position: 1,
  space_id: '100',
  parent_id: '150',
  last_message_id: '210',
  last_read_message_id: '205',
  mention_count: 2,
  e2ee_enabled: true,
  slowmode_seconds: 5,
  permission_overrides: [],
  user_overrides: [],
  federation: { origin_domain: 'other.example', origin_id: '9000' },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
};

let rooms: RoomsModule;
let spacesStore: SpacesStore;
let roomsStore: RoomsStore;
let msgs: MessagesMock;
let gateway: StargateClient;

beforeEach(() => {
  resetEnv();
  jest.doMock('@web/services/stargate/client', () => ({
    onStargateEvent: () => () => undefined,
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  }));
  rooms = require('./rooms') as RoomsModule;
  spacesStore = require('@web/stores/spaces') as SpacesStore;
  roomsStore = require('@web/stores/rooms') as RoomsStore;
  msgs = require('@web/stores/messages') as MessagesMock;
  gateway = require('@web/services/stargate/client') as StargateClient;
});

describe('spaceRoomToRoom', () => {
  test('carries what the send, edit and ack paths read', () => {
    const room = rooms.spaceRoomToRoom(CHANNEL, '100');
    expect(room).toEqual({
      id: '200',
      type: 3,
      name: 'general',
      topic: 'hello',
      position: 1,
      space_id: '100',
      parent_id: '150',
      last_message_id: '210',
      last_read_message_id: '205',
      mention_count: 2,
      e2ee_enabled: true,
      federation: { origin_domain: 'other.example', origin_id: '9000' },
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      recipients: [],
      participants: [],
    });
  });

  test('takes the space id it is given, and copies federation rather than sharing it', () => {
    const room = rooms.spaceRoomToRoom({ ...CHANNEL, space_id: undefined }, '100');
    expect(room.space_id).toBe('100');
    expect(room.federation).not.toBe(CHANNEL.federation);
  });

  test('leaves e2ee_enabled and federation out when the channel has none', () => {
    const { e2ee_enabled: _e, federation: _f, ...plain } = CHANNEL;
    const room = rooms.spaceRoomToRoom(plain, '100');
    expect(room.e2ee_enabled).toBeUndefined();
    expect('federation' in room).toBe(false);
  });
});

describe('enterRoom', () => {
  function seedSpace(channel: Partial<SpaceRoom> = {}): void {
    spacesStore.setSpaceRooms('100', [{ ...CHANNEL, ...channel }]);
  }

  test('registers a containerless view', () => {
    const entry = rooms.enterRoom('200', { spaceId: '100' });
    expect(msgs.enterRoomView).toHaveBeenCalledTimes(1);
    const view = msgs.enterRoomView.mock.calls[0]![1] as { container: () => unknown; programmatic: (f: () => void) => void };
    expect(view.container()).toBeUndefined();
    const run = jest.fn();
    view.programmatic(run);
    expect(run).toHaveBeenCalled();
    entry.leave();
  });

  test('leaves the first page to the screen, but loads a room shown before the session could', () => {
    const auth = require('@web/stores/auth') as typeof import('@web/stores/auth');
    const stargateStore = require('@web/stores/stargate') as typeof import('@web/stores/stargate');
    const entry = rooms.enterRoom('300', { spaceId: null });
    // Entry itself loads nothing (src/data useEnsureRoomHistory does, at entry).
    expect(msgs.loadMessages).not.toHaveBeenCalled();
    // No user at entry (an offline start): once there is one, the room loads.
    auth.setAuthUser({ id: '1', username: 'me', display_name: 'Me' });
    expect(msgs.loadMessages).toHaveBeenCalledWith('300');
    // Still unloaded (that attempt failed offline): the gateway coming up retries.
    msgs.loadMessages.mockClear();
    stargateStore.setStargateReady(true);
    expect(msgs.loadMessages).toHaveBeenCalledWith('300');
    // Loaded: nothing more.
    msgs.loadMessages.mockClear();
    msgs.setMessages('byRoom', '300', [{ id: '301' }]);
    stargateStore.setStargateReady(false);
    stargateStore.setStargateReady(true);
    expect(msgs.loadMessages).not.toHaveBeenCalled();
    entry.leave();
  });

  test('mirrors the channel into the rooms store, and again only when its E2EE flag changes', () => {
    seedSpace();
    const entry = rooms.enterRoom('200', { spaceId: '100' });
    const mirrored = () => roomsStore.rooms.rooms.find((r) => r.id === '200');
    expect(mirrored()?.e2ee_enabled).toBe(true);
    expect(mirrored()?.space_id).toBe('100');

    // Marks the copy, so a re-mirror (which would rewrite it from the channel) shows.
    roomsStore.setRooms('rooms', (list) => list.map((r) => (r.id === '200' ? { ...r, topic: 'local copy' } : r)));
    // A new message replaces the channel object; that must not re-mirror (it would push the
    // entry-time read cursor back over the live ack).
    spacesStore.updateSpaceRoomLastMessage('200', '220');
    expect(mirrored()?.topic).toBe('local copy');
    // Turning E2EE off must reach the send path.
    spacesStore.setSpaceRooms('100', [{ ...CHANNEL, e2ee_enabled: false }]);
    expect(mirrored()?.e2ee_enabled).toBe(false);
    expect(mirrored()?.topic).toBe('hello');
    entry.leave();
  });

  test('finds the space from the loaded channel lists, including lists that arrive later', () => {
    const entry = rooms.enterRoom('200');
    expect(entry.spaceId()).toBeNull();
    expect(roomsStore.rooms.rooms.find((r) => r.id === '200')).toBeUndefined();
    seedSpace();
    expect(entry.spaceId()).toBe('100');
    expect(roomsStore.rooms.rooms.find((r) => r.id === '200')?.space_id).toBe('100');
    entry.leave();
  });

  test('does not mirror voice channels', () => {
    seedSpace({ type: 4 });
    const entry = rooms.enterRoom('200', { spaceId: '100' });
    expect(roomsStore.rooms.rooms.find((r) => r.id === '200')).toBeUndefined();
    entry.leave();
  });

  test('subscribes the space while the gateway is ready, and lets go on leave', () => {
    const stargateStore = require('@web/stores/stargate') as typeof import('@web/stores/stargate');
    seedSpace();
    const entry = rooms.enterRoom('200', { spaceId: '100' });
    expect(gateway.subscribe).not.toHaveBeenCalled();
    stargateStore.setStargateReady(true);
    expect(gateway.subscribe).toHaveBeenCalledWith('100', undefined);
    entry.leave();
    expect(gateway.unsubscribe).toHaveBeenCalledWith('100', undefined);
  });

  test('subscribes a PM by its own id', () => {
    const stargateStore = require('@web/stores/stargate') as typeof import('@web/stores/stargate');
    stargateStore.setStargateReady(true);
    const entry = rooms.enterRoom('300', { spaceId: null });
    expect(gateway.subscribe).toHaveBeenCalledWith('300', undefined);
    entry.leave();
  });

  test('leave shrinks the cache around the reader and remembers the spot', () => {
    const positions = require('@web/lib/scrollPositions') as typeof import('@web/lib/scrollPositions');
    const entry = rooms.enterRoom('300', { spaceId: null });
    expect(rooms.activeRoomId()).toBe('300');
    entry.leave({ anchorId: '305', atBottom: false, top: 12 });
    expect(msgs.leaveRoomView).toHaveBeenCalledWith('300', { anchorId: '305', atBottom: false });
    expect(positions.recallScrollPosition('300')).toEqual({ anchorId: '305', atBottom: false, top: 12 });
    expect(rooms.activeRoomId()).toBeNull();
    // Idempotent.
    entry.leave();
    expect(msgs.leaveRoomView).toHaveBeenCalledTimes(1);
  });

  test('a room entered twice (a screen re-mounting) keeps its view until both leave', () => {
    const a = rooms.enterRoom('300', { spaceId: null });
    const b = rooms.enterRoom('300', { spaceId: null });
    a.leave(null);
    expect(msgs.leaveRoomView).not.toHaveBeenCalled();
    b.leave(null);
    expect(msgs.leaveRoomView).toHaveBeenCalledWith('300', null);
  });
});
