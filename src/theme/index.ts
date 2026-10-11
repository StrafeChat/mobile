/**
 * The app's look, straight from the web client's appearance settings.
 *
 * Themes (built-in and custom), font scale, corner style, density and group spacing are the
 * web's `stores/appearance.ts`, unchanged, so a theme made on one client is the same theme on
 * the other and the Appearance settings page edits the same state. This module turns that
 * state into what React Native styles need: hex colours, numeric radii, spacing and type
 * sizes.
 */
import { appearance, activeTheme, type CornerStyle, type FontScale, type UiDensity } from '@web/stores/appearance';
import type { ThemeColors } from '@web/theme/themes';
import { useMemo } from 'react';
import { useSolid } from '@/bridge/solid';

export interface Radii {
  sm: number;
  md: number;
  lg: number;
  xl: number;
  full: number;
}

export interface Theme {
  dark: boolean;
  colors: ThemeColors & {
    /** Status colours the web hardcodes in its utility classes. */
    online: string;
    idle: string;
    dnd: string;
    offline: string;
    mention: string;
    mentionBackground: string;
    link: string;
    warning: string;
    success: string;
    overlay: string;
  };
  radii: Radii;
  /** Multiplier for every font size (Appearance -> Font size). */
  fontScale: number;
  density: UiDensity;
  /** Vertical rhythm of list rows, from the density setting. */
  rowPadding: number;
  messageGroupSpacing: number;
  reduceMotion: boolean;
  font: (size: number) => number;
}

const RADII: Record<CornerStyle, Radii> = {
  sharp: { sm: 4, md: 6, lg: 8, xl: 10, full: 999 },
  soft: { sm: 8, md: 10, lg: 14, xl: 18, full: 999 },
  round: { sm: 12, md: 14, lg: 18, xl: 24, full: 999 },
};

const FONT_SCALE: Record<FontScale, number> = { sm: 0.9375, md: 1, lg: 1.0625 };
const ROW_PADDING: Record<UiDensity, number> = { compact: 4, default: 8, spacious: 12 };

export function buildTheme(input: {
  colors: ThemeColors;
  appearance: 'dark' | 'light';
  fontScale: FontScale;
  corners: CornerStyle;
  uiDensity: UiDensity;
  messageGroupSpacing: number;
  reduceMotion: boolean;
}): Theme {
  const dark = input.appearance === 'dark';
  const scale = FONT_SCALE[input.fontScale] ?? 1;
  return {
    dark,
    colors: {
      ...input.colors,
      online: '#3ba55d',
      idle: '#faa81a',
      dnd: '#ed4245',
      offline: dark ? '#80848e' : '#9aa0a6',
      mention: input.colors.primary,
      mentionBackground: dark ? 'rgba(250, 168, 26, 0.10)' : 'rgba(250, 168, 26, 0.16)',
      link: dark ? '#5aa9f7' : '#1a6fc4',
      warning: '#f0b232',
      success: '#3ba55d',
      overlay: dark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.35)',
    },
    radii: RADII[input.corners] ?? RADII.soft,
    fontScale: scale,
    density: input.uiDensity,
    rowPadding: ROW_PADDING[input.uiDensity] ?? 8,
    messageGroupSpacing: input.messageGroupSpacing,
    reduceMotion: input.reduceMotion,
    font: (size: number) => Math.round(size * scale * 10) / 10,
  };
}

/** The current theme; re-renders when any appearance setting changes. */
export function useTheme(): Theme {
  const s = useSolid(() => {
    const theme = activeTheme();
    return {
      colors: theme.colors,
      appearance: theme.appearance,
      fontScale: appearance.fontScale,
      corners: appearance.corners,
      uiDensity: appearance.uiDensity,
      messageGroupSpacing: appearance.messageGroupSpacing,
      reduceMotion: appearance.reduceMotion,
    };
  });
  // `s` is a snapshot: same object until a setting changes, so this rebuilds only then.
  return useMemo(() => buildTheme(s), [s]);
}

/** For non-React code (navigation theme, status bar). */
export function currentTheme(): Theme {
  const theme = activeTheme();
  return buildTheme({
    colors: theme.colors,
    appearance: theme.appearance,
    fontScale: appearance.fontScale,
    corners: appearance.corners,
    uiDensity: appearance.uiDensity,
    messageGroupSpacing: appearance.messageGroupSpacing,
    reduceMotion: appearance.reduceMotion,
  });
}
