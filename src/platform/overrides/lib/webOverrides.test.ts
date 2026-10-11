/**
 * The small overrides: each keeps the web module's exports, wraps the real module where most of
 * it is fine (a local export must win over `export *`), and does the mobile thing for the rest.
 */
import { beforeAll, describe, expect, it, jest } from '@jest/globals';
import i18next from 'i18next';

const mockClipboard = { value: '' };
jest.mock('expo-clipboard', () => ({
  setStringAsync: async (s: string) => {
    mockClipboard.value = s;
    return true;
  },
  getStringAsync: async () => mockClipboard.value,
}));

// What lib/userContextMenu reaches, reduced to what the user menu needs here.
jest.mock('@web/stores/instance', () => ({
  formatHandle: (u: { username?: string; home_domain?: string }) => (u.home_domain ? `${u.username}@${u.home_domain}` : u.username),
}));
jest.mock('@web/stores/relationships', () => ({ RelType: { None: 0, Friend: 1, Blocked: 2, IncomingRequest: 3, OutgoingRequest: 4 }, relationshipType: () => 0 }));
jest.mock('@web/api/relationships', () => ({ putRelationship: jest.fn(), blockUser: jest.fn(), unblockUser: jest.fn() }));
jest.mock('@web/api/developers', () => ({ authorizeUrl: () => '/oauth2/authorize' }));
jest.mock('@web/lib/openWindow', () => ({ openAppWindow: jest.fn() }));
jest.mock('@web/lib/spacePermissions', () => ({ memberHighestRolePosition: () => 0 }));
jest.mock('@web/i18n/index', () => jest.requireActual('../i18n/index'));
// Metro swaps this .tsx for the mobile module; jest needs telling.
jest.mock('@web/components/ReportDialog', () => jest.requireActual('../components/ReportDialog'));
jest.mock('@web/stores/auth', () => ({ auth: { user: null } }));
jest.mock('@web/stores/rooms', () => ({ rooms: { rooms: [] }, roomDisplayName: () => '' }));
jest.mock('@web/stores/spaces', () => ({ spaces: { spaceRoomsBySpaceId: {} } }));
jest.mock('@web/api/reports', () => ({ createReport: jest.fn() }));
jest.mock('@web/api/instance', () => ({ REPORT_REASONS: [] }));

beforeAll(async () => {
  await i18next.init({ lng: 'en', initAsync: false, resources: { en: { translation: {} } } });
});

describe('stores/keybinds', () => {
  it('keeps the store and helpers, with a no-op dispatcher', () => {
    const keybinds = require('../stores/keybinds') as typeof import('../stores/keybinds');
    const handler = jest.fn();
    const dispose = keybinds.initKeybinds({ openSettings: handler });
    expect(typeof dispose).toBe('function');
    dispose();
    expect(keybinds.DEFAULT_KEYBINDS.toggleMute).toBe('Ctrl+Shift+M');
    expect(keybinds.comboParts('Ctrl+Shift+K')).toEqual(['Ctrl', 'Shift', 'K']);
    expect(keybinds.keybinds.openSettings).toBe('Ctrl+,');
  });
});

describe('lib/userContextMenu', () => {
  it('runs the web builders, and their copy actions reach the clipboard', async () => {
    const menu = require('./userContextMenu') as typeof import('./userContextMenu');
    const items = menu.buildUserMenuItems({ userId: '200', username: 'alice', displayName: 'Alice', homeDomain: 'b.example', currentUserId: '100' });
    const labels = items.map((i) => i.label);
    expect(labels).toEqual(['friends.addFriend', 'userArea.copyUsername', 'userArea.copyUserId', 'userMenu.block', 'profile.report']);
    // The copy goes through the async clipboard: wait for it rather than for one tick, which
    // is not enough on a slower machine (it failed that way in CI).
    const clipboardBecomes = async (value: string) => {
      for (let i = 0; i < 50 && mockClipboard.value !== value; i++) await new Promise((r) => setTimeout(r, 10));
      expect(mockClipboard.value).toBe(value);
    };
    items[1]!.onClick();
    await clipboardBecomes('alice@b.example');
    items[2]!.onClick();
    await clipboardBecomes('200');
  });

  it('reports through the native report sheet', () => {
    const menu = require('./userContextMenu') as typeof import('./userContextMenu');
    const report = require('../../presenters/reportSheet') as typeof import('../../presenters/reportSheet');
    const items = menu.buildUserMenuItems({ userId: '200', username: 'alice', displayName: 'Alice', currentUserId: '100', roomId: '7' });
    items.find((i) => i.label === 'profile.report')!.onClick();
    expect(report.reportSheet.subject).toMatchObject({ targetType: 'user', targetId: '200', targetName: 'Alice', roomId: '7' });
  });
});

describe('lib/webauthn', () => {
  it('says passkeys are unavailable, with an error the login can show', async () => {
    const webauthn = require('./webauthn') as typeof import('./webauthn');
    expect(webauthn.webauthnSupported()).toBe(false);
    const err = await webauthn.getPasskeyAssertion({}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(webauthn.PasskeysUnavailableError);
    expect((err as Error).message).toBe('mobile.webOverrides.passkeyUnavailable');
    expect(webauthn.isWebauthnCancellation(err)).toBe(false);
    await expect(webauthn.createPasskey({})).rejects.toBeInstanceOf(webauthn.PasskeysUnavailableError);
  });
});

describe('stores/mobileShellLayout', () => {
  it('moves and reads the native shell', () => {
    const layout = require('../stores/mobileShellLayout') as typeof import('../stores/mobileShellLayout');
    const shell = require('../../../shell/state') as typeof import('../../../shell/state');
    layout.openMobileRoom();
    expect(shell.shell.panel()).toBe('content');
    expect(layout.mobileNavFocus()).toBe('content');
    layout.setMobileMembersOpen(true);
    expect(shell.shell.membersOpen()).toBe(true);
    layout.openMobileRails();
    expect(shell.shell.panel()).toBe('nav');
    expect(shell.shell.membersOpen()).toBe(false);
    expect(layout.mobileTab()).toBe('home');
  });
});

describe('inert modules', () => {
  it('composerFocus, desktop/boot and desktop/updater do nothing, safely', async () => {
    const composer = require('./composerFocus') as typeof import('./composerFocus');
    expect(() =>
      composer.createComposerAutoFocus({ inputRef: () => undefined, focusKey: () => '1', onType: () => undefined }),
    ).not.toThrow();
    const boot = require('../desktop/boot') as typeof import('../desktop/boot');
    expect(() => boot.initDesktop()).not.toThrow();
    const updater = require('../desktop/updater') as typeof import('../desktop/updater');
    await updater.checkForDesktopUpdate();
    updater.scheduleDesktopUpdateChecks();
    expect(updater.desktopUpdate.status).toBe('idle');
  });
});
