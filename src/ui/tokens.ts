/**
 * Layout constants shared by the design system: spacing, touch targets and the web's chrome
 * sizes (tokens.css / appChrome.ts) that are not part of a theme.
 *
 * Colours, radii, type scale and density are *not* here - they come from the theme
 * (`useTheme()`), because the user changes them.
 */
import type { Insets } from 'react-native';

/** 4-pt spacing scale (the web's Tailwind steps that the components actually use). */
export const space = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Minimum touch target, iOS HIG / Material (44 pt / 48 dp; 44 satisfies both in practice). */
export const MIN_TOUCH = 44;

/** Header bar height on phones (the web's header is 48 px, 56 px under 640 px). */
export const HEADER_HEIGHT = 56;

/** Widest a sheet or dialog gets on a tablet before it floats centred. */
export const SHEET_MAX_WIDTH = 520;
export const DIALOG_MAX_WIDTH = 420;

/** Width at which the app lays panels side by side (matches the shell's breakpoint). */
export const WIDE_BREAKPOINT = 768;

/**
 * hitSlop that grows a `width` x `height` control to at least MIN_TOUCH in each direction,
 * so a 24 px toggle or a 28 px icon button is still easy to hit without looking bigger.
 */
export function hitSlopFor(width: number, height: number = width): Insets | undefined {
  const dx = Math.max(0, Math.ceil((MIN_TOUCH - width) / 2));
  const dy = Math.max(0, Math.ceil((MIN_TOUCH - height) / 2));
  if (!dx && !dy) return undefined;
  return { top: dy, bottom: dy, left: dx, right: dx };
}

/** Sheets and dialogs use the web's rounded-3xl, which the theme's radius scale stops short of. */
export function largeRadius(xl: number): number {
  return Math.round(xl * 1.5);
}
