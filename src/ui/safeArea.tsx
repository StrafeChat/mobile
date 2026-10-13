/**
 * The safe area, for what the per-screen insets do not cover.
 *
 * - Left and right only matter in landscape (the notch or Dynamic Island, and Android's
 *   3-button navigation bar, which moves to the side). They are applied once per screen
 *   container (the route groups' Stack contentStyle) and by the hosts that draw outside it
 *   (sheets, toasts); screens themselves pad only their top and bottom.
 * - The window's own insets (useWindowInsets) for what is drawn over the whole window from
 *   wherever it is declared - a sheet, portaled to the root. A part of the tree may be handed
 *   other insets than the window's (the shell gives the in-call bar the bottom one, and the
 *   shell none), which must not reach a sheet opened from inside it.
 */
import { createContext, useContext, type ReactNode } from 'react';
import { I18nManager } from 'react-native';
import { useSafeAreaInsets, type EdgeInsets } from 'react-native-safe-area-context';

export interface HorizontalInsets {
  /** Physical left, whatever the layout direction. */
  left: number;
  /** Physical right. */
  right: number;
}

/**
 * The insets as left / right style values. The insets are physical sides, while React Native
 * swaps left and right styles in a right-to-left layout (doLeftAndRightSwapInRTL, on by
 * default), so in Arabic they are handed over swapped, to land on the right side again.
 */
export function physicalSides(insets: HorizontalInsets, rtl: boolean = I18nManager.isRTL && I18nManager.doLeftAndRightSwapInRTL): HorizontalInsets {
  return rtl ? { left: insets.right, right: insets.left } : { left: insets.left, right: insets.right };
}

/** Padding that keeps content clear of the cutout and a side navigation bar. */
export function useHorizontalSafePadding(): { paddingLeft: number; paddingRight: number } {
  const sides = physicalSides(useSafeAreaInsets());
  return { paddingLeft: sides.left, paddingRight: sides.right };
}

const WindowInsetsContext = createContext<EdgeInsets | null>(null);

/** Records the window's insets for useWindowInsets(). Mounted once, by UiProvider. */
export function WindowInsetsProvider({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets();
  return <WindowInsetsContext.Provider value={insets}>{children}</WindowInsetsContext.Provider>;
}

/** The window's safe-area insets, whatever a part of the tree was handed instead. */
export function useWindowInsets(): EdgeInsets {
  const local = useSafeAreaInsets();
  return useContext(WindowInsetsContext) ?? local;
}
