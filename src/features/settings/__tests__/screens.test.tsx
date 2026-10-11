/// <reference types="jest" />
import './settingsTestSetup';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { setAuth } from '@web/stores/auth';
import { notificationPrefs } from '@web/stores/notificationPrefs';
import { openUserSettings } from '@web/stores/userSettingsModal';
import { PermAdministrator, PermKickMembers, PermSendMessages } from '@web/lib/spacePermissions';
import type { SpaceRole } from '@web/api/spaces';
import { installSettingsWiring, openRoomSettings, openSettings, openSpaceSettings } from '../navigation';
import { profilePatch , AccountScreen } from '../user/AccountScreen';
import { parseSlowmode } from '../room/RoomPagesScreens';
import { parseMentionLimit } from '../space/ModerationScreen';
import { withSystemNotice } from '../space/SystemScreen';
import { transferCandidates } from '../space/OverviewScreen';
import { emojiNameFromFile } from '../space/EmojisScreen';
import { filterBans } from '../space/BansScreen';
import { roleDraftDirty, rolePatch } from '../space/RoleEditorScreen';
import { generatedAuthorizeUrl, parseRedirects, scopesNeedRedirect } from '../user/developers/DeveloperAppScreen';
import { denyRedirect, grantableDefaults } from '../OAuthAuthorizeScreen';
import { dbToPercent, levelToDb, meterSpeaking } from '../user/VoiceScreen';
import { statNumber, statCount } from '../admin/shared';
import { listingStatusKey, listingSubmitKey } from '../components/DiscoverListingForm';
import { seedThemeDraft } from '../user/ThemeEditorScreen';
import { inviteExpiryLabel } from '../space/InvitesScreen';
import { needsDirectionRestart } from '../user/LanguageScreen';
import { inviteUsesText } from '../user/InstanceScreen';
import { SettingsHomeScreen } from '../user/SettingsHomeScreen';
import { NotificationsScreen } from '../user/NotificationsScreen';
import { choiceRows, SettingToggle } from '../components/rows';
import { TriStateControl } from '../components/TriState';

jest.mock('@web/api/instance', () => ({
  getInstanceCapabilities: jest.fn(async () => ({ instance_admin: false })),
}));

jest.mock('@web/api/users', () => {
  const actual = jest.requireActual('@web/api/users');
  return {
    ...actual,
    getMe: jest.fn(async () => ({ id: '1', username: 'sam', display_name: 'Sam', email: 's@example.org', bio: 'old bio', about_me: '', pronouns: 'they/them' })),
    patchMe: jest.fn(async (input: Record<string, unknown>) => ({ id: '1', username: 'sam', display_name: input.display_name ?? 'Sam', bio: input.bio, about_me: input.about_me, pronouns: input.pronouns })),
  };
});

const instanceApi = jest.requireMock('@web/api/instance') as { getInstanceCapabilities: jest.Mock };
const usersApi = jest.requireMock('@web/api/users') as { patchMe: jest.Mock; getMe: jest.Mock };

beforeEach(() => {
  jest.clearAllMocks();
  setAuth({ user: { id: '1', username: 'sam', display_name: 'Sam' }, token: 'tok', hydrated: true, loading: false });
});

describe('opening settings', () => {
  it('pushes the matching screen', () => {
    openSettings('appearance');
    expect(router.push).toHaveBeenLastCalledWith('/settings/appearance');
    openSpaceSettings('5', 'general');
    expect(router.push).toHaveBeenLastCalledWith('/space-settings/5/overview');
    openRoomSettings('8', 'overrides');
    expect(router.push).toHaveBeenLastCalledWith('/room-settings/8/permissions');
  });

  it("turns the web's openUserSettings into a navigation", async () => {
    const dispose = installSettingsWiring();
    openUserSettings('instance');
    await act(async () => {
      await Promise.resolve();
    });
    expect(router.push).toHaveBeenLastCalledWith('/settings/instance');
    openUserSettings();
    await act(async () => {
      await Promise.resolve();
    });
    expect(router.push).toHaveBeenLastCalledWith('/settings');
    dispose();
  });
});

describe('pure screen rules', () => {
  it('clears an emptied bio and about me, but never sends an empty display name', () => {
    expect(profilePatch({ displayName: '  ', pronouns: ' he/him ', aboutMe: '', bio: '' })).toEqual({ bio: '', about_me: '', pronouns: 'he/him' });
    expect(profilePatch({ displayName: 'Sam ', pronouns: '', aboutMe: 'hi', bio: 'b' })).toEqual({ display_name: 'Sam', bio: 'b', about_me: 'hi', pronouns: '' });
  });

  it('validates slowmode and the mention limit as the web does', () => {
    expect(parseSlowmode('30')).toBe(30);
    expect(parseSlowmode('-1')).toBeNull();
    expect(parseSlowmode('x')).toBeNull();
    expect(parseMentionLimit('7', 5)).toBe(7);
    expect(parseMentionLimit('5', 5)).toBeNull();
    expect(parseMentionLimit('51', 5)).toBeNull();
    expect(parseMentionLimit('0', 5)).toBeNull();
  });

  it('inverts the system notice bits', () => {
    expect(withSystemNotice(0, 1, false)).toBe(1);
    expect(withSystemNotice(3, 1, true)).toBe(2);
  });

  it('picks transfer candidates and emoji names', () => {
    const members = [
      { id: 'o', username: 'owner', display_name: '' },
      { id: 'a', username: 'amy', display_name: 'Amy' },
    ] as never[];
    expect(transferCandidates(members, 'o', '').map((m: { id: string }) => m.id)).toEqual(['a']);
    expect(transferCandidates(members, 'o', 'zz')).toEqual([]);
    expect(emojiNameFromFile('Party Blob!.png')).toBe('party_blob');
  });

  it('searches bans by name, username or reason', () => {
    const bans = [
      { user_id: '1', user: { id: '1', username: 'troll', display_name: 'T' }, reason: 'spam', banned_by: '2', created_at: '' },
      { user_id: '2', reason: '', banned_by: '2', created_at: '' },
    ];
    expect(filterBans(bans, 'SPAM').map((b) => b.user_id)).toEqual(['1']);
    expect(filterBans(bans, '').length).toBe(2);
  });

  it('tracks a role draft and builds its PATCH', () => {
    const r: SpaceRole = { id: 'r', name: 'Mods', permissions: PermKickMembers, position: 1, color: 0x1abc9c, hoist: false, mentionable: false, created_at: '', updated_at: '' };
    const draft = { name: 'Mods', color: '#1abc9c', hoist: false, mentionable: false, permissions: PermKickMembers };
    expect(roleDraftDirty(r, draft)).toBe(false);
    expect(roleDraftDirty(r, { ...draft, name: '  ' })).toBe(false);
    expect(roleDraftDirty(r, { ...draft, permissions: PermKickMembers | PermSendMessages })).toBe(true);
    expect(rolePatch(r, { ...draft, name: 'Moderators' })).toEqual({ permissions: PermKickMembers, color: 0x1abc9c, hoist: false, mentionable: false, name: 'Moderators' });
    expect(rolePatch({ ...r, name: '@everyone' }, { ...draft, name: 'x' }).name).toBeUndefined();
  });

  it('builds authorization links like the URL generator', () => {
    expect(parseRedirects(' https://a.example/cb \n\nhttps://b.example ')).toEqual(['https://a.example/cb', 'https://b.example']);
    expect(scopesNeedRedirect(new Set(['bot']))).toBe(false);
    expect(generatedAuthorizeUrl({ client_id: '9' }, new Set(['identify']), 0, '')).toBe('');
    const url = generatedAuthorizeUrl({ client_id: '9' }, new Set(['bot']), PermAdministrator, '');
    expect(url).toContain('/oauth2/authorize?');
    expect(url).toContain('client_id=9');
    expect(url).toContain(`permissions=${PermAdministrator}`);
    expect(url).not.toContain('redirect_uri');
  });

  it('seeds consent permissions from what may be granted', () => {
    expect(grantableDefaults(PermKickMembers | PermSendMessages, PermSendMessages)).toBe(PermSendMessages);
    expect(grantableDefaults(PermKickMembers | PermSendMessages, PermAdministrator)).toBe(PermKickMembers | PermSendMessages);
    expect(denyRedirect('https://app.example/cb', 'xyz')).toBe('https://app.example/cb?error=access_denied&state=xyz');
    expect(denyRedirect('https://app.example/cb?a=1')).toBe('https://app.example/cb?a=1&error=access_denied');
    expect(denyRedirect('')).toBeNull();
  });

  it('meters the microphone on the web scale', () => {
    expect(dbToPercent(0)).toBe(100);
    expect(dbToPercent(-60)).toBe(0);
    expect(levelToDb(0)).toBe(-100);
    expect(levelToDb(1)).toBeCloseTo(20 * Math.log10(1 / 3.2), 3);
    expect(meterSpeaking(30, { autoSensitivity: true, sensitivityDb: -50 })).toBe(true);
    expect(meterSpeaking(20, { autoSensitivity: false, sensitivityDb: -50 })).toBe(true);
    expect(meterSpeaking(10, { autoSensitivity: false, sensitivityDb: -50 })).toBe(false);
  });

  it('formats admin stats and listings', () => {
    expect(statNumber(-1)).toBe('—');
    expect(statNumber(0)).toBe('0');
    expect(statCount(0)).toBeUndefined();
    expect(statCount(3)).toBe(3);
    expect(listingStatusKey(null)).toBe('discover.listing.statusNone');
    expect(listingSubmitKey({ status: 'denied' } as never)).toBe('discover.listing.reapply');
    expect(listingSubmitKey({ status: 'approved' } as never)).toBe('discover.listing.update');
  });

  it("seeds the theme editor the web's way", () => {
    const colors = { primary: '#000000' } as never;
    const custom = seedThemeDraft({ id: 'custom-1', name: 'Mine', appearance: 'light', colors } as never, colors);
    expect(custom.id).toBe('custom-1');
    expect(custom.name).toBe('Mine');
    const copy = seedThemeDraft({ id: 'strafe-dark', name: 'Strafe Dark', appearance: 'dark', colors, builtin: true } as never, colors);
    expect(copy.id).not.toBe('strafe-dark');
    expect(copy.name).toContain('Strafe Dark');
  });

  it('labels invites and the RTL restart', () => {
    expect(inviteExpiryLabel(0)).toBe('Never');
    expect(inviteExpiryLabel(1800)).toBe('30 minutes');
    expect(inviteExpiryLabel(86400)).toBe('1 day');
    expect(inviteUsesText({ uses: 1, max_uses: 5 })).toBe('1 of 5 used');
    expect(needsDirectionRestart('ar', false)).toBe(true);
    expect(needsDirectionRestart('fr', false)).toBe(false);
    expect(needsDirectionRestart('en', true)).toBe(true);
  });
});

describe('rows', () => {
  it('a setting toggle flips as one switch', async () => {
    const onChange = jest.fn();
    await render(<SettingToggle title="Compact mode" description="Fit more" value={false} onValueChange={onChange} />);
    const sw = screen.getByRole('switch', { name: /Compact mode/ });
    await fireEvent.press(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('choice rows are radios with the chosen one checked', async () => {
    const onChange = jest.fn();
    await render(<>{choiceRows({ value: 'b', onChange, options: [{ value: 'a', title: 'Alpha' }, { value: 'b', title: 'Beta' }] })}</>);
    expect(screen.getByRole('radio', { name: /Beta/ })).toBeChecked();
    await fireEvent.press(screen.getByRole('radio', { name: /Alpha/ }));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('the override switch offers deny, inherit and allow', async () => {
    const onChange = jest.fn();
    await render(<TriStateControl name="Send Messages" value="neutral" onChange={onChange} />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Deny, Send Messages' }));
    expect(onChange).toHaveBeenCalledWith('deny');
    expect(screen.getByRole('radio', { name: 'Inherit, Send Messages' })).toBeChecked();
  });
});

describe('settings home', () => {
  it('lists the pages and hides Instance from non-admins', async () => {
    await render(<SettingsHomeScreen />);
    expect(await screen.findByText('My Account')).toBeTruthy();
    expect(screen.getByText('Behaviour')).toBeTruthy();
    expect(screen.queryByText('Instance')).toBeNull();
    await fireEvent.press(screen.getByTestId('settings-nav-security'));
    expect(router.push).toHaveBeenCalledWith('/settings/security');
  });

  it('shows Instance and the dashboard to an administrator', async () => {
    instanceApi.getInstanceCapabilities.mockResolvedValueOnce({ instance_admin: true });
    await render(<SettingsHomeScreen />);
    expect(await screen.findByTestId('settings-nav-instance')).toBeTruthy();
    expect(screen.getByTestId('settings-nav-admin')).toBeTruthy();
  });

  it('filters by search', async () => {
    await render(<SettingsHomeScreen />);
    await fireEvent.changeText(screen.getByLabelText('Search settings'), 'lang');
    expect(screen.getByTestId('settings-nav-language')).toBeTruthy();
    expect(screen.queryByTestId('settings-nav-security')).toBeNull();
  });
});

describe('notifications', () => {
  it('writes the shared notification preferences', async () => {
    // The data layer's shared memos dispose on a timer after unmount; run it here.
    jest.useFakeTimers();
    await render(<NotificationsScreen />);
    expect(notificationPrefs.preview).toBe(true);
    await fireEvent.press(screen.getByTestId('notif-preview'));
    expect(notificationPrefs.preview).toBe(false);
    await fireEvent.press(screen.getByTestId('notif-space-all'));
    expect(notificationPrefs.spaceMode).toBe('all');
    await fireEvent.press(screen.getByTestId('notif-pm-none'));
    expect(notificationPrefs.pmMode).toBe('none');
    await screen.unmount();
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });
});

describe('my account', () => {
  it('saves the profile draft from the header', async () => {
    await render(<AccountScreen />);
    await waitFor(() => expect(usersApi.getMe).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByDisplayValue('old bio')).toBeTruthy());
    expect(screen.queryByTestId('account-save')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('account-display-name'), 'Samantha');
    await fireEvent.press(screen.getByTestId('account-save'));
    await waitFor(() => expect(usersApi.patchMe).toHaveBeenCalledWith({ display_name: 'Samantha', bio: 'old bio', about_me: '', pronouns: 'they/them' }));
  });
});
