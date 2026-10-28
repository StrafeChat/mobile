/// <reference types="jest" />
/**
 * Regressions from the settings review: the notification permission row following the OS, the
 * consent screen's request running once, the mic test never keeping the microphone after the
 * page, edits surviving a slow load or a save elsewhere on the page, a slow first load never
 * undoing a save, "log out everywhere" saying when it did not happen, a muted channel reading
 * as muted, and the role hierarchy (locked roles read-only, reorders that never touch a role
 * out of reach, one batched save merged into the roles, roles given by the role alone - to the
 * owner and to members ranked above the viewer too).
 */
import './settingsTestSetup';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { setSpaces, spaces } from '@web/stores/spaces';
import { setRooms } from '@web/stores/rooms';
import { auth } from '@web/stores/auth';
import { confirmDialogState, settleConfirmDialog } from '@web/stores/confirmDialog';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { PermManageRoles, PermSendMessages } from '@web/lib/spacePermissions';
import type { SpaceRole } from '@web/api/spaces';
import { setPushStatus } from '@/platform/push/status';
import { toastStore } from '@/ui/toast';
import { actionSheetStore, isActionItem, runActionItem } from '@/ui';
import { ME, member, resetStores, role, space, sroom } from '../../../data/testing/fixtures';
import { NotificationsScreen } from '../user/NotificationsScreen';
import { OAuthAuthorizeScreen } from '../OAuthAuthorizeScreen';
import { VoiceScreen } from '../user/VoiceScreen';
import { AccountScreen } from '../user/AccountScreen';
import { DeveloperAppScreen } from '../user/developers/DeveloperAppScreen';
import { RoleEditorScreen } from '../space/RoleEditorScreen';
import { SpaceRolesScreen, liveOrder } from '../space/RolesScreen';
import { SpaceMembersScreen } from '../space/MembersScreen';
import { RoomNotificationsScreen } from '../room/RoomPagesScreens';
import { canMoveRole, roleReorder } from '../space/roleLogic';

jest.mock('expo-notifications', () => ({
  ...jest.requireActual('expo-notifications'),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, canAskAgain: true, status: 'undetermined' })),
}));
jest.mock('@/platform/push/registration', () => ({ ensurePushRegistration: jest.fn(async () => undefined) }));
jest.mock('@web/api/developers', () => ({
  ...jest.requireActual('@web/api/developers'),
  getAuthorizeInfo: jest.fn(),
  getApplication: jest.fn(),
  updateApplication: jest.fn(),
}));
jest.mock('@web/api/discover', () => ({
  ...jest.requireActual('@web/api/discover'),
  getBotListing: jest.fn(async () => null),
}));
jest.mock('@web/api/users', () => ({
  ...jest.requireActual('@web/api/users'),
  getMe: jest.fn(),
  patchMe: jest.fn(),
}));

const params = useLocalSearchParams as jest.Mock;
const native = jest.requireMock('../../../platform/overrides/desktop/native') as { nativeNotificationsGranted: jest.Mock };
const media = jest.requireMock('../../../platform/media') as { startVoiceRecording: jest.Mock };
const devApi = jest.requireMock('@web/api/developers') as { getAuthorizeInfo: jest.Mock; getApplication: jest.Mock; updateApplication: jest.Mock };
const usersApi = jest.requireMock('@web/api/users') as { getMe: jest.Mock; patchMe: jest.Mock };
const session = jest.requireMock('../../../platform/session') as { signOut: jest.Mock };

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type FetchCall = { method: string; path: string; body: unknown };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Answer the API's requests (the real api/spaces calls) and record them by path under /spaces;
 * `writes()` leaves out the reads a screen makes for itself on mount (its rooms, its members). */
function answerFetch(reply: (call: FetchCall) => { status: number; body?: unknown }) {
  const calls: FetchCall[] = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const call: FetchCall = {
      method: init?.method ?? 'GET',
      path: url.slice(url.indexOf('/spaces/')),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const { status, body } = reply(call);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body === undefined) throw new SyntaxError('no JSON body');
        return body;
      },
    } as Response;
  }) as typeof fetch;
  return { calls, writes: () => calls.filter((c) => c.method !== 'GET') };
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  params.mockReturnValue({});
  native.nativeNotificationsGranted.mockResolvedValue(false);
});

describe('notifications permission row', () => {
  it('lets a never-asked permission be asked, and follows a grant made while the page is open', async () => {
    const listeners: ((s: string) => void)[] = [];
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, fn: (s: string) => void) => {
      listeners.push(fn);
      return { remove: jest.fn() };
    }) as never);
    await render(<NotificationsScreen />);
    // Undetermined is not "turned off in the phone's settings": the switch stays usable.
    expect(await screen.findByText('Your phone will ask for permission when you turn this on.')).toBeTruthy();
    expect(screen.queryByText("Notifications are turned off for Strafe in this phone's settings.")).toBeNull();

    // The push section's registration asks on arrival; its status moves when the answer is in.
    native.nativeNotificationsGranted.mockResolvedValue(true);
    await act(async () => setPushStatus({ state: 'active', transport: { kind: 'fcm' } }));
    expect(await screen.findByText('Strafe may show notifications on this device.')).toBeTruthy();

    // Turned off in the system settings, then back to the app.
    native.nativeNotificationsGranted.mockResolvedValue(false);
    const notifications = jest.requireMock('expo-notifications') as { getPermissionsAsync: jest.Mock };
    notifications.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
    await act(async () => listeners.forEach((fn) => fn('active')));
    expect(await screen.findByText("Notifications are turned off for Strafe in this phone's settings.")).toBeTruthy();
    await screen.unmount();
    spy.mockRestore();
  });
});

describe('oauth consent', () => {
  it('asks the server once, though expo-router hands back new params every render', async () => {
    params.mockImplementation(() => ({ client_id: 'A1', scope: 'identify' }));
    devApi.getAuthorizeInfo.mockImplementation(async () => ({
      application: { id: 'A1', name: 'Robo', description: '', icon: '', has_bot: false, bot_public: false },
      scopes: ['identify'],
    }));
    await render(<OAuthAuthorizeScreen />);
    expect(await screen.findByText('Authorize Robo')).toBeTruthy();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(devApi.getAuthorizeInfo).toHaveBeenCalledTimes(1);
    await screen.unmount();
  });
});

describe('mic test', () => {
  it('releases a microphone that arrives after the page closed', async () => {
    const pending = deferred<{ levels: () => number[]; cancel: jest.Mock; stop: jest.Mock; elapsedMs: () => number }>();
    media.startVoiceRecording.mockImplementationOnce(() => pending.promise);
    await render(<VoiceScreen />);
    await fireEvent.press(screen.getByTestId('voice-mic-test'));
    await screen.unmount();
    const handle = { levels: () => [], cancel: jest.fn(), stop: jest.fn(), elapsedMs: () => 0 };
    await act(async () => pending.resolve(handle));
    expect(handle.cancel).toHaveBeenCalled();
  });
});

describe('my account', () => {
  it('keeps what was typed while the profile was still loading', async () => {
    const me = deferred<Record<string, unknown>>();
    usersApi.getMe.mockImplementationOnce(() => me.promise);
    await render(<AccountScreen />);
    await fireEvent.changeText(screen.getByTestId('account-display-name'), 'Typed early');
    await act(async () => me.resolve({ id: ME, username: 'me', display_name: 'Server name', bio: '', about_me: '', pronouns: '' }));
    expect(screen.getByDisplayValue('Typed early')).toBeTruthy();
    expect(screen.getByTestId('account-save')).toBeTruthy();
    await screen.unmount();
  });

  it('a slow first load that lands after a save does not bring the old profile back', async () => {
    const me = deferred<Record<string, unknown>>();
    usersApi.getMe.mockImplementationOnce(() => me.promise);
    usersApi.patchMe.mockImplementationOnce(async (input: Record<string, unknown>) => ({ id: ME, username: 'me', bio: '', about_me: '', pronouns: '', ...input }));
    await render(<AccountScreen />);
    await fireEvent.changeText(screen.getByTestId('account-display-name'), 'New name');
    await fireEvent.press(screen.getByTestId('account-save'));
    await waitFor(() => expect(screen.queryByTestId('account-save')).toBeNull());
    expect(auth.user?.display_name).toBe('New name');
    await act(async () => me.resolve({ id: ME, username: 'me', display_name: 'Old name', bio: '', about_me: '', pronouns: '' }));
    expect(screen.getByDisplayValue('New name')).toBeTruthy();
    expect(auth.user?.display_name).toBe('New name');
    await screen.unmount();
  });

  it('"log out everywhere" that the instance did not confirm says so, and can be tried again', async () => {
    usersApi.getMe.mockImplementationOnce(() => new Promise(() => undefined));
    session.signOut.mockRejectedValueOnce(new Error('Network request failed'));
    await render(<AccountScreen />);
    await fireEvent.press(screen.getByTestId('account-log-out-everywhere'));
    await waitFor(() => expect(confirmDialogState.pending).not.toBeNull());
    await act(async () => settleConfirmDialog(true));
    await waitFor(() => expect(toastStore.get()?.message).toBe("Couldn't log out everywhere. Other devices may still be signed in: check your connection and try again."));
    expect(session.signOut).toHaveBeenCalledWith({ everywhere: true });
    expect(toastStore.get()?.tone).toBe('error');
    await waitFor(() => expect(screen.getByTestId('account-log-out-everywhere')).toBeEnabled());
    await screen.unmount();
  });
});

describe('room notifications', () => {
  afterEach(() => params.mockReturnValue({}));
  it('a muted channel reads as muted with its conversation open, and offers Unmute', async () => {
    setSpaces({
      spaces: [space('S', [role('everyone', 0, PermSendMessages, { name: '@everyone' })], { owner_id: ME })],
      spaceRoomsBySpaceId: { S: [sroom('c1', 3, { name: 'general', muted: true })] },
      loading: false,
      hydrated: true,
    });
    setSpaceMembers({ bySpaceId: { S: [member(ME, [])] }, loading: {}, loadedAt: { S: Date.now() } });
    // The open conversation's mirror of the channel in the rooms store, which has no mute fields.
    setRooms('rooms', [{ id: 'c1', type: 3, name: 'general', space_id: 'S', recipients: [], participants: [], created_at: '2026-10-01T00:00:00.000Z' }]);
    params.mockReturnValue({ roomId: 'c1' });
    await render(<RoomNotificationsScreen />);
    expect(await screen.findByTestId('room-unmute')).toBeTruthy();
    expect(screen.queryByTestId('room-mute-1h')).toBeNull();
    await screen.unmount();
  });
});

describe('developer application', () => {
  it('keeps an unsaved rename when the bot is made private', async () => {
    const app = {
      id: 'A1',
      client_id: 'A1',
      owner_id: ME,
      name: 'MyApp',
      description: '',
      icon: '',
      redirect_uris: [],
      has_bot: true,
      bot_public: true,
      bot: { id: 'A1', username: 'robo', display_name: 'Robo', avatar: '', bot: true },
      created_at: '2026-01-01T00:00:00Z',
    };
    params.mockReturnValue({ appId: 'A1' });
    devApi.getApplication.mockResolvedValue(app);
    devApi.updateApplication.mockImplementation(async (_id: string, patch: Record<string, unknown>) => ({ ...app, ...patch }));
    await render(<DeveloperAppScreen />);
    await fireEvent.changeText(await screen.findByDisplayValue('MyApp'), 'Renamed');
    await fireEvent.press(screen.getByText('Public bot'));
    await waitFor(() => expect(devApi.updateApplication).toHaveBeenCalledWith('A1', { bot_public: false }));
    expect(screen.getByDisplayValue('Renamed')).toBeTruthy();
    await screen.unmount();
  });
});

describe('role hierarchy', () => {
  const roles: SpaceRole[] = [
    role('everyone', 0, PermSendMessages, { name: '@everyone' }),
    role('helper', 1, 0, { name: 'Helpers' }),
    role('mod', 2, PermManageRoles, { name: 'Mods' }),
    role('admin', 3, 0, { name: 'Admins' }),
  ];

  beforeEach(() => {
    setSpaces({ spaces: [space('S', roles, { owner_id: 'u9' })], spaceRoomsBySpaceId: { S: [] }, loading: false, hydrated: true });
    setSpaceMembers({ bySpaceId: { S: [member(ME, ['mod']), member('u9')] }, loading: {}, loadedAt: { S: Date.now() } });
  });

  it('shows a role above the viewer read-only, and one below editable', async () => {
    params.mockReturnValue({ spaceId: 'S', roleId: 'admin' });
    await render(<RoleEditorScreen />);
    expect((await screen.findByTestId('role-name')).props.editable).toBe(false);
    expect(screen.getByText('This role is at or above your own highest role.')).toBeTruthy();
    expect(screen.queryByTestId('role-delete')).toBeNull();
    await screen.unmount();

    params.mockReturnValue({ spaceId: 'S', roleId: 'helper' });
    await render(<RoleEditorScreen />);
    expect((await screen.findByTestId('role-name')).props.editable).toBe(true);
    expect(screen.getByTestId('role-delete')).toBeTruthy();
    await screen.unmount();
  });

  it('reorders into the positions the roles already hold, never past a locked one', () => {
    // A deleted role left a gap at 2: renumbering 1..N would move "top" (out of reach) to 3.
    const desc = [role('top', 5, 0), role('b', 3, 0), role('a', 1, 0)];
    expect(roleReorder(desc, [desc[0]!, desc[2]!, desc[1]!], 4).plan.positions).toEqual([
      { id: 'b', position: 1 },
      { id: 'a', position: 3 },
    ]);
    // Ties (an instance from before positions were unique) take consecutive positions instead.
    const tied = [role('x', 1, 0), role('y', 1, 0)];
    expect(roleReorder(tied, tied, Number.POSITIVE_INFINITY).plan.positions).toEqual([{ id: 'x', position: 2 }]);
    expect(canMoveRole(desc, 1, 'up', 4)).toBe(false);
    expect(canMoveRole(desc, 1, 'down', 4)).toBe(true);
    expect(canMoveRole(desc, 0, 'down', 4)).toBe(false);
    expect(canMoveRole(desc, 2, 'down', 4)).toBe(false);
    expect(canMoveRole(desc, 1, 'up', Number.POSITIVE_INFINITY)).toBe(true);
  });

  it("gives a role to the owner and to a member who outranks the viewer (Discord's rule)", async () => {
    setSpaceMembers({ bySpaceId: { S: [member(ME, ['mod']), member('u9'), member('u8', ['admin'])] }, loading: {}, loadedAt: { S: Date.now() } });
    const net = answerFetch(({ method }) => (method === 'PUT' ? { status: 204 } : { status: 500 }));
    params.mockReturnValue({ spaceId: 'S', roleId: 'helper' });
    await render(<RoleEditorScreen />);
    await fireEvent.press(await screen.findByText('Members'));
    await fireEvent.press(await screen.findByText('User u9'));
    await waitFor(() => expect(net.writes()).toHaveLength(1));
    await fireEvent.press(screen.getByText('User u8'));
    await waitFor(() => expect(net.writes()).toHaveLength(2));
    expect(net.writes()).toEqual([
      { method: 'PUT', path: '/spaces/S/members/u9/roles', body: { role_ids: ['helper'] } },
      // Their "admin" (above the viewer) is sent as held; the server keeps it whatever the list says.
      { method: 'PUT', path: '/spaces/S/members/u8/roles', body: { role_ids: ['admin', 'helper'] } },
    ]);
    await screen.unmount();
  });

  it("offers Edit roles on the owner, and locks only the roles at or above the viewer's own", async () => {
    const net = answerFetch(({ method }) => (method === 'PUT' ? { status: 204 } : { status: 500 }));
    params.mockReturnValue({ spaceId: 'S' });
    await render(<SpaceMembersScreen />);
    await fireEvent.press(await screen.findByText('User u9'));
    const editRoles = actionSheetStore.get()?.entries.find((e) => isActionItem(e) && e.key === 'roles');
    expect(editRoles && isActionItem(editRoles) && !editRoles.disabled).toBe(true);
    await act(async () => runActionItem(editRoles as never));
    expect((await screen.findByLabelText('Mods, This role is at or above your own highest role.')).props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByLabelText('Admins, This role is at or above your own highest role.').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByLabelText('Helpers'));
    await fireEvent.press(screen.getByTestId('member-roles-save'));
    await waitFor(() => expect(net.writes()).toEqual([{ method: 'PUT', path: '/spaces/S/members/u9/roles', body: { role_ids: ['helper'] } }]));
    await screen.unmount();
  });

  it("tells a bot's managed role how to let the bot hand out roles", async () => {
    setSpaces({
      spaces: [space('S', [...roles, role('robo', 1, 0, { name: 'Robo', bot_id: 'b1' })], { owner_id: ME })],
      spaceRoomsBySpaceId: { S: [] },
      loading: false,
      hydrated: true,
    });
    params.mockReturnValue({ spaceId: 'S', roleId: 'robo' });
    await render(<RoleEditorScreen />);
    expect(await screen.findByText('A bot can only give out roles below its own. Use Edit order to move it above the roles it should hand out.')).toBeTruthy();
    await screen.unmount();
    params.mockReturnValue({ spaceId: 'S', roleId: 'helper' });
    await render(<RoleEditorScreen />);
    await screen.findByTestId('role-name');
    expect(screen.queryByText(/A bot can only give out roles below its own/)).toBeNull();
    await screen.unmount();
  });
});

describe('edit order against live roles', () => {
  const r = (id: string, position: number) => ({ id, name: id, position, permissions: 0, color: 0, hoist: false, mentionable: false }) as never;
  it('reads each edited role at its live position, drops deleted ones and slots new ones in place', () => {
    // Edited (highest first): helper moved above mod. Meanwhile a role was created at the bottom
    // (everything shifted up one) and "old" was deleted.
    const edited = [r('helper', 2), r('mod', 3), r('old', 1)];
    const live = [r('mod', 4), r('helper', 3), r('v', 2), r('fresh', 1)];
    const out = liveOrder(edited, live) as unknown as { id: string; position: number }[];
    expect(out.map((x) => `${x.id}@${x.position}`)).toEqual(['helper@3', 'mod@4', 'v@2', 'fresh@1']);
  });
});

describe('saving the role order', () => {
  const roles: SpaceRole[] = [
    role('everyone', 0, PermSendMessages, { name: '@everyone' }),
    role('helper', 1, 0, { name: 'Helpers' }),
    role('mod', 2, PermManageRoles, { name: 'Mods' }),
    role('admin', 3, 0, { name: 'Admins' }),
  ];
  const storeRoles = () => spaces.spaces.find((x) => x.id === 'S')?.roles ?? [];
  const position = (id: string) => storeRoles().find((r) => r.id === id)?.position;

  beforeEach(() => {
    // The viewer owns the space, so every custom role moves.
    setSpaces({ spaces: [space('S', roles, { owner_id: ME })], spaceRoomsBySpaceId: { S: [] }, loading: false, hydrated: true });
    setSpaceMembers({ bySpaceId: { S: [member(ME), member('u9', ['helper'])] }, loading: {}, loadedAt: { S: Date.now() } });
    params.mockReturnValue({ spaceId: 'S' });
  });

  async function moveHelpersUpAndSave() {
    await render(<SpaceRolesScreen />);
    await fireEvent.press(await screen.findByTestId('roles-edit-order'));
    await fireEvent.press(screen.getByLabelText('Move Helpers up'));
    await fireEvent.press(screen.getByTestId('roles-save-order'));
  }

  it('sends one PATCH /spaces/:id/roles and merges the answer, never replacing the roles with it', async () => {
    // The answer leaves out "admin" and names a role the store does not have: as the gateway can
    // overtake an HTTP answer, neither may undo the store (admin stays, "ghost" is not added).
    const net = answerFetch(({ method, path }) =>
      method === 'PATCH' && path === '/spaces/S/roles'
        ? { status: 200, body: [roles[0], { ...roles[1], position: 2 }, { ...roles[2], position: 1 }, role('ghost', 7, 0)] }
        : { status: 500 },
    );
    await moveHelpersUpAndSave();
    await waitFor(() => expect(position('helper')).toBe(2));
    expect(net.writes()).toEqual([
      {
        method: 'PATCH',
        path: '/spaces/S/roles',
        body: [
          { id: 'mod', position: 1 },
          { id: 'helper', position: 2 },
        ],
      },
    ]);
    expect(position('mod')).toBe(1);
    expect(storeRoles().map((r) => r.id).sort()).toEqual(['admin', 'everyone', 'helper', 'mod']);
    expect(screen.queryByTestId('roles-save-order')).toBeNull();
    await screen.unmount();
  });

  it('keeps a role the answer has an older copy of', async () => {
    const at = '2026-10-28T12:00:00.000Z';
    setSpaces({
      spaces: [space('S', roles.map((r) => (r.id === 'mod' ? { ...r, updated_at: at } : r)), { owner_id: ME })],
      spaceRoomsBySpaceId: { S: [] },
      loading: false,
      hydrated: true,
    });
    answerFetch(() => ({
      status: 200,
      body: [{ ...roles[1], position: 2 }, { ...roles[2], position: 1, updated_at: '2026-10-28T11:00:00.000Z' }],
    }));
    await moveHelpersUpAndSave();
    await waitFor(() => expect(position('helper')).toBe(2));
    expect(position('mod')).toBe(2);
    await screen.unmount();
  });

  it('falls back to one PATCH per role, in order, on an instance without the batch endpoint', async () => {
    const net = answerFetch(({ path, body }) => {
      if (path === '/spaces/S/roles') return { status: 404 };
      const r = roles.find((x) => x.id === path.split('/').pop());
      return r ? { status: 200, body: { ...r, position: (body as { position: number }).position } } : { status: 500 };
    });
    await moveHelpersUpAndSave();
    await waitFor(() => expect(position('admin')).toBe(3));
    expect(net.writes().map((c) => `${c.method} ${c.path} ${JSON.stringify(c.body)}`)).toEqual([
      'PATCH /spaces/S/roles [{"id":"mod","position":1},{"id":"helper","position":2}]',
      'PATCH /spaces/S/roles/mod {"position":1}',
      'PATCH /spaces/S/roles/helper {"position":2}',
      'PATCH /spaces/S/roles/admin {"position":3}',
    ]);
    expect([position('mod'), position('helper')]).toEqual([1, 2]);
    await screen.unmount();
  });

  it("does not fall back on the endpoint's own refusals, and words a hierarchy refusal for the role", async () => {
    // A role deleted while editing: the server's real answer is 400 "unknown role id".
    let net = answerFetch(() => ({ status: 400, body: { error: 'unknown role id' } }));
    await moveHelpersUpAndSave();
    expect(await screen.findByText('That role no longer exists.')).toBeTruthy();
    expect(net.writes()).toHaveLength(1);
    await screen.unmount();

    // The endpoint's own 404 (the space is gone) is not an older instance either.
    net = answerFetch(() => ({ status: 404, body: { error: 'space not found' } }));
    await moveHelpersUpAndSave();
    await waitFor(() => expect(net.writes()).toHaveLength(1));
    await screen.unmount();

    answerFetch(() => ({ status: 403, body: { error: 'cannot manage a role or member at or above your own highest role' } }));
    await moveHelpersUpAndSave();
    expect(await screen.findByText(/^That role is at or above your highest role/)).toBeTruthy();
    expect(position('helper')).toBe(1);
    await screen.unmount();
  });
});
