/**
 * PresenceDot: a user's status, as the web colours it - online in the brand colour, idle
 * yellow, do-not-disturb red, offline/invisible a faded grey - plus `streaming` (sharing their
 * screen) in the LIVE red the voice UI uses.
 *
 * Colour alone fails colour-blind users, and a phone has no hover title to fall back on, so
 * each status also has a shape (Discord's): idle is a crescent, do-not-disturb has a bar,
 * offline is a ring. The cut-outs are drawn in `ringColor` - the surface the dot sits on -
 * which is also the ring around the dot that separates it from an avatar.
 *
 * Pure: give it a status. `UserPresenceDot` (UserPresence.tsx) reads the shared presence
 * store for a user id, like the web's PresenceDot.
 */
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { t } from '@web/i18n/t';
import { useTheme, type Theme } from '@/theme';
import { withAlpha } from './color';

export type PresenceStatus = 'online' | 'idle' | 'dnd' | 'offline' | 'invisible' | 'streaming';

const KNOWN = new Set<PresenceStatus>(['online', 'idle', 'dnd', 'offline', 'invisible', 'streaming']);

/** Anything unknown reads as offline, as on the web. */
export function normalizePresence(status: string | null | undefined): PresenceStatus {
  return status && KNOWN.has(status as PresenceStatus) ? (status as PresenceStatus) : 'offline';
}

/** Localised label (the web's presence.* keys; streaming is the voice UI's). */
export function presenceLabel(status: string | null | undefined): string {
  const s = normalizePresence(status);
  return s === 'streaming' ? t('voice.status.streaming') : t(`presence.${s}`);
}

export function presenceColor(theme: Theme, status: string | null | undefined): string {
  switch (normalizePresence(status)) {
    case 'online':
      return theme.colors.primary;
    case 'idle':
      return theme.colors.idle;
    case 'dnd':
      return theme.colors.dnd;
    case 'streaming':
      return theme.colors.destructive;
    case 'offline':
    case 'invisible':
      return withAlpha(theme.colors.mutedForeground, 0.5);
  }
}

export interface PresenceDotProps {
  status: PresenceStatus | string | null | undefined;
  /** Diameter of the coloured dot, without the ring. */
  size?: number;
  /** Surface behind the dot (ring + cut-outs). Defaults to the page background. */
  ringColor?: string;
  /** Draw no ring (a dot inline with text). */
  bare?: boolean;
  /** Announce the status (a dot standing alone); otherwise decorative. */
  announce?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function PresenceDot({ status, size = 10, ringColor, bare, announce, style, testID }: PresenceDotProps) {
  const theme = useTheme();
  const s = normalizePresence(status);
  const fill = presenceColor(theme, s);
  const cut = ringColor ?? theme.colors.background;
  const ring = bare ? 0 : Math.max(2, Math.round(size * 0.22));
  const outer = size + ring * 2;

  let cutout: ReactNode = null;
  if (s === 'idle') {
    // Crescent: a surface-coloured disc over the top-left of the dot.
    const d = size * 0.62;
    cutout = (
      <View
        style={{ position: 'absolute', width: d, height: d, borderRadius: d / 2, top: -size * 0.06, left: -size * 0.06, backgroundColor: cut }}
      />
    );
  } else if (s === 'dnd') {
    const w = size * 0.6;
    const h = Math.max(1.5, size * 0.2);
    cutout = (
      <View style={{ position: 'absolute', width: w, height: h, borderRadius: h / 2, top: (size - h) / 2, left: (size - w) / 2, backgroundColor: cut }} />
    );
  } else if (s === 'offline' || s === 'invisible') {
    const d = size * 0.5;
    cutout = (
      <View style={{ position: 'absolute', width: d, height: d, borderRadius: d / 2, top: (size - d) / 2, left: (size - d) / 2, backgroundColor: cut }} />
    );
  }

  return (
    <View
      testID={testID}
      {...(announce
        ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: presenceLabel(s) }
        : { accessible: false, accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
      style={[
        {
          width: outer,
          height: outer,
          borderRadius: outer / 2,
          backgroundColor: bare ? 'transparent' : cut,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: fill, overflow: 'hidden' }}>{cutout}</View>
    </View>
  );
}
