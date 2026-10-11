/**
 * Everything the shared web code expects of its environment, installed before any of it
 * loads. Imported first thing by the app entry (src/app/_layout.tsx imports it at the top).
 * Order matters: crypto first (uuid-style ids are made at module load), storage next (stores
 * read their persisted state at module load), then window/location.
 */
import './crypto';
import 'react-native-url-polyfill/auto';
import './localStorage';
import './window';
import './env';
// Last: i18n reads the stored language (localStorage) and the device's (navigator).
import '../i18n';

const g = globalThis as unknown as Record<string, unknown>;

// structuredClone (Hermes has it in recent versions; keep a fallback for plain data).
if (typeof g.structuredClone !== 'function') {
  g.structuredClone = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
}

// queueMicrotask is present in Hermes; requestIdleCallback is not.
if (typeof g.requestIdleCallback !== 'function') {
  g.requestIdleCallback = (cb: (d: { didTimeout: boolean; timeRemaining: () => number }) => void) =>
    setTimeout(() => cb({ didTimeout: false, timeRemaining: () => 8 }), 1) as unknown as number;
  g.cancelIdleCallback = (id: number) => clearTimeout(id);
}
