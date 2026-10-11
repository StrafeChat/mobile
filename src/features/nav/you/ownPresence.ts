/**
 * Changing your own status and custom status (UserArea / MobileYouPanel): optimistic through
 * setUserPresence, then PATCH /users/@me {presence}. Unlike the web, a failed save puts the
 * previous value back (the web leaves the optimistic one showing) and says so.
 */
import { t } from '@web/i18n/t';
import { patchMe } from '@web/api/users';
import { auth } from '@web/stores/auth';
import { presence, setUserPresence, type UserPresence } from '@web/stores/presence';
import { toast } from '@/ui';

/** The server's limit for a custom status (the web input's maxLength). */
export const CUSTOM_STATUS_MAX = 128;

export const STATUS_OPTIONS: readonly UserPresence['status'][] = ['online', 'idle', 'dnd', 'invisible'];

function current(uid: string): UserPresence {
  const p = presence.byUser[uid];
  return { status: p?.status ?? 'offline', ...(p?.custom_status ? { custom_status: p.custom_status } : {}) };
}

function restore(uid: string, prev: UserPresence): void {
  // Passing custom_status: undefined deletes it from the store entry (Solid's merge).
  setUserPresence(uid, { status: prev.status, custom_status: prev.custom_status });
}

/** Set Online / Idle / DND / Invisible. Resolves false (and rolls back) when the save fails. */
export async function setOwnStatus(status: UserPresence['status']): Promise<boolean> {
  const uid = auth.user?.id;
  if (!uid) return false;
  const prev = current(uid);
  setUserPresence(uid, { ...prev, status });
  try {
    await patchMe({ presence: { status } });
    return true;
  } catch {
    restore(uid, prev);
    toast.error(t('mobile.nav.statusFailed'));
    return false;
  }
}

/** Set (or, with an empty string, clear) the custom status. Rolls back on failure. */
export async function setOwnCustomStatus(text: string): Promise<boolean> {
  const uid = auth.user?.id;
  if (!uid) return false;
  const next = text.trim().slice(0, CUSTOM_STATUS_MAX);
  const prev = current(uid);
  if ((prev.custom_status ?? '') === next) return true;
  setUserPresence(uid, { status: presence.byUser[uid]?.status ?? 'online', custom_status: next || undefined });
  try {
    await patchMe({ presence: { custom_status: next || undefined } });
    return true;
  } catch {
    restore(uid, prev);
    toast.error(t('mobile.nav.customStatusFailed'));
    return false;
  }
}
