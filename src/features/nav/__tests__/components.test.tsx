/**
 * The nav panel end to end over the real stores: rail, Home's PM list, a space's rooms, the
 * tab bar with the Notifications and You panels, long-press menus, and the Friends view.
 */
import './navTestSetup';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { setSpaces } from '@web/stores/spaces';
import { setRooms } from '@web/stores/rooms';
import { readState, setReadState } from '@web/stores/readState';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { relationships, setRelationships, RelType } from '@web/stores/relationships';
import { setInstance } from '@web/stores/instance';
import { setPresence } from '@web/stores/presence';
import { PermSendMessages, PermViewChannel } from '@web/lib/spacePermissions';
import { ME, member, pm, resetStores, role, space, sroom, user } from '@/data/testing/fixtures';
import {
  closeView,
  openNav,
  openRoom,
  setSelectedSpaceId,
  setShellFocused,
  setShellTab,
  setShellWide,
  shell,
} from '@/shell/state';
import { UiProvider, closeActionSheet } from '@/ui';

import * as relApi from '@web/api/relationships';
import * as usersApi from '@web/api/users';
import { NavPanel } from '../NavPanel';
import { FriendsView } from '../friends';
import * as links from '../links';

jest.mock('@web/api/relationships', () => ({
  ...jest.requireActual<object>('@web/api/relationships'),
  putRelationship: jest.fn(async () => undefined),
  removeRelationship: jest.fn(async () => undefined),
}));
jest.mock('@web/api/users', () => ({
  ...jest.requireActual<object>('@web/api/users'),
  patchMe: jest.fn(async () => ({})),
}));
jest.mock('@web/api/spaces', () => ({
  ...jest.requireActual<object>('@web/api/spaces'),
  getSpaceRooms: jest.fn(async () => []),
  listSpaceRoles: jest.fn(async () => []),
}));

const EVERYONE = role('ev', 0, PermViewChannel | PermSendMessages, { name: '@everyone' });

function seed() {
  setRooms({
    rooms: [
      pm('p1', user('a', { display_name: 'Alice' }), { last_message_id: '20', last_read_message_id: '10' }),
      pm('p2', user('b', { display_name: 'Bob' })),
    ],
    loading: false,
    hydrated: true,
  });
  setSpaces({
    spaces: [space('s1', [EVERYONE], { name: 'Garden' })],
    spaceRoomsBySpaceId: {
      s1: [
        sroom('sec', 5, { position: 1, name: 'Text rooms' }),
        sroom('t1', 3, { position: 1, parent_id: 'sec', name: 'general', last_message_id: '50', last_read_message_id: '40' }),
        sroom('v1', 4, { position: 2, parent_id: 'sec', name: 'Lounge' }),
      ],
    },
    loading: false,
    hydrated: true,
  });
  setSpaceMembers({ bySpaceId: { s1: [member(ME)] }, loading: {}, loadedAt: { s1: Date.now() } });
  setReadState({ byRoom: { p1: { lastReadMessageId: '10', mentionCount: 0 }, t1: { lastReadMessageId: '40', mentionCount: 2 } } });
}

// Fake timers: the shared memos dispose on an idle timer, which must not outlive the file.
beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  seed();
  closeView();
  openNav();
  setShellTab('home');
  setSelectedSpaceId(null);
  jest.clearAllMocks();
});

afterEach(async () => {
  await act(async () => closeActionSheet());
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

async function mount() {
  await render(
    <UiProvider>
      <NavPanel />
    </UiProvider>,
  );
}

describe('NavPanel', () => {
  test('Home lists conversations; tapping one opens it on the content side', async () => {
    await mount();
    expect(screen.getByText('Private Messages')).toBeTruthy();
    expect(screen.getByText('Alice')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^Bob/ }));
    const v = shell.view();
    expect(v.kind === 'room' && v.roomId).toBe('p2');
    expect(shell.panel()).toBe('content');
  });

  test('an unread PM shows on the rail; a space selects its room list', async () => {
    await mount();
    // Alice is unread: her avatar is on the rail under Home (and in the list).
    expect(screen.getAllByLabelText(/^Alice/).length).toBeGreaterThanOrEqual(2);
    await fireEvent.press(screen.getByRole('button', { name: /^Garden/ }));
    expect(shell.selectedSpaceId()).toBe('s1');
    expect(screen.getByText('general')).toBeTruthy();
    expect(screen.getByText('Lounge')).toBeTruthy();
    expect(screen.getByText('Text rooms')).toBeTruthy();
    // Selecting a space opens nothing behind your back.
    expect(shell.view().kind).toBe('empty');
  });

  test('a room row shows its mentions and opens; a voice room joins through the voice area', async () => {
    setSelectedSpaceId('s1');
    await mount();
    expect(screen.getByLabelText(/general.*2 mentions/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^general/ }));
    const v = shell.view();
    expect(v.kind === 'room' && v.roomId === 't1' && v.spaceId).toBe('s1');
    await fireEvent.press(screen.getByRole('button', { name: /^Lounge/ }));
    expect(links.joinVoiceFromUi).toHaveBeenCalledWith('v1', { spaceId: 's1' });
  });

  test('collapsing a section hides its rooms and keeps an unread dot', async () => {
    setSelectedSpaceId('s1');
    await mount();
    await fireEvent.press(screen.getByRole('button', { name: 'Text rooms' }));
    expect(screen.queryByText('general')).toBeNull();
    expect(screen.getByRole('button', { name: 'Text rooms, Unread' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Text rooms, Unread' }));
    expect(screen.getByText('general')).toBeTruthy();
  });

  test('long-press on a room opens its menu; Mark as read acks it', async () => {
    setSelectedSpaceId('s1');
    await mount();
    await fireEvent(screen.getByRole('button', { name: /^general/ }), 'longPress');
    expect(screen.getByRole('menuitem', { name: 'Copy room link' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('menuitem', { name: 'Mark as read' }));
    // Action sheet handlers run a frame after the sheet has closed.
    await waitFor(() => expect(readState.byRoom.t1?.lastReadMessageId).toBe('50'));
  });

  test('Notifications tab: tapping a mention opens the room without marking it read', async () => {
    await mount();
    await fireEvent.press(screen.getByRole('tab', { name: /^Notifications/ }));
    expect(screen.getByText('general')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: /^general, 2 mentions/ }));
    const v = shell.view();
    expect(v.kind === 'room' && v.roomId).toBe('t1');
    expect(shell.tab()).toBe('home');
    expect(readState.byRoom.t1?.mentionCount).toBe(2);
  });

  test('Notifications tab: accepting a friend request', async () => {
    setRelationships({ relationships: [{ id: 'z', type: RelType.IncomingRequest, user: user('z', { display_name: 'Zed' }) }], loading: false, hydrated: true });
    await mount();
    await fireEvent.press(screen.getByRole('tab', { name: /^Notifications/ }));
    expect(screen.getByText('Zed')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Accept' }));
    expect(relApi.putRelationship).toHaveBeenCalledWith('z');
    // Even before the gateway says so, the request has become a friend (and left the inbox).
    expect(relationships.relationships).toEqual([expect.objectContaining({ type: RelType.Friend })]);
    expect(screen.queryByText('Zed')).toBeNull();
  });

  test('Notifications tab: a RELATIONSHIP_ADD that lands before the accept response keeps the new friend', async () => {
    const zed = user('z', { display_name: 'Zed' });
    setRelationships({ relationships: [{ id: 'z', type: RelType.IncomingRequest, user: zed }], loading: false, hydrated: true });
    (relApi.putRelationship as jest.Mock).mockImplementationOnce(async () => {
      // The gateway event first (the server publishes before it answers).
      setRelationships('relationships', [{ id: 'z', type: RelType.Friend, user: zed }]);
    });
    await mount();
    await fireEvent.press(screen.getByRole('tab', { name: /^Notifications/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Accept' }));
    expect(relationships.relationships).toEqual([expect.objectContaining({ type: RelType.Friend })]);
  });

  test('You tab: an instance administrator gets the admin dashboard', async () => {
    await mount();
    await fireEvent.press(screen.getByRole('tab', { name: 'You' }));
    expect(screen.queryByRole('button', { name: 'Admin dashboard' })).toBeNull();
    await act(async () => setInstance('instanceAdmin', true));
    await fireEvent.press(screen.getByRole('button', { name: 'Admin dashboard' }));
    // Called bare - not handed the press event, which it would take for the tab to open.
    expect(links.openAdminDashboard).toHaveBeenCalledWith();
    await act(async () => setInstance('instanceAdmin', false));
  });

  test('You tab: status buttons save, shortcuts open Friends', async () => {
    setPresence({ byUser: { [ME]: { status: 'online' } } });
    await mount();
    await fireEvent.press(screen.getByRole('tab', { name: 'You' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Do Not Disturb' }));
    expect(usersApi.patchMe).toHaveBeenCalledWith({ presence: { status: 'dnd' } });
    await fireEvent.press(screen.getByRole('button', { name: 'Friends' }));
    expect(shell.view().kind).toBe('friends');
    expect(shell.tab()).toBe('home');
  });
});

describe('the selected room, on screen or behind the rails', () => {
  // What SwipeShell keeps (it is not mounted here): the shell in front, at phone width.
  beforeEach(() => {
    setShellFocused(true);
  });
  afterEach(async () => {
    await act(async () => {
      setShellFocused(false);
      setShellWide(false);
    });
  });

  const aliceButtons = () => screen.getAllByRole('button', { name: /^Alice/ });
  const aliceRow = () => aliceButtons().find((b) => b.props.accessibilityState?.selected === true);

  test("a PM's unread is hidden while it is on screen, and shows once the rails cover it", async () => {
    openRoom('p1', null);
    await mount();
    // On screen: read as it arrives, so no count, and not on the rail either.
    expect(aliceRow()?.props.accessibilityLabel).toBe('Alice');
    expect(aliceButtons()).toHaveLength(1);
    // Behind the rails its read cursor stands still: what it holds is unread, here and on the rail.
    await act(async () => openNav());
    expect(aliceRow()?.props.accessibilityLabel).toMatch(/^Alice, .+/);
    expect(aliceButtons()).toHaveLength(2);
    // A tablet shows the conversation beside the rails: on screen again.
    await act(async () => setShellWide(true));
    expect(aliceRow()?.props.accessibilityLabel).toBe('Alice');
  });

  test("a collapsed section's dot leaves out only the room on screen", async () => {
    openRoom('t1', 's1');
    await mount();
    await fireEvent.press(screen.getByRole('button', { name: 'Text rooms' }));
    expect(screen.getByRole('button', { name: 'Text rooms' })).toBeTruthy();
    await act(async () => openNav());
    expect(screen.getByRole('button', { name: 'Text rooms, Unread' })).toBeTruthy();
    // Expanded again: the collapse is remembered per device.
    await fireEvent.press(screen.getByRole('button', { name: 'Text rooms, Unread' }));
  });

  test("a thread's mention pill and pip show once the rails cover it", async () => {
    const thread = { archived: false, locked: false, private: false, invitable: true, auto_archive_minutes: 60, owner_id: ME, message_count: 2, member_count: 1, joined: true };
    setSpaces('spaceRoomsBySpaceId', 's1', (list) => [
      ...list,
      sroom('th', 6, { parent_id: 't1', name: 'plans', last_message_id: '70', last_read_message_id: '60', thread }),
    ]);
    setReadState('byRoom', 'th', { lastReadMessageId: '60', mentionCount: 1 });
    openRoom('th', 's1');
    await mount();
    expect(screen.getByRole('button', { name: /^plans/ }).props.accessibilityLabel).toBe('plans');
    await act(async () => openNav());
    expect(screen.getByRole('button', { name: /^plans/ }).props.accessibilityLabel).toMatch(/^plans, 1 mention/);
  });
});

describe('FriendsView', () => {
  beforeEach(() => {
    setRelationships({
      relationships: [
        { id: '1', type: RelType.Friend, user: user('1', { display_name: 'Ann', presence: { status: 'online' } }) },
        { id: '2', type: RelType.Friend, user: user('2', { display_name: 'Ben' }) },
        { id: '3', type: RelType.IncomingRequest, user: user('3', { display_name: 'Cat' }) },
      ],
      loading: false,
      hydrated: true,
    });
  });

  test('All lists friends; Online only the present ones; Pending counts and accepts', async () => {
    await render(
      <UiProvider>
        <FriendsView />
      </UiProvider>,
    );
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(screen.getByText('Ben')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Online' }));
    expect(screen.getByText('Ann')).toBeTruthy();
    expect(screen.queryByText('Ben')).toBeNull();
    await fireEvent.press(screen.getByRole('tab', { name: /Pending \(1\)/ }));
    expect(screen.getByText('Cat')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Accept' }));
    expect(relApi.putRelationship).toHaveBeenCalledWith('3');
  });

  test('a reload keeps the list on screen (no full-page spinner over pull to refresh)', async () => {
    await render(
      <UiProvider>
        <FriendsView />
      </UiProvider>,
    );
    await act(async () => setRelationships('loading', true));
    expect(screen.getByText('Ann')).toBeTruthy();
    await act(async () => setRelationships('loading', false));
  });
});
