/// <reference types="jest" />
/**
 * Permission masks past bit 30 in the app's own permission code (spec 2.2): Manage Webhooks is
 * bit 31 and Masquerade bit 32, which JS's 32-bit `&`/`|`/`~` turn into a sign bit and into
 * nothing. The override switches, the private-section switch, the OAuth bot installer and the
 * developer URL generator all go through the web's permBits now; the role and override editors
 * list the two new rows; and scripts/check-perm-bits.cjs keeps bitwise maths on permissions out
 * of src/ (this suite runs it, so `npm test` does too).
 */
import './settingsTestSetup';
import { orPerms, permBit, toWire } from '@web/lib/permBits';
import {
  PermAdministrator,
  PermManageWebhooks,
  PermMasquerade,
  PermSendMessages,
  PermViewChannel,
  ROOM_OVERRIDE_PERM_ROWS,
  SPACE_ROLE_PERM_GROUPS,
  VOICE_ROOM_OVERRIDE_PERM_ROWS,
} from '@web/lib/spacePermissions';
import { applyOverrideState, overrideState } from '../components/TriState';
import { isPrivateSection, overrideCounts, overrideRowsFor, privateSectionChange } from '../room/overrideLogic';
import { grantableDefaults } from '../OAuthAuthorizeScreen';
import { generatedAuthorizeUrl } from '../user/developers/DeveloperAppScreen';

const check = require('../../../../scripts/check-perm-bits.cjs') as {
  selfTest: () => string[];
  scanTree: () => string[];
  scanSource: (src: string) => { line: number; text: string }[];
};

const B31 = 2 ** 31;
const B32 = 2 ** 32;
const B52 = 2 ** 52;

describe('the new bits', () => {
  test('are 2^31 and 2^32', () => {
    expect(PermManageWebhooks).toBe(B31);
    expect(PermMasquerade).toBe(B32);
    expect(permBit(52)).toBe(B52);
  });

  test('the role editor lists both, the override editors list them per room kind', () => {
    const roleKeys = SPACE_ROLE_PERM_GROUPS.flatMap((g) => g.rows.map((r) => r.key));
    expect(roleKeys).toEqual(expect.arrayContaining(['manageWebhooks', 'masquerade']));
    const text = overrideRowsFor({ type: 3 }).map((r) => r.key);
    expect(text).toEqual(expect.arrayContaining(['manageWebhooks', 'masquerade']));
    expect(text).toEqual(ROOM_OVERRIDE_PERM_ROWS.map((r) => r.key));
    // A voice room's text side can hold webhooks, but nobody masquerades in it.
    const voice = overrideRowsFor({ type: 4 }).map((r) => r.key);
    expect(voice).toEqual(VOICE_ROOM_OVERRIDE_PERM_ROWS.map((r) => r.key));
    expect(voice).toContain('manageWebhooks');
    expect(voice).not.toContain('masquerade');
  });
});

describe('override switches (TriState)', () => {
  test('bits 31, 32 and 52 read and toggle, never negative', () => {
    let m = { allow: 0, deny: 0 };
    m = applyOverrideState(m, B31, 'allow');
    expect(m).toEqual({ allow: B31, deny: 0 });
    expect(overrideState(m.allow, m.deny, B31)).toBe('allow');
    expect(overrideState(m.allow, m.deny, 1)).toBe('neutral');
    m = applyOverrideState(m, B32, 'deny');
    expect(m).toEqual({ allow: B31, deny: B32 });
    expect(overrideState(m.allow, m.deny, B32)).toBe('deny');
    // Bit 32 must not alias View Room.
    expect(overrideState(m.allow, m.deny, PermViewChannel)).toBe('neutral');
    m = applyOverrideState(m, B52, 'allow');
    m = applyOverrideState(m, B31, 'neutral');
    expect(m).toEqual({ allow: B52, deny: B32 });
    expect(m.allow).toBeGreaterThan(0);
    // Moving a bit from deny to allow clears it from deny.
    m = applyOverrideState(m, B32, 'allow');
    expect(m).toEqual({ allow: orPerms(B32, B52), deny: 0 });
  });

  test('reads a server string the same as a number', () => {
    expect(overrideState('6442450944', '0', B32)).toBe('allow');
    expect(overrideState(0, '2147483648', B31)).toBe('deny');
  });

  test('the counts in an override list see the high bits', () => {
    const rows = ROOM_OVERRIDE_PERM_ROWS;
    expect(overrideCounts({ allow: orPerms(PermManageWebhooks, PermSendMessages), deny: PermMasquerade }, rows)).toEqual({ allowed: 2, denied: 1 });
  });
});

describe('private section switch', () => {
  test('keeps an override\'s bits 31 and 32', () => {
    const existing = { allow: orPerms(PermManageWebhooks, PermViewChannel), deny: PermMasquerade };
    expect(privateSectionChange(existing, true)).toEqual({ action: 'put', allow: PermManageWebhooks, deny: orPerms(PermMasquerade, PermViewChannel) });
    expect(privateSectionChange({ allow: 0, deny: orPerms(PermViewChannel, PermMasquerade) }, false)).toEqual({ action: 'put', allow: 0, deny: PermMasquerade });
    expect(privateSectionChange({ allow: 0, deny: PermViewChannel }, false)).toEqual({ action: 'delete' });
    expect(isPrivateSection([{ role_id: 'ev', allow: 0, deny: orPerms(PermViewChannel, PermMasquerade), created_at: '', updated_at: '' }], 'ev')).toBe(true);
    expect(isPrivateSection([{ role_id: 'ev', allow: 0, deny: PermMasquerade, created_at: '', updated_at: '' }], 'ev')).toBe(false);
  });
});

describe('the bot installer and the URL generator', () => {
  test('what a viewer may grant keeps the high bits; Administrator grants all asked for', () => {
    const asked = orPerms(PermSendMessages, PermManageWebhooks, PermMasquerade);
    expect(grantableDefaults(asked, orPerms(PermSendMessages, PermMasquerade))).toBe(orPerms(PermSendMessages, PermMasquerade));
    expect(grantableDefaults(asked, PermAdministrator)).toBe(asked);
    expect(grantableDefaults(String(asked), String(PermAdministrator))).toBe(asked);
    expect(grantableDefaults(asked, 0)).toBe(0);
  });

  test('the generated link carries the full mask as a decimal string', () => {
    const perms = orPerms(PermSendMessages, PermManageWebhooks, PermMasquerade);
    const url = generatedAuthorizeUrl({ client_id: '42' }, new Set(['bot'] as const), perms, '');
    expect(new URL(url).searchParams.get('permissions')).toBe(toWire(perms));
    expect(toWire(perms)).toBe('6442450946');
  });
});

describe('scripts/check-perm-bits.cjs', () => {
  test('the scanner catches the classic mistakes and nothing else', () => {
    expect(check.selfTest()).toEqual([]);
    expect(check.scanSource('const x = (o.allow & ~PermViewChannel) | PermMasquerade;').length).toBeGreaterThan(0);
  });

  test('src/ has no bitwise maths on permissions', () => {
    expect(check.scanTree()).toEqual([]);
  });
});
