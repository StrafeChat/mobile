/**
 * The display config: every native string present and localized with its placeholders
 * intact, accounts labelled as handles relative to the open account's instance.
 */
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('@web/desktop/accounts', () => ({ desktopAccounts: () => [], activeDesktopAccountId: () => null }));
jest.mock('@web/stores/auth', () => ({ auth: { token: null } }));
jest.mock('../../storage', () => ({ appStorage: { getString: () => undefined, set: () => undefined, remove: () => undefined } }));

const { i18next } = require('../../i18n') as typeof import('../../i18n');
const { buildDisplayConfig, pushStrings } = require('../display') as typeof import('../display');

const account = (id: string, username: string, domain: string) => ({
  id: `${domain}:${id}`,
  slot: `s${id}`,
  userId: id,
  username,
  domain,
  apiBase: `https://api.${domain}`,
  token: `tok-${id}`,
});

describe('pushStrings', () => {
  it('has every string, templates keeping their placeholders', async () => {
    await i18next.changeLanguage('en');
    const s = pushStrings();
    for (const [key, value] of Object.entries(s)) {
      expect(typeof value).toBe('string');
      expect(value).not.toBe(`mobile.push.${key}`);
    }
    expect(s.spaceRoom).toBe('#{{room}} · {{space}}');
    expect(s.threadRoom).toBe('{{thread}} · #{{room}}');
    expect(s.callFrom).toBe('{{name}} is calling');
    expect(s.callFromIn).toBe('{{name}} is calling {{room}}');
    expect(s.encryptedMessage).toBe('Encrypted message');
  });

  it('follows the language', async () => {
    await i18next.changeLanguage('de');
    expect(pushStrings().callFrom).toBe('{{name}} ruft an');
    expect(pushStrings().markRead).toBe('Als gelesen markieren');
    await i18next.changeLanguage('en');
  });
});

describe('buildDisplayConfig', () => {
  const a = account('1', 'alice', 'a.example');
  const b = account('2', 'bob', 'b.example');
  const c = account('3', 'carol', 'a.example');

  it('labels accounts as the open session would write their handles', () => {
    const config = buildDisplayConfig({ accounts: [a, b, c], activeAccountId: a.id, preview: false, sounds: true, includeTokens: true });
    expect(config.activeSlot).toBe('s1');
    expect(config.preview).toBe(false);
    expect(config.sounds).toBe(true);
    expect(config.accounts).toEqual([
      { slot: 's1', userId: '1', label: '@alice', apiBase: 'https://api.a.example', token: 'tok-1' },
      { slot: 's2', userId: '2', label: '@bob@b.example', apiBase: 'https://api.b.example', token: 'tok-2' },
      { slot: 's3', userId: '3', label: '@carol', apiBase: 'https://api.a.example', token: 'tok-3' },
    ]);
  });

  it('signed out: no open account, every handle qualified; tokens only when asked', () => {
    const config = buildDisplayConfig({ accounts: [a, b], activeAccountId: null, preview: true, sounds: false, includeTokens: false });
    expect(config.activeSlot).toBeNull();
    expect(config.accounts.map((x) => x.label)).toEqual(['@alice@a.example', '@bob@b.example']);
    expect(config.accounts[0]).not.toHaveProperty('token');
  });
});
