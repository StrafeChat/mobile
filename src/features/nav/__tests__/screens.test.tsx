/**
 * The nav's screens and sheets against mocked APIs: create / join a space, an invite's preview
 * and Join (federated codes included), Discover's join that lands on the LOCAL id, the invite
 * sheet's once-per-open link, and the create-room request.
 */
import './navTestSetup';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { refreshSpaceRooms, setSpaces, spaces } from '@web/stores/spaces';
import { PermSendMessages, PermViewChannel } from '@web/lib/spacePermissions';
import { resetStores, role, space, sroom } from '@/data/testing/fixtures';
import { closeView, setSelectedSpaceId, shell } from '@/shell/state';
import { UiProvider } from '@/ui';

import * as spacesApi from '@web/api/spaces';
import * as discoverApi from '@web/api/discover';
import { CreateSpaceScreen } from '../create/CreateSpaceScreen';
import { InviteScreen } from '../invite/InviteScreen';
import { DiscoverScreen } from '../discover/DiscoverScreen';
import { NavSheets } from '../sheets/NavSheets';
import { closeNavSheet, navSheetStore, openCreateRoomSheet, openInviteSheet } from '../sheets/store';

jest.mock('@web/api/spaces', () => ({
  ...jest.requireActual<object>('@web/api/spaces'),
  createSpace: jest.fn(async () => ({ id: 'new1', name: 'New' })),
  getInvitePreview: jest.fn(async () => ({ space: { id: 'o1', name: 'Faraway', description: 'Far' }, inviter: { display_name: 'Kim' } })),
  joinSpaceByInvite: jest.fn(async () => ({ id: 'local9', name: 'Faraway' })),
  createSpaceInvite: jest.fn(async () => ({ code: 'Abc123' })),
  createSpaceRoom: jest.fn(async () => ({ id: 'r9' })),
  getSpace: jest.fn(async (id: string) => ({ id, name: 'Joined' })),
  getSpaceRooms: jest.fn(async () => []),
}));
jest.mock('@web/api/discover', () => ({
  ...jest.requireActual<object>('@web/api/discover'),
  listDiscoverSpaces: jest.fn(async () => [
    {
      kind: 'space',
      id: 'x',
      status: 'approved',
      tagline: 'Retro games',
      tags: ['games'],
      requested_at: '',
      space: { id: 'o5', origin_domain: 'b.example', name: 'Arcade', name_acronym: 'A', member_count: 9, online_count: 2 },
    },
  ]),
  listDiscoverBots: jest.fn(async () => []),
  joinDiscoverSpace: jest.fn(async () => ({ id: 'local5', name: 'Arcade' })),
}));
jest.mock('@web/stores/spaces', () => {
  const actual = jest.requireActual<typeof import('@web/stores/spaces')>('@web/stores/spaces');
  return { ...actual, refreshSpaceRooms: jest.fn(async () => undefined) };
});

const EVERYONE = role('ev', 0, PermViewChannel | PermSendMessages, { name: '@everyone' });

async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}

// Fake timers: the shared memos dispose on an idle timer, which must not outlive the file.
beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  closeView();
  setSelectedSpaceId(null);
  jest.clearAllMocks();
});

afterEach(async () => {
  await act(async () => closeNavSheet());
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

describe('create / join a space', () => {
  test('creating stores the space and shows its rooms', async () => {
    await render(<CreateSpaceScreen />);
    await fireEvent.changeText(screen.getByLabelText(/^Name/), '  My Space ');
    await fireEvent.press(screen.getByRole('button', { name: 'Create space' }));
    await settle();
    expect(spacesApi.createSpace).toHaveBeenCalledWith({ name: 'My Space', description: undefined });
    expect(spaces.spaces.some((s) => s.id === 'new1')).toBe(true);
    expect(shell.selectedSpaceId()).toBe('new1');
    expect(shell.panel()).toBe('nav');
  });

  test('joining refuses garbage and opens a foreign link as code@domain', async () => {
    await render(<CreateSpaceScreen initialMode="join" />);
    const field = screen.getByLabelText(/Have an invite/);
    await fireEvent.changeText(field, 'not an invite!');
    await fireEvent.press(screen.getByRole('button', { name: 'Join with invite' }));
    expect(screen.getByText("That doesn't look like an invite link or code.")).toBeTruthy();
    await fireEvent.changeText(field, 'https://b.example/invite/Zz9');
    await fireEvent.press(screen.getByRole('button', { name: 'Join with invite' }));
    expect(router.replace).toHaveBeenCalledWith(`/invite/${encodeURIComponent('Zz9@b.example')}`);
  });
});

describe('invite screen', () => {
  test('previews and joins through this instance, then opens the local space', async () => {
    await render(<InviteScreen code="Zz9@b.example" />);
    await settle();
    expect(spacesApi.getInvitePreview).toHaveBeenCalledWith('Zz9@b.example');
    expect(screen.getByText('Faraway')).toBeTruthy();
    expect(screen.getByText('Invited by Kim')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Join Faraway' }));
    await settle();
    expect(spacesApi.joinSpaceByInvite).toHaveBeenCalledWith('Zz9@b.example');
    expect(shell.selectedSpaceId()).toBe('local9');
  });

  test('already in our mirror of it: Open space', async () => {
    setSpaces({
      spaces: [space('local9', [EVERYONE], { federation: { origin_domain: 'b.example', origin_id: 'o1' } })],
      spaceRoomsBySpaceId: {},
      loading: false,
      hydrated: true,
    });
    await render(<InviteScreen code="Zz9@b.example" />);
    await settle();
    expect(screen.getByText("You're already a member of this space.")).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open space' }));
    expect(shell.selectedSpaceId()).toBe('local9');
  });

  test('a dead code says so', async () => {
    (spacesApi.getInvitePreview as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('not found');
    });
    await render(<InviteScreen code="nope" />);
    await settle();
    expect(screen.getByText('Invalid or expired invite')).toBeTruthy();
  });

  test('opened on its own (a cold-start link, no shell beneath), Go home still leaves it', async () => {
    (router.canDismiss as jest.Mock).mockReturnValue(false);
    (spacesApi.getInvitePreview as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('not found');
    });
    await render(<InviteScreen code="nope" />);
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: 'Go home' }));
    expect(router.replace).toHaveBeenLastCalledWith('/');
  });

  test('opened on its own, joining lands on the shell with the space selected', async () => {
    (router.canDismiss as jest.Mock).mockReturnValue(false);
    await render(<InviteScreen code="Zz9@b.example" />);
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: 'Join Faraway' }));
    await settle();
    expect(shell.selectedSpaceId()).toBe('local9');
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  test('with the shell beneath, it is dismissed back to it', async () => {
    (router.canDismiss as jest.Mock).mockReturnValue(true);
    await render(<InviteScreen code="Zz9@b.example" />);
    await settle();
    await fireEvent.press(screen.getByRole('button', { name: 'Join Faraway' }));
    await settle();
    expect(router.dismissAll).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    (router.canDismiss as jest.Mock).mockReturnValue(false);
  });
});

describe('discover', () => {
  test('joining a federated listing posts id@origin and opens the local id', async () => {
    await render(<DiscoverScreen />);
    await settle();
    expect(screen.getByText('Arcade')).toBeTruthy();
    expect(screen.getByText('b.example')).toBeTruthy();
    // A remote listing never reads as already joined, whatever its id.
    await fireEvent.press(screen.getByRole('button', { name: 'Join Arcade' }));
    await settle();
    expect(discoverApi.joinDiscoverSpace).toHaveBeenCalledWith('o5', 'b.example');
    expect(spacesApi.getSpace).toHaveBeenCalledWith('local5');
    expect(shell.selectedSpaceId()).toBe('local5');
  });
});

describe('sheets', () => {
  test('the invite sheet creates one link per open and shows it', async () => {
    Object.defineProperty(window, 'location', { configurable: true, value: { origin: 'https://chat.example' } });
    await render(
      <UiProvider>
        <NavSheets />
      </UiProvider>,
    );
    await act(async () => openInviteSheet('s1'));
    await settle();
    expect(spacesApi.createSpaceInvite).toHaveBeenCalledTimes(1);
    expect(screen.getByText('https://chat.example/invite/Abc123')).toBeTruthy();
  });

  test('creating a voice room under the section it was opened from', async () => {
    setSpaces({
      spaces: [space('s1', [EVERYONE])],
      spaceRoomsBySpaceId: { s1: [sroom('secA', 5, { name: 'Text rooms' }), sroom('secB', 5, { name: 'Hangouts', position: 1 })] },
      loading: false,
      hydrated: true,
    });
    await render(
      <UiProvider>
        <NavSheets />
      </UiProvider>,
    );
    await act(async () => openCreateRoomSheet('s1', 'secB'));
    await fireEvent.press(screen.getByRole('tab', { name: 'Voice' }));
    await fireEvent.changeText(screen.getByLabelText(/^Room name/), 'Lounge');
    await fireEvent.press(screen.getByRole('button', { name: 'Create room' }));
    await settle();
    expect(spacesApi.createSpaceRoom).toHaveBeenCalledWith('s1', { name: 'Lounge', type: 4, parent_id: 'secB' });
  });

  test('a room that was created is not reported as failed when the list refresh after it fails', async () => {
    setSpaces({ spaces: [space('s1', [EVERYONE])], spaceRoomsBySpaceId: { s1: [] }, loading: false, hydrated: true });
    (refreshSpaceRooms as jest.Mock).mockImplementationOnce(async () => {
      throw new Error('offline');
    });
    await render(
      <UiProvider>
        <NavSheets />
      </UiProvider>,
    );
    await act(async () => openCreateRoomSheet('s1'));
    await fireEvent.changeText(screen.getByLabelText(/^Room name/), 'news');
    await fireEvent.press(screen.getByRole('button', { name: 'Create room' }));
    await settle();
    expect(spacesApi.createSpaceRoom).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Failed to create room')).toBeNull();
    expect(navSheetStore.get()).toBeNull();
  });
});
