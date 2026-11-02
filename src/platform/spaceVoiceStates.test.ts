/**
 * The web's spaces store keeps the voice store in step with a space coming and going: leaving
 * one forgets who was in its rooms, and a space whose room list first arrives after READY (joined
 * or rejoined this session) reads them, since READY only covered the spaces it listed.
 */
import { resetEnv } from './boot.testenv';
import { beforeEach, describe, expect, jest, test } from '@jest/globals';
import type { SpaceRoom } from '@web/api/spaces';

type SpacesStore = typeof import('@web/stores/spaces');
type VoiceMock = { forgetVoiceRooms: jest.Mock<(ids: string[]) => void>; refreshVoiceStates: jest.Mock<(id: string) => Promise<void>> };

function room(id: string, type: number): SpaceRoom {
  return { id, type, name: id, position: 0, created_at: '', updated_at: '' };
}
const ROOMS = [room('text', 3), room('lounge', 4), room('section', 5), room('quiet', 4)];

let store: SpacesStore;
let voice: VoiceMock;

beforeEach(() => {
  resetEnv();
  jest.doMock('@web/services/stargate/client', () => ({
    onStargateEvent: () => () => undefined,
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
  }));
  store = require('@web/stores/spaces') as SpacesStore;
  voice = require('@web/stores/voice') as VoiceMock;
  voice.forgetVoiceRooms.mockClear();
  voice.refreshVoiceStates.mockClear();
  voice.refreshVoiceStates.mockImplementation(async () => undefined);
});

describe('removeSpace', () => {
  test('forgets every room of the space, read before the list goes', () => {
    store.setSpaceRooms('100', ROOMS);
    store.removeSpace('100');
    expect(voice.forgetVoiceRooms).toHaveBeenCalledWith(['text', 'lounge', 'section', 'quiet']);
  });
});

describe('setSpaceRooms', () => {
  test('reads the voice rooms of a space new to this session, and only those', async () => {
    store.setSpaceRooms('100', ROOMS);
    await Promise.resolve();
    await Promise.resolve();
    expect(voice.refreshVoiceStates.mock.calls.map((c) => c[0])).toEqual(['lounge', 'quiet']);
  });

  test('reads them one at a time', async () => {
    let finish!: () => void;
    voice.refreshVoiceStates.mockImplementationOnce(() => new Promise<void>((res) => (finish = res)));
    store.setSpaceRooms('100', ROOMS);
    await Promise.resolve();
    expect(voice.refreshVoiceStates).toHaveBeenCalledTimes(1);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(voice.refreshVoiceStates).toHaveBeenCalledTimes(2);
  });

  test('leaves a space READY delivered alone', async () => {
    store.hydrateSpaceRoomsFromReady({ '100': ROOMS as unknown as unknown[] });
    store.setSpaceRooms('100', ROOMS);
    await Promise.resolve();
    expect(voice.refreshVoiceStates).not.toHaveBeenCalled();
  });

  test('reads a space once, however often its list arrives', async () => {
    store.setSpaceRooms('100', ROOMS);
    await Promise.resolve();
    voice.refreshVoiceStates.mockClear();
    store.setSpaceRooms('100', ROOMS);
    await Promise.resolve();
    expect(voice.refreshVoiceStates).not.toHaveBeenCalled();
  });

  test('counts a rejoin as new', async () => {
    store.setSpaceRooms('100', ROOMS);
    store.removeSpace('100');
    voice.refreshVoiceStates.mockClear();
    store.setSpaceRooms('100', ROOMS);
    await Promise.resolve();
    expect(voice.refreshVoiceStates.mock.calls[0][0]).toBe('lounge');
  });

  test('counts a space an event left an empty list for as new', async () => {
    store.setSpaces('spaceRoomsBySpaceId', '100', []);
    store.setSpaceRooms('100', ROOMS);
    await Promise.resolve();
    expect(voice.refreshVoiceStates.mock.calls[0][0]).toBe('lounge');
  });
});
