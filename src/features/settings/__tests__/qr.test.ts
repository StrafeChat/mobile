/// <reference types="jest" />
import { encodeQr, qrPath, utf8Bytes } from '../qr';

/**
 * An independent encoder to check against, when the package is present (it arrives with the
 * Expo CLI; the app does not depend on it). Its mask choice may differ, so the comparison
 * forces ours to each mask and requires one to match module for module.
 */
function reference(): ((text: string, ec: number) => Uint8Array) | null {
  try {
     
    return require('toqr').toQR;
  } catch {
    return null;
  }
}

const EC_BITS = { L: 1, M: 0, Q: 3, H: 2 } as const;

describe('encodeQr', () => {
  it('encodes UTF-8', () => {
    expect(utf8Bytes('a€😀')).toEqual([0x61, 0xe2, 0x82, 0xac, 0xf0, 0x9f, 0x98, 0x80]);
  });

  it('picks the smallest version that fits', () => {
    expect(encodeQr('hi', 'M').version).toBe(1);
    expect(encodeQr('hi', 'M').size).toBe(21);
    const url = 'otpauth://totp/Strafe:someone@example.org?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Strafe';
    const m = encodeQr(url, 'M');
    expect(m.size).toBe(m.version * 4 + 17);
    expect(m.version).toBeGreaterThanOrEqual(5);
  });

  it('draws the three finder patterns', () => {
    const { modules, size } = encodeQr('finder', 'M');
    for (const [x0, y0] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ] as const) {
      for (let i = 0; i < 7; i++) {
        expect(modules[y0]![x0 + i]).toBe(true);
        expect(modules[y0 + 6]![x0 + i]).toBe(true);
        expect(modules[y0 + i]![x0]).toBe(true);
        expect(modules[y0 + i]![x0 + 6]).toBe(true);
      }
      expect(modules[y0 + 1]![x0 + 1]).toBe(false);
      expect(modules[y0 + 3]![x0 + 3]).toBe(true);
    }
  });

  const ref = reference();
  (ref ? it : it.skip).each([
    ['hello', 'M'],
    ['https://strafe.chat', 'L'],
    ['otpauth://totp/Strafe:someone?secret=JBSWY3DPEHPK3PXP&issuer=Strafe', 'M'],
    ['otpauth://totp/a.very.long.instance.example:someone.with.a.long.name%40example.org?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=a.very.long.instance.example&algorithm=SHA1&digits=6&period=30', 'M'],
    ['Ünïcödé ✓ 😀', 'Q'],
    ['x'.repeat(300), 'H'],
  ] as const)('matches an independent encoder for %s (%s)', (text, ecc) => {
    const theirs = ref!(text, EC_BITS[ecc]);
    const size = Math.round(Math.sqrt(theirs.length));
    const matches = [0, 1, 2, 3, 4, 5, 6, 7].some((mask) => {
      const ours = encodeQr(text, ecc, { mask });
      if (ours.size !== size) return false;
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (ours.modules[y]![x] !== (theirs[y * size + x] === 1)) return false;
      return true;
    });
    expect(matches).toBe(true);
  });

  it('builds an SVG path of unit squares', () => {
    const m = encodeQr('a', 'L');
    const dark = m.modules.flat().filter(Boolean).length;
    expect(qrPath(m, 2).match(/M/g)?.length).toBe(dark);
    expect(qrPath(m, 2).startsWith('M2 2h1v1h-1z')).toBe(true);
  });
});
