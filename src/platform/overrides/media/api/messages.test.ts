/**
 * The search override: an end-to-end encrypted room's search terms never reach the server.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockServerSearch = jest.fn(async (_roomId: string, _params: unknown) => ({ searchable: true, messages: [] }));
const mockRooms: { rooms: { id: string; e2ee_enabled?: boolean }[] } = { rooms: [] };
const mockSpaces: { spaceRoomsBySpaceId: Record<string, { id: string; e2ee_enabled?: boolean }[]> } = { spaceRoomsBySpaceId: {} };

jest.mock('expo-file-system', () => require('../../../media/testing/memoryFileSystem'));
jest.mock('@web/api/client', () => ({ ApiError: class extends Error {}, getApiUrl: () => 'http://instance.test' }));
jest.mock('@web-original/api/messages', () => ({ searchMessages: (roomId: string, params: unknown) => mockServerSearch(roomId, params) }));
jest.mock('@web/stores/rooms', () => ({ rooms: mockRooms }));
jest.mock('@web/stores/spaces', () => ({ spaces: mockSpaces }));
jest.mock('../../../media/attachmentCache', () => ({ seedDecryptedAttachment: jest.fn() }));
jest.mock('../../../media/uploadSeeds', () => ({ takeUploadSeed: jest.fn() }));

// Required after the mocks' state exists (an import would be hoisted above it).
const { searchMessages } = require('./messages') as typeof import('./messages');

describe('searchMessages', () => {
  beforeEach(() => {
    mockServerSearch.mockClear();
    mockRooms.rooms = [];
    mockSpaces.spaceRoomsBySpaceId = {};
  });

  it('answers "not searchable" for an encrypted PM without asking the server', async () => {
    mockRooms.rooms = [{ id: 'pm', e2ee_enabled: true }];
    await expect(searchMessages('pm', { q: 'secret words' })).resolves.toEqual({ searchable: false, messages: [] });
    expect(mockServerSearch).not.toHaveBeenCalled();
  });

  it('does the same for an encrypted space channel', async () => {
    mockSpaces.spaceRoomsBySpaceId = { s1: [{ id: 'c1', e2ee_enabled: true }] };
    await searchMessages('c1', { q: 'secret words' });
    expect(mockServerSearch).not.toHaveBeenCalled();
  });

  it('asks the server for a plain room, or one it does not know', async () => {
    mockSpaces.spaceRoomsBySpaceId = { s1: [{ id: 'c2', e2ee_enabled: false }] };
    await searchMessages('c2', { q: 'hello' });
    await searchMessages('unknown', { q: 'hello' });
    expect(mockServerSearch).toHaveBeenCalledTimes(2);
  });
});
