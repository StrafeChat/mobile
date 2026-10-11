/**
 * Build-time globals the web code reads, and the device language for its i18n detection.
 * A separate module so it runs (imports are hoisted) before src/platform/i18n.ts loads.
 */
import Constants from 'expo-constants';
import { getLocales } from 'expo-localization';

const g = globalThis as unknown as Record<string, unknown>;

// Vite's import.meta.env, as the Babel transform in babel/import-meta-env.js rewrites it.
g.__STRAFE_ENV__ = {
  DEV: __DEV__,
  PROD: !__DEV__,
  MODE: __DEV__ ? 'development' : 'production',
  SSR: false,
  BASE_URL: '/',
};
// Vite defines in the web build.
g.__BUILD_ID__ = 'mobile';
g.__APP_VERSION__ = Constants.expoConfig?.version ?? '0.0.0';

try {
  const tags = getLocales()
    .map((l) => l.languageTag)
    .filter(Boolean);
  if (tags.length) {
    const nav = g.navigator as Record<string, unknown>;
    nav.language = tags[0];
    nav.languages = tags;
  }
} catch {
  /* keep the defaults */
}
