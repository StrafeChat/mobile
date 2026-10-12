/**
 * The last keyboard height, per orientation, so the expression panel can open at the
 * keyboard's size even when the keyboard is down (Discord's panel does the same): swapping
 * to the keyboard afterwards then lands it in exactly the panel's space.
 *
 * Kept in appStorage (device-local bookkeeping, not a preference). Until the keyboard has been
 * seen in an orientation, the panel takes 40 % of the window - near a phone keyboard's size.
 */
import { appStorage } from '@/platform/storage';

export type Orientation = 'portrait' | 'landscape';

const KEY = 'composer.keyboardHeight.';
const DEFAULT_SHARE = 0.4;
/** Below this the panel can't show a search field, a few rows and the category bar. */
export const MIN_PANEL_HEIGHT = 220;
/** A keyboard taller than this share of the window is a floating or split oddity. */
const MAX_SHARE = 0.7;

export function orientationOf(window: { width: number; height: number }): Orientation {
  return window.width > window.height ? 'landscape' : 'portrait';
}

function clampHeight(h: number, windowHeight: number): number {
  return Math.round(Math.max(Math.min(MIN_PANEL_HEIGHT, windowHeight * 0.5), Math.min(h, windowHeight * MAX_SHARE)));
}

/** The height the panel opens at when the keyboard is down. */
export function rememberedKeyboardHeight(window: { width: number; height: number }): number {
  let saved: number | undefined;
  try {
    saved = appStorage.getNumber(KEY + orientationOf(window));
  } catch {
    saved = undefined;
  }
  return clampHeight(saved && saved > 0 ? saved : window.height * DEFAULT_SHARE, window.height);
}

/** Note a fully shown keyboard's height. Tiny heights (a hardware keyboard's bar) are ignored. */
export function rememberKeyboardHeight(height: number, window: { width: number; height: number }): void {
  if (!(height >= 120)) return;
  try {
    appStorage.set(KEY + orientationOf(window), Math.round(height));
  } catch {
    // storage unavailable: the default is used next time
  }
}

export { clampHeight as clampPanelHeight };
