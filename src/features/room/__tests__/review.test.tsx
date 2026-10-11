/**
 * Regressions from the room area's review: where notification settings live, who reaches a
 * room's settings, pins that fail to load, a thread started from a message (the chat's
 * request shape), and the frame's lookup of a thread the live list does not hold.
 */
import './roomTestSetup';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { setRooms } from '@web/stores/rooms';
import { setSpaces, spaces } from '@web/stores/spaces';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { setPinnedMessages } from '@web/stores/pinnedMessages';
import { PermManageRoles, PermSendMessages, PermViewChannel } from '@web/lib/spacePermissions';
import { ME, group, member, resetStores, role, space, sroom, user } from '@/data/testing/fixtures';

jest.mock('@web/api/threads', () => ({
  ...jest.requireActual<Record<string, unknown>>('@web/api/threads'),
  getThread: jest.fn(),
  createThread: jest.fn(),
  createThreadFromMessage: jest.fn(),
}));

const { RoomView } = require('../RoomView') as typeof import('../RoomView');
const { PinsScreen } = require('../pins/PinsScreen') as typeof import('../pins/PinsScreen');
const { GroupScreen } = require('../group/GroupScreen') as typeof import('../group/GroupScreen');
const { CreateThreadSheetHost } = require('../threads/CreateThreadSheet') as typeof import('../threads/CreateThreadSheet');
const { openCreateThread, openRoomNotifySheet, closeCreateThread } = require('../presenters') as typeof import('../presenters');
const { fetchThreadOnce } = require('../threads/data') as typeof import('../threads/data');
const settingsArea = require('@/features/settings') as { openRoomSettings: jest.Mock };
const pins = require('@web/stores/pinnedMessages') as { ensureRoomPins: jest.Mock; refreshRoomPins: jest.Mock };
const threadsApi = require('@web/api/threads') as { getThread: jest.Mock; createThreadFromMessage: jest.Mock; DEFAULT_THREAD_AUTO_ARCHIVE: number };
const router = require('expo-router') as { useLocalSearchParams: jest.Mock; router: { push: jest.Mock } };

const EVERYONE = role('ev', 0, PermViewChannel | PermSendMessages, { name: '@everyone' });

function seedSpace(myRoles: string[], extraRoles = [role('mod', 1, PermManageRoles)]) {
  setSpaces({
    spaces: [space('s1', [EVERYONE, ...extraRoles], { name: 'Garden' })],
    spaceRoomsBySpaceId: { s1: [sroom('c', 3, { name: 'general' })] },
    loading: false,
    hydrated: true,
  });
  setSpaceMembers({ bySpaceId: { s1: [member(ME, myRoles)] }, loading: {}, loadedAt: { s1: Date.now() } });
}

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  settingsArea.openRoomSettings.mockClear();
  pins.ensureRoomPins.mockClear();
  pins.refreshRoomPins.mockClear();
  threadsApi.getThread.mockReset();
  threadsApi.createThreadFromMessage.mockReset();
  setPinnedMessages({ byRoom: {}, loaded: {} });
});

afterEach(async () => {
  await act(async () => {
    closeCreateThread();
  });
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
});

describe('notification settings', () => {
  test('open the room settings Notifications page, from anywhere and from group details', async () => {
    openRoomNotifySheet('r1', 's1');
    expect(settingsArea.openRoomSettings).toHaveBeenLastCalledWith('r1', 'notifications');

    setRooms({ rooms: [group('g', [user('a'), user('b')], { name: 'Weekend', creator_id: ME })] });
    router.useLocalSearchParams.mockReturnValue({ roomId: 'g' });
    await render(<GroupScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText('Notification settings'));
    });
    expect(settingsArea.openRoomSettings).toHaveBeenLastCalledWith('g', 'notifications');
  });
});

describe('room settings entry', () => {
  async function openInfo() {
    await render(<RoomView roomId="c" spaceId="s1" mode="shell" />);
    await act(async () => {
      fireEvent.press(screen.getByLabelText(/^general/));
    });
  }

  test('Manage Roles alone reaches a room settings (its permission overrides live there)', async () => {
    seedSpace(['mod']);
    await openInfo();
    await act(async () => {
      fireEvent.press(screen.getByText('Room settings'));
    });
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    expect(settingsArea.openRoomSettings).toHaveBeenCalledWith('c');
  });

  test('without Manage Rooms or Manage Roles there is no entry', async () => {
    seedSpace([]);
    await openInfo();
    expect(screen.queryByText('Room settings')).toBeNull();
  });
});

describe('pins', () => {
  test('a failed read says so and retries instead of spinning forever', async () => {
    setRooms({ rooms: [group('g', [user('a')], { name: 'Weekend' })] });
    router.useLocalSearchParams.mockReturnValue({ roomId: 'g' });
    await render(<PinsScreen />);
    // The store swallows the failure: the read finishes and the room is still not loaded.
    await act(async () => {
      await Promise.resolve();
    });
    expect(pins.ensureRoomPins).toHaveBeenCalledWith('g');
    expect(screen.getByText("Couldn't load the pinned messages.")).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByText('Retry'));
    });
    expect(pins.refreshRoomPins).toHaveBeenCalledWith('g');
    await act(async () => {
      setPinnedMessages('loaded', 'g', true);
    });
    expect(screen.getByText('There are no pinned messages in this conversation yet.')).toBeTruthy();
  });
});

describe('create thread', () => {
  test("takes the chat's starter shape: prefilled name, created from that message", async () => {
    seedSpace([]);
    threadsApi.createThreadFromMessage.mockImplementation(async () => ({
      id: 't9',
      type: 6,
      name: 'Hello there',
      space_id: 's1',
      parent_id: 'c',
      thread: { owner_id: ME },
    }));
    await render(<CreateThreadSheetHost />);
    await act(async () => {
      openCreateThread({ spaceId: 's1', roomId: 'c', starter: { id: 'm1', preview: 'Hello there' } });
    });
    expect(screen.getByText('Create a thread')).toBeTruthy();
    expect(screen.getByDisplayValue('Hello there')).toBeTruthy();
    // A started thread is never private: the option is not offered.
    expect(screen.queryByText('Private thread')).toBeNull();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Create thread' }));
    });
    expect(threadsApi.createThreadFromMessage).toHaveBeenCalledWith('c', 'm1', {
      name: 'Hello there',
      auto_archive_minutes: threadsApi.DEFAULT_THREAD_AUTO_ARCHIVE,
    });
    expect(spaces.spaceRoomsBySpaceId.s1.some((r) => r.id === 't9')).toBe(true);
    expect(router.router.push).toHaveBeenLastCalledWith('/thread/t9?spaceId=s1');
  });
});

describe('a thread the live list does not hold', () => {
  test('loads instead of flashing "not found", then opens once fetched', async () => {
    seedSpace([]);
    let answer: (v: unknown) => void = () => undefined;
    threadsApi.getThread.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    await render(<RoomView roomId="t1" mode="screen" />);
    expect(screen.queryByText('Conversation not found.')).toBeNull();
    await act(async () => {
      answer({ id: 't1', type: 6, name: 'Old plans', space_id: 's1', parent_id: 'c', thread: { archived: true, owner_id: 'x' } });
    });
    expect(screen.getByText('Old plans')).toBeTruthy();
  });

  test('a fetched record is not reused for a later lookup (it would overwrite newer state)', async () => {
    threadsApi.getThread.mockImplementation(async () => ({ id: 't2', type: 6, name: 'v1', space_id: 's1' }));
    await fetchThreadOnce('t2');
    threadsApi.getThread.mockImplementation(async () => ({ id: 't2', type: 6, name: 'v2', space_id: 's1' }));
    const again = await fetchThreadOnce('t2');
    expect(again?.room.name).toBe('v2');
    expect(threadsApi.getThread).toHaveBeenCalledTimes(2);
  });
});
