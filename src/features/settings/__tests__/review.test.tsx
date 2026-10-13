/// <reference types="jest" />
/**
 * Regressions from the settings review: the notification permission row following the OS, the
 * consent screen's request running once, the mic test never keeping the microphone after the
 * page, edits surviving a slow load or a save elsewhere on the page, a slow first load never
 * undoing a save, "log out everywhere" saying when it did not happen, a muted channel reading
 * as muted, and the role hierarchy (locked roles read-only, reorders that never touch a role
 * out of reach).
 */
import './settingsTestSetup';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { setSpaces } from '@web/stores/spaces';
import { setRooms } from '@web/stores/rooms';
import { auth } from '@web/stores/auth';
import { confirmDialogState, settleConfirmDialog } from '@web/stores/confirmDialog';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { PermManageRoles, PermSendMessages } from '@web/lib/spacePermissions';
import type { SpaceRole } from '@web/api/spaces';
import { setPushStatus } from '@/platform/push/status';
import { toastStore } from '@/ui/toast';
import { ME, member, resetStores, role, space, sroom } from '../../../data/testing/fixtures';
import { NotificationsScreen } from '../user/NotificationsScreen';
import { OAuthAuthorizeScreen } from '../OAuthAuthorizeScreen';
import { VoiceScreen } from '../user/VoiceScreen';
import { AccountScreen } from '../user/AccountScreen';
import { DeveloperAppScreen } from '../user/developers/DeveloperAppScreen';
import { RoleEditorScreen } from '../space/RoleEditorScreen';
import { RoomNotificationsScreen } from '../room/RoomPagesScreens';
import { canMoveRole, rolePositionPatches } from '../space/roleLogic';

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
    expect(rolePositionPatches([desc[0]!, desc[2]!, desc[1]!])).toEqual([
      { id: 'b', position: 1 },
      { id: 'a', position: 3 },
    ]);
    // Duplicates fall back to the web's 1..N.
    expect(rolePositionPatches([role('x', 1, 0), role('y', 1, 0)])).toEqual([{ id: 'x', position: 2 }]);
    expect(canMoveRole(desc, 1, 'up', 4)).toBe(false);
    expect(canMoveRole(desc, 1, 'down', 4)).toBe(true);
    expect(canMoveRole(desc, 0, 'down', 4)).toBe(false);
    expect(canMoveRole(desc, 2, 'down', 4)).toBe(false);
    expect(canMoveRole(desc, 1, 'up', Number.POSITIVE_INFINITY)).toBe(true);
  });
});
