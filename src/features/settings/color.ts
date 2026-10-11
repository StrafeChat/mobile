/**
 * Colour helpers for the role colour and theme editors: the web's role-colour int <-> hex
 * conversion (SpaceSettingsModal's intToHex/hexToInt) and HSV for the on-screen picker that
 * stands in for the browser's <input type="color">. Pure functions, unit tested.
 */

/** Role colour (24-bit RGB int) as #rrggbb. */
export function intToHex(c: number): string {
  const u = c >>> 0;
  return `#${(u & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** #rrggbb (or rrggbb) to the role colour int; 0 for anything unparsable. */
export function hexToInt(h: string): number {
  const s = h.trim().replace(/^#/, '');
  const n = parseInt(s, 16);
  return Number.isNaN(n) ? 0 : n & 0xffffff;
}

export interface Hsv {
  /** 0..360 */
  h: number;
  /** 0..1 */
  s: number;
  /** 0..1 */
  v: number;
}

/** #rgb / #rrggbb to HSV (black for anything else). */
export function hexToHsv(hex: string): Hsv {
  let s = hex.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-f]{6}$/.test(s)) return { h: 0, s: 0, v: 0 };
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}

/** HSV to #rrggbb. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const hh = (((h % 360) + 360) % 360) / 60;
  const c = v * s;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const m = v - c;
  let rgb: [number, number, number];
  if (hh < 1) rgb = [c, x, 0];
  else if (hh < 2) rgb = [x, c, 0];
  else if (hh < 3) rgb = [0, c, x];
  else if (hh < 4) rgb = [0, x, c];
  else if (hh < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const to = (n: number) =>
    Math.round((n + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(rgb[0])}${to(rgb[1])}${to(rgb[2])}`;
}

/** Discord's default role palette (the web's ROLE_COLOR_SWATCHES). */
export const ROLE_COLOR_SWATCHES = [
  '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63',
  '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b',
  '#11806a', '#1f8b4c', '#206694', '#71368a', '#ad1457',
  '#c27c0e', '#a84300', '#992d22', '#979c9f', '#546e7a',
] as const;

export { saturateHex } from '@/theme/saturate';
