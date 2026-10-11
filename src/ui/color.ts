/**
 * Colour helpers for the design system.
 *
 * The web paints most of its states as a theme token at some opacity (`bg-primary/15` for a
 * selected row, `bg-destructive/10` for a danger press, `bg-muted-foreground/50` for the
 * offline dot). React Native has no `/15` modifier, so components derive those tints here from
 * the live theme colour instead of hard-coding a second palette - a custom theme then tints
 * correctly with no extra work.
 */

const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const HEX8 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;
const RGB = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i;

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb()` or `rgba()`; null for anything else. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim();
  let m: RegExpExecArray | null;
  if ((m = HEX6.exec(s))) return { r: parseInt(m[1]!, 16), g: parseInt(m[2]!, 16), b: parseInt(m[3]!, 16), a: 1 };
  if ((m = HEX3.exec(s))) {
    return { r: parseInt(m[1]! + m[1]!, 16), g: parseInt(m[2]! + m[2]!, 16), b: parseInt(m[3]! + m[3]!, 16), a: 1 };
  }
  if ((m = HEX8.exec(s))) {
    return {
      r: parseInt(m[1]!, 16),
      g: parseInt(m[2]!, 16),
      b: parseInt(m[3]!, 16),
      a: parseInt(m[4]!, 16) / 255,
    };
  }
  if ((m = RGB.exec(s))) {
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]), a: m[4] === undefined ? 1 : Number(m[4]) };
  }
  return null;
}

/**
 * `color` at `alpha` opacity (multiplied with any alpha it already has), as `rgba()`.
 * An unparseable colour (a named colour, say) comes back unchanged rather than invisible.
 */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  if (!c) return color;
  const a = Math.round(Math.max(0, Math.min(1, c.a * alpha)) * 1000) / 1000;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${a})`;
}

/**
 * Relative luminance (WCAG), 0 = black, 1 = white. Used to pick readable text on a colour
 * that is data rather than theme (a role colour, a badge accent).
 */
export function luminance(color: string): number {
  const c = parseColor(color);
  if (!c) return 0;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

/**
 * A near-white that reads on the black scrims laid over imagery (overlay buttons, video
 * tiles, the media viewer): the theme's lightest neutral - foreground on a dark theme,
 * background on a light one - so it stays a theme colour without a literal.
 */
export function onScrim(theme: { dark: boolean; colors: { foreground: string; background: string } }): string {
  return theme.dark ? theme.colors.foreground : theme.colors.background;
}
