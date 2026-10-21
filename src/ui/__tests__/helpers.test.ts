/// <reference types="jest" />
import './setup';
// The theme reads stores/appearance, which reaches the web store graph (lib/gif/providers ->
// stores/instance -> auth -> voice, notification prefs); those need their jest stand-ins.
import '@/data/testing/webMocks';
import type { ContextMenuItem } from '@web/stores/contextMenu';
import { luminance, parseColor, withAlpha } from '../color';
import { hasIcon } from '../Icon';
import { parseIcon } from '../icons';
import { formatBadgeCount } from '../Badge';
import { avatarInitial } from '../Avatar';
import { snapToStep } from '../Slider';
import { normalizePresence, presenceLabel } from '../PresenceDot';
import { cleanEntries, type ActionSheetEntry } from '../presenter';
import { hitSlopFor } from '../tokens';
import { BADGES } from '@web/lib/badges';

describe('color', () => {
  it('parses hex and rgb forms', () => {
    expect(parseColor('#509b6b')).toEqual({ r: 80, g: 155, b: 107, a: 1 });
    expect(parseColor('#abc')).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor('rgba(250, 168, 26, 0.10)')).toEqual({ r: 250, g: 168, b: 26, a: 0.1 });
    expect(parseColor('papayawhip')).toBeNull();
  });

  it('applies alpha on top of existing alpha', () => {
    expect(withAlpha('#509b6b', 0.15)).toBe('rgba(80, 155, 107, 0.15)');
    expect(withAlpha('rgba(0,0,0,0.5)', 0.5)).toBe('rgba(0, 0, 0, 0.25)');
    // Unknown colours pass through rather than vanishing.
    expect(withAlpha('red', 0.5)).toBe('red');
  });

  it('computes relative luminance', () => {
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1);
  });
});

describe('parseIcon', () => {
  it.each([
    ['fa-solid fa-gear', 'gear', 'solid'],
    ['fa-regular fa-copy', 'copy', 'regular'],
    ['fa-brands fa-discord', 'discord', 'brand'],
    ['fa-crown', 'crown', 'solid'],
    ['gear', 'gear', 'solid'],
    ['fa-solid fa-circle-notch fa-spin text-[11px] text-amber-500', 'circle-notch', 'solid'],
    ['fa-solid fa-times', 'xmark', 'solid'],
  ])('%s -> %s (%s)', (spec, name, style) => {
    const p = parseIcon(spec);
    expect(p.name).toBe(name);
    expect(p.style).toBe(style);
  });

  it('reads fa-spin and ignores stray utility classes', () => {
    expect(parseIcon('fa-solid fa-circle-notch fa-spin').spin).toBe(true);
    expect(parseIcon('text-sm mt-1').name).toBe('');
  });

  it('every badge icon from the web exists in the native font', () => {
    for (const b of BADGES) expect(hasIcon(b.icon)).toBe(true);
    expect(hasIcon('fa-solid fa-definitely-not-a-glyph')).toBe(false);
  });
});

describe('formatBadgeCount', () => {
  it('caps at max with a plus', () => {
    expect(formatBadgeCount(5)).toBe('5');
    expect(formatBadgeCount(99)).toBe('99');
    expect(formatBadgeCount(100)).toBe('99+');
    expect(formatBadgeCount(1500, 999)).toBe('999+');
  });
  it('clamps nonsense', () => {
    expect(formatBadgeCount(-3)).toBe('0');
    expect(formatBadgeCount(2.7)).toBe('2');
  });
});

describe('avatarInitial', () => {
  it('takes the first code point, uppercased', () => {
    expect(avatarInitial('bryden')).toBe('B');
    expect(avatarInitial('  @alice')).toBe('A');
    expect(avatarInitial('😀 smile')).toBe('😀');
    expect(avatarInitial('')).toBe('?');
    expect(avatarInitial(undefined)).toBe('?');
  });
});

describe('snapToStep', () => {
  it('snaps and clamps', () => {
    expect(snapToStep(0.34, 0, 1, 0.1)).toBe(0.3);
    expect(snapToStep(57, 0, 200, 5)).toBe(55);
    expect(snapToStep(-10, 0, 200, 5)).toBe(0);
    expect(snapToStep(999, 0, 200, 5)).toBe(200);
    expect(snapToStep(3, 5, 5, 1)).toBe(5);
  });
});

describe('presence', () => {
  it('normalises unknown statuses to offline', () => {
    expect(normalizePresence('idle')).toBe('idle');
    expect(normalizePresence('away')).toBe('offline');
    expect(normalizePresence(undefined)).toBe('offline');
  });
  it('labels with the web strings', () => {
    expect(presenceLabel('dnd')).toBe('Do Not Disturb');
    expect(presenceLabel('streaming')).toBe('Sharing their screen');
  });
});

describe('cleanEntries', () => {
  it('drops falsy entries and stray separators', () => {
    const entries: ActionSheetEntry[] = ['separator', { label: 'A' }, false, 'separator', 'separator', null, { label: 'B' }, 'separator'];
    expect(cleanEntries(entries)).toEqual([{ label: 'A' }, 'separator', { label: 'B' }]);
  });

  it("accepts the web's ContextMenuItem arrays as they are", () => {
    // Type-level: this must compile.
    const items: ContextMenuItem[] = [{ label: 'Copy ID', icon: 'fa-copy', onClick: () => undefined }];
    const entries: readonly ActionSheetEntry[] = items;
    expect(cleanEntries(entries)).toHaveLength(1);
  });
});

describe('hitSlopFor', () => {
  it('grows small targets to 44pt', () => {
    expect(hitSlopFor(24, 24)).toEqual({ top: 10, bottom: 10, left: 10, right: 10 });
    expect(hitSlopFor(44)).toBeUndefined();
  });
});
