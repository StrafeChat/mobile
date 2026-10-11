/**
 * Start-up sweep and the sign-out / account-switch wipe.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

import { memoryFs } from './testing/memoryFileSystem';
// Instantiated here, so the per-boot module copies below share the file system and the
// app storage (they outlive a restart); each boot gets its own auth store and lifecycle.
import 'expo-file-system';
import { appStorage } from '../storage';

jest.mock('expo-file-system', () => require('./testing/memoryFileSystem'));
jest.mock('../storage', () => {
  const map = new Map<string, string>();
  return {
    appStorage: {
      getString: (k: string) => map.get(k),
      set: (k: string, v: string) => void map.set(k, v),
      remove: (k: string) => void map.delete(k),
      __map: map,
    },
  };
});
jest.mock('@web/stores/auth', () => {
  const { createStore } = require('solid-js/store');
  const [auth, setAuth] = createStore({ token: null as string | null, user: null as { id: string } | null });
  return { auth, setAuth };
});

type Lifecycle = typeof import('./lifecycle');
type AuthMock = { setAuth: (patch: Record<string, unknown>) => void };

const media = (dir: string) => `${memoryFs.cacheUri}/strafe-media/${dir}`;

function seedFiles(): void {
  memoryFs.put(`${media('decrypted')}/1-abc.png`, 'png');
  memoryFs.put(`${media('outgoing')}/x.bin`, 'ct');
  memoryFs.put(`${media('recordings')}/r.m4a`, 'rec');
  memoryFs.put(`${media('export')}/1-aa/photo.jpg`, 'jpg');
}

let token: string | null = null;

function boot(): { lifecycle: Lifecycle; auth: AuthMock } {
  let lifecycle!: Lifecycle;
  let auth!: AuthMock;
  jest.isolateModules(() => {
    auth = require('@web/stores/auth') as AuthMock;
    lifecycle = require('./lifecycle') as Lifecycle;
  });
  lifecycle.installMediaLifecycle();
  return { lifecycle, auth };
}

beforeEach(() => {
  memoryFs.reset();
  token = 'tok-a';
  Object.defineProperty(globalThis, 'localStorage', {
    value: { getItem: (k: string) => (k === 'session_token' ? token : null) },
    configurable: true,
    writable: true,
  });
  (appStorage as unknown as { __map: Map<string, string> }).__map.clear();
});

describe('installMediaLifecycle', () => {
  it('sweeps session files at start-up but keeps decrypted attachments', () => {
    seedFiles();
    boot();
    expect(memoryFs.filesUnder(`${memoryFs.cacheUri}/strafe-media`)).toEqual([`${media('decrypted')}/1-abc.png`]);
  });

  it('wipes everything when starting signed out', () => {
    seedFiles();
    token = null;
    boot();
    expect(memoryFs.filesUnder(`${memoryFs.cacheUri}/strafe-media`)).toEqual([]);
  });

  it('wipes everything at sign-out', () => {
    const { auth } = boot();
    auth.setAuth({ token: 'tok-a', user: { id: '1' } });
    seedFiles();
    auth.setAuth({ token: null, user: null });
    expect(memoryFs.filesUnder(`${memoryFs.cacheUri}/strafe-media`)).toEqual([]);
  });

  it('wipes the cache when another account signs in after a restart', () => {
    const first = boot();
    first.auth.setAuth({ token: 'tok-a', user: { id: '1' } });
    seedFiles();

    // Restart into account 2 (the stored owner is account 1).
    token = 'tok-b';
    memoryFs.put(`${media('decrypted')}/2-def.png`, 'png');
    const second = boot();
    expect(memoryFs.exists(`${media('decrypted')}/2-def.png`)).toBe(true);
    second.auth.setAuth({ token: 'tok-b', user: { id: '2' } });
    expect(memoryFs.filesUnder(`${memoryFs.cacheUri}/strafe-media`)).toEqual([]);

    // Same account again later: kept.
    memoryFs.put(`${media('decrypted')}/3-ghi.png`, 'png');
    const third = boot();
    third.auth.setAuth({ token: 'tok-b', user: { id: '2' } });
    expect(memoryFs.exists(`${media('decrypted')}/3-ghi.png`)).toBe(true);
  });
});
