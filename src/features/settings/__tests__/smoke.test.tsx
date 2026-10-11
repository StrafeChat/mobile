/// <reference types="jest" />
/**
 * Every settings screen renders against seeded stores and stubbed APIs: a space the viewer
 * owns (roles, rooms - a section with a synced channel - and members), an instance admin, and
 * the server answers each page asks for when it opens. Catches wiring mistakes (a hook used
 * outside a screen, a missing gate, a store field read wrongly) that the logic tests cannot.
 */
import './settingsTestSetup';
import type { ReactElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { setSpaces } from '@web/stores/spaces';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { PermManageRoles, PermSendMessages } from '@web/lib/spacePermissions';
import { ME, member, resetStores, role, space, sroom } from '../../../data/testing/fixtures';
import { SecurityScreen } from '../user/SecurityScreen';
import { DevicesScreen } from '../user/DevicesScreen';
import { AuthorizedAppsScreen } from '../user/AuthorizedAppsScreen';
import { AppearanceScreen } from '../user/AppearanceScreen';
import { ThemeEditorScreen } from '../user/ThemeEditorScreen';
import { AccessibilityScreen } from '../user/AccessibilityScreen';
import { VoiceScreen } from '../user/VoiceScreen';
import { BehaviourScreen } from '../user/BehaviourScreen';
import { LanguageScreen } from '../user/LanguageScreen';
import { PrivacyScreen } from '../user/PrivacyScreen';
import { InstanceScreen } from '../user/InstanceScreen';
import { DevelopersScreen } from '../user/developers/DevelopersScreen';
import { DeveloperAppScreen } from '../user/developers/DeveloperAppScreen';
import { OAuthAuthorizeScreen } from '../OAuthAuthorizeScreen';
import { SpaceSettingsHomeScreen } from '../space/SpaceSettingsHomeScreen';
import { SpaceOverviewScreen } from '../space/OverviewScreen';
import { SpaceSystemScreen } from '../space/SystemScreen';
import { SpaceDiscoverScreen } from '../space/DiscoverScreen';
import { SpaceRolesScreen } from '../space/RolesScreen';
import { RoleEditorScreen } from '../space/RoleEditorScreen';
import { SpaceEmojisScreen } from '../space/EmojisScreen';
import { SpaceModerationScreen } from '../space/ModerationScreen';
import { SpaceMembersScreen } from '../space/MembersScreen';
import { SpaceInvitesScreen } from '../space/InvitesScreen';
import { SpaceBansScreen } from '../space/BansScreen';
import { SpaceAuditLogScreen } from '../space/AuditLogScreen';
import { RoomSettingsHomeScreen } from '../room/RoomPage';
import { RoomEncryptionScreen, RoomGeneralScreen, RoomNotificationsScreen, RoomVoiceScreen } from '../room/RoomPagesScreens';
import { RoomOverrideScreen, RoomPermissionsScreen } from '../room/PermissionsScreens';
import { AdminScreen } from '../admin/AdminScreen';
import { AdminUserScreen } from '../admin/AdminUserScreen';
import { AdminReportScreen } from '../admin/AdminReportScreen';
import { AdminSpaceScreen } from '../admin/AdminSpaceScreen';

jest.mock('@web/api/twoFactor', () => ({
  getTwoFactorStatus: jest.fn(async () => ({ totp_enabled: true, webauthn_credentials: [{ id: 'k', name: 'YubiKey', created_at: '2026-01-01T00:00:00Z' }], recovery_codes_remaining: 8 })),
}));
jest.mock('@web/api/devices', () => ({
  listOwnDevices: jest.fn(async () => [{ device_id: 'DEV1', has_keys: true, created_at: '2026-01-01T00:00:00Z', updated_at: '' }]),
}));
jest.mock('@web/lib/e2ee', () => ({
  getOwnFingerprint: jest.fn(async () => 'ABCD EFGH'),
  getBackupStatus: jest.fn(async () => ({ exists: true, version: '1', backedUp: 10, total: 10, pending: 0, outOfSync: false })),
  hasLegacyPinBackup: jest.fn(async () => false),
}));
jest.mock('@web/lib/e2ee/machine', () => ({
  E2eeStoreUnusableError: class E2eeStoreUnusableError extends Error {},
  getMachine: jest.fn(async () => ({})),
  getCurrentDeviceId: jest.fn(() => 'DEV1'),
}));
jest.mock('@web/stores/e2eeBackup', () => ({
  createBackupWithPrompt: jest.fn(),
  regenerateBackupWithPrompt: jest.fn(),
  restoreWithPrompt: jest.fn(),
  importLegacyWithPrompt: jest.fn(),
}));
jest.mock('@web/stores/recoveryPrompt', () => ({ setRecoveryPrompt: jest.fn() }));
jest.mock('@web/api/users', () => ({
  ...jest.requireActual('@web/api/users'),
  getMe: jest.fn(async () => ({ id: '100', username: 'me', display_name: 'Me', email: 'me@example.org', verified_email: false })),
}));
jest.mock('@web/api/developers', () => {
  const actual = jest.requireActual('@web/api/developers');
  const app = {
    id: 'A1',
    client_id: 'A1',
    owner_id: '100',
    name: 'Robo',
    description: '',
    icon: '',
    redirect_uris: ['https://cb.example/'],
    has_bot: true,
    bot_public: true,
    bot: { id: 'A1', username: 'robo', display_name: 'Robo', avatar: '', bot: true },
    created_at: '2026-01-01T00:00:00Z',
  };
  return {
    ...actual,
    listGrants: jest.fn(async () => [{ application_id: 'A2', application: { id: 'A2', name: 'Thing', description: 'd', icon: '', has_bot: false, bot_public: false }, scopes: ['identify'], created_at: '2026-01-01T00:00:00Z' }]),
    listApplications: jest.fn(async () => [app]),
    getApplication: jest.fn(async () => app),
    getAuthorizeInfo: jest.fn(async () => ({
      application: { id: 'A1', name: 'Robo', description: '', icon: '', has_bot: true, bot_public: true },
      bot: app.bot,
      scopes: ['bot', 'identify'],
      // Send Messages (1 << 1), grantable through Administrator (1 << 11).
      permissions: 2,
      spaces: [{ id: 'S', name: 'Space S', name_acronym: 'S', icon: '', grantable_permissions: 2048 }],
    })),
  };
});
jest.mock('@web/api/discover', () => ({
  ...jest.requireActual('@web/api/discover'),
  getSpaceListing: jest.fn(async () => null),
  getBotListing: jest.fn(async () => null),
  listDiscoverQueue: jest.fn(async () => []),
}));
jest.mock('@web/api/instance', () => ({
  getInstanceCapabilities: jest.fn(async () => ({ instance_admin: true })),
  listInstanceInvites: jest.fn(async () => [{ code: 'JOIN-ME', created_by: '100', note: 'friends', max_uses: 5, uses: 1, created_at: '' }]),
  getInstanceStats: jest.fn(async () => ({ open_reports: 2, bans: 1, ip_bans: 0, invites: 1, invite_only: true, accounts: 10, online: -1, spaces: 3 })),
  listReports: jest.fn(async () => []),
  getUserDetail: jest.fn(async () => ({ user: { id: 'U9', username: 'nine', display_name: 'Nine' }, ban: null, instance_admin: false, sessions: [], spaces: [], reports: [] })),
  getReport: jest.fn(async () => ({
    report: { id: 'R1', reporter_id: 'U9', target_type: 'user', target_id: 'U8', reason: 'spam', details: 'they spam', status: 'open', created_at: '2026-01-01T00:00:00Z' },
    reporter: { id: 'U9', username: 'nine', display_name: 'Nine' },
    target_user: { id: 'U8', username: 'eight', display_name: 'Eight' },
    message: { id: 'M', sender_id: 'U8', created_at: '', readable: false, deleted: false },
  })),
  getSpaceDetail: jest.fn(async () => ({ space: { id: 'S2', name: 'Bad space', owner_id: 'U8', created_at: '2026-01-01T00:00:00Z' }, owner: null, member_count: 4, reports: [] })),
}));
jest.mock('@web/api/spaces', () => ({
  ...jest.requireActual('@web/api/spaces'),
  listSpaceInvites: jest.fn(async () => []),
  listSpaceBans: jest.fn(async () => [{ user_id: 'U5', user: { id: 'U5', username: 'five', display_name: 'Five' }, reason: 'rude', banned_by: '100', created_at: '2026-01-01T00:00:00Z' }]),
  listSpaceAuditLog: jest.fn(async () => ({ entries: [{ id: 'E1', action_type: 'role_create', user_id: '100', target_id: 'mod', created_at: '2026-01-01T00:00:00Z' }], users: {} })),
  getSpaceWidget: jest.fn(async () => {
    throw new Error('off');
  }),
}));
jest.mock('@web/api/emojis', () => ({
  ...jest.requireActual('@web/api/emojis'),
  listSpaceEmojis: jest.fn(async () => []),
}));

const params = useLocalSearchParams as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  const roles = [role('everyone', 0, PermSendMessages, { name: '@everyone' }), role('mod', 1, PermManageRoles, { name: 'Mods', color: 0x3498db })];
  setSpaces({
    spaces: [space('S', roles, { owner_id: ME })],
    spaceRoomsBySpaceId: {
      S: [
        sroom('c1', 3, { name: 'general', topic: 'hi', e2ee_enabled: false }),
        sroom('v1', 4, { name: 'Lounge', user_limit: 0 }),
        sroom('s1', 5, { name: 'Info' }),
        sroom('c2', 3, { name: 'rules', parent_id: 's1', permissions_synced: true }),
      ],
    },
    loading: false,
    hydrated: true,
  });
  setSpaceMembers({ bySpaceId: { S: [member(ME, []), member('u2', ['mod']), member('u3')] }, loading: {}, loadedAt: { S: Date.now() } });
});

async function shows(ui: ReactElement, text: string | RegExp) {
  await render(ui);
  await waitFor(() => expect(screen.getAllByText(text).length).toBeGreaterThan(0));
  await screen.unmount();
}

describe('user settings screens render', () => {
  it('security', async () => {
    await shows(<SecurityScreen />, 'YubiKey');
    await shows(<SecurityScreen />, '8 unused codes remaining');
  });
  it('devices', () => shows(<DevicesScreen />, 'ABCD EFGH'));
  it('authorized apps', () => shows(<AuthorizedAppsScreen />, 'Thing'));
  it('appearance', () => shows(<AppearanceScreen />, 'Strafe Dark'));
  it('theme editor', async () => {
    params.mockReturnValueOnce({ base: 'strafe-dark' }).mockReturnValue({ base: 'strafe-dark' });
    await shows(<ThemeEditorScreen />, 'Save theme');
    params.mockReturnValue({});
  });
  it('accessibility', () => shows(<AccessibilityScreen />, 'Reduce motion'));
  it('voice', () => shows(<VoiceScreen />, 'Audio output'));
  it('behaviour', () => shows(<BehaviourScreen />, 'Open the last conversation on launch'));
  it('language', () => shows(<LanguageScreen />, 'Español'));
  it('privacy', () => shows(<PrivacyScreen />, 'No blocked users'));
  it('instance', () => shows(<InstanceScreen />, 'JOIN-ME'));
  it('developers', () => shows(<DevelopersScreen />, 'Robo'));
  it('one application', async () => {
    params.mockReturnValue({ appId: 'A1' });
    await shows(<DeveloperAppScreen />, 'OAuth2 URL generator');
    params.mockReturnValue({});
  });
  it('oauth consent', async () => {
    params.mockReturnValue({ client_id: 'A1', scope: 'bot identify' });
    await shows(<OAuthAuthorizeScreen />, 'Add Robo to a space');
    params.mockReturnValue({});
  });
});

describe('space settings screens render', () => {
  beforeEach(() => params.mockReturnValue({ spaceId: 'S', roleId: 'mod' }));
  afterAll(() => params.mockReturnValue({}));
  it('home', () => shows(<SpaceSettingsHomeScreen />, 'Roles & permissions'));
  it('overview with the danger zone', () => shows(<SpaceOverviewScreen />, 'Transfer ownership'));
  it('system', () => shows(<SpaceSystemScreen />, 'Send a message when someone joins'));
  it('discover', () => shows(<SpaceDiscoverScreen />, 'Not listed'));
  it('roles', () => shows(<SpaceRolesScreen />, 'Mods'));
  it('role editor', () => shows(<RoleEditorScreen />, 'Show role separately'));
  it('emojis', () => shows(<SpaceEmojisScreen />, 'No custom emoji yet.'));
  it('moderation', () => shows(<SpaceModerationScreen />, 'Verification level'));
  it('members', () => shows(<SpaceMembersScreen />, 'User u2'));
  it('invites', () => shows(<SpaceInvitesScreen />, 'No active invites.'));
  it('bans', () => shows(<SpaceBansScreen />, 'rude'));
  it('audit log', () => shows(<SpaceAuditLogScreen />, /created the role|role_create|Mods/));
});

describe('room settings screens render', () => {
  afterAll(() => params.mockReturnValue({}));
  it('home of a text room', async () => {
    params.mockReturnValue({ roomId: 'c1' });
    await shows(<RoomSettingsHomeScreen />, 'Encryption');
  });
  it('general', async () => {
    params.mockReturnValue({ roomId: 'c1' });
    await shows(<RoomGeneralScreen />, 'Save room settings');
  });
  it('encryption', async () => {
    params.mockReturnValue({ roomId: 'c1' });
    await shows(<RoomEncryptionScreen />, 'Turn off encryption');
  });
  it('voice', async () => {
    params.mockReturnValue({ roomId: 'v1' });
    await shows(<RoomVoiceScreen />, '64 kbps');
  });
  it('notifications', async () => {
    params.mockReturnValue({ roomId: 'c1' });
    await shows(<RoomNotificationsScreen />, 'Use default');
  });
  it('permissions of a section', async () => {
    params.mockReturnValue({ roomId: 's1' });
    await shows(<RoomPermissionsScreen />, 'Private section');
  });
  it('permissions of a synced channel are locked', async () => {
    params.mockReturnValue({ roomId: 'c2' });
    await shows(<RoomPermissionsScreen />, 'Sync permissions with section');
  });
  it('an override', async () => {
    params.mockReturnValue({ roomId: 'c1', target: 'role:mod' });
    await shows(<RoomOverrideScreen />, 'Save override');
  });
});

describe('admin screens render', () => {
  afterAll(() => params.mockReturnValue({}));
  it('dashboard', async () => {
    params.mockReturnValue({});
    await shows(<AdminScreen />, 'Accounts');
  });
  it('a user', async () => {
    params.mockReturnValue({ userId: 'U9' });
    await shows(<AdminUserScreen />, 'Ban from instance');
  });
  it('a report', async () => {
    params.mockReturnValue({ reportId: 'R1' });
    await shows(<AdminReportScreen />, 'they spam');
  });
  it('a space', async () => {
    params.mockReturnValue({ spaceId: 'S2' });
    await shows(<AdminSpaceScreen />, 'Official space');
  });
});
