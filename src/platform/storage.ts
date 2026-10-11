/**
 * Synchronous key/value storage backed by MMKV.
 *
 * The web client's stores persist through `localStorage`, synchronously, and rely on reading
 * it back during module initialisation (the session token, theme, last-visited room...).
 * AsyncStorage could not stand in for that; MMKV is synchronous and native, so the shim in
 * `shims/localStorage.ts` exposes it under the same `Storage` interface the stores expect.
 */
import { createMMKV } from 'react-native-mmkv';

/** The web stores' `localStorage`. */
export const webStorage = createMMKV({ id: 'strafe.localStorage' });

/** Mobile-only preferences and bookkeeping, kept apart from the web stores' keys. */
export const appStorage = createMMKV({ id: 'strafe.app' });
