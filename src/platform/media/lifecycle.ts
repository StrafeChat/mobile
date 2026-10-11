/**
 * Media housekeeping tied to the app's and the session's lifetime.
 *
 * - **At start-up** the per-session directories are emptied: ciphertext that never finished
 *   uploading or decrypting, re-typed clips, shared copies, recordings nobody sent. None of it
 *   is referenced after a restart (drafts are not persisted). Decrypted attachments stay.
 * - **At sign-out** - the session token going away or changing - everything goes, decrypted
 *   attachments included: the cache belongs to the account that decrypted it. A start-up with
 *   no session token at all clears it too, in case the app was killed between signing out and
 *   finishing the wipe.
 * - **On an account switch** (a restart into another signed-in account) the same: the cache
 *   remembers whose it is and is wiped when a different user signs in.
 *
 * `installMediaLifecycle()` is called once at boot (idempotent).
 */
import { createComputed, createRoot } from 'solid-js';
import { auth } from '@web/stores/auth';
import { appStorage } from '../storage';
import { clearAttachmentCache } from './attachmentCache';
import { clearTypedClips } from '../overrides/media/clipFormat';
import { wipeMediaDirectory } from './files';

const OWNER_KEY = 'media.cacheOwner';
const SESSION_DIRS = ['clips', 'outgoing', 'incoming', 'export', 'recordings'] as const;

let installed = false;

function sweepSessionFiles(): void {
  clearTypedClips();
  for (const dir of SESSION_DIRS) wipeMediaDirectory(dir);
}

/** Remove everything the media layer has written: decrypted files, clips, temp copies. */
export function clearMediaCaches(): void {
  clearAttachmentCache();
  sweepSessionFiles();
}

export function installMediaLifecycle(): void {
  if (installed) return;
  installed = true;

  let hasToken = false;
  try {
    hasToken = !!localStorage.getItem('session_token');
  } catch {
    hasToken = false;
  }
  if (hasToken) {
    sweepSessionFiles();
  } else {
    clearMediaCaches();
    appStorage.remove(OWNER_KEY);
  }

  createRoot(() => {
    // Own bookkeeping of the previous token rather than on({defer}), whose first real run is
    // handed an undefined previous value.
    let previousToken: string | null = null;
    createComputed(() => {
      const token = auth.token;
      if (previousToken && token !== previousToken) {
        clearMediaCaches();
        appStorage.remove(OWNER_KEY);
      }
      previousToken = token;
    });
    createComputed(() => {
      const userId = auth.user?.id;
      if (!userId) return;
      const owner = appStorage.getString(OWNER_KEY);
      if (owner && owner !== userId) clearMediaCaches();
      if (owner !== userId) appStorage.set(OWNER_KEY, userId);
    });
  });
}
