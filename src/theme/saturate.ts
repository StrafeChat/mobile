/**
 * Desaturate a colour toward its luminance: `amount` 0..100 is the Accessibility saturation
 * slider (100 = untouched), the same as CSS `saturate(amount%)`. For a theme to apply the
 * setting app-wide (the web filters #root; React Native has no global filter).
 */
export function saturateHex(hex: string, amount: number): string {
  const p = Math.max(0, Math.min(100, amount)) / 100;
  if (p >= 1) return hex;
  let s = hex.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) s = s.split('').map((ch) => ch + ch).join('');
  if (!/^[0-9a-f]{6}$/.test(s)) return hex;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  // The CSS filter's matrix (Filter Effects spec, feColorMatrix saturate).
  const nr = (0.213 + 0.787 * p) * r + (0.715 - 0.715 * p) * g + (0.072 - 0.072 * p) * b;
  const ng = (0.213 - 0.213 * p) * r + (0.715 + 0.285 * p) * g + (0.072 - 0.072 * p) * b;
  const nb = (0.213 - 0.213 * p) * r + (0.715 - 0.715 * p) * g + (0.072 + 0.928 * p) * b;
  const to = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${to(nr)}${to(ng)}${to(nb)}`;
}
