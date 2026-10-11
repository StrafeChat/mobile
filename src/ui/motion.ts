/**
 * Reduced motion: the user's Appearance setting (shared with the web) OR the operating
 * system's accessibility switch. Either one turns off decorative animation - shimmer,
 * sliding toasts, springy toggles - while state changes still happen instantly.
 */
import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { useTheme } from '@/theme';

let osReduceMotion = false;
const listeners = new Set<(v: boolean) => void>();
let watching = false;

function watch(): void {
  if (watching) return;
  watching = true;
  AccessibilityInfo.isReduceMotionEnabled?.()
    .then((v) => set(!!v))
    .catch(() => undefined);
  AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => set(!!v));
}

function set(v: boolean): void {
  if (v === osReduceMotion) return;
  osReduceMotion = v;
  for (const l of [...listeners]) l(v);
}

/** The OS reduce-motion switch, live. */
export function useOsReduceMotion(): boolean {
  const [v, setV] = useState(osReduceMotion);
  useEffect(() => {
    watch();
    listeners.add(setV);
    setV(osReduceMotion);
    return () => {
      listeners.delete(setV);
    };
  }, []);
  return v;
}

/** True when animation should be skipped: app setting or OS setting. */
export function useReduceMotion(): boolean {
  const theme = useTheme();
  const os = useOsReduceMotion();
  return theme.reduceMotion || os;
}
