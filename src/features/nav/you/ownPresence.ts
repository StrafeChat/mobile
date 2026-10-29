/**
 * Changing your own status and custom status (UserArea / MobileYouPanel), saved with
 * PATCH /users/@me {presence}. Unlike the web, a failure says so, and clearing the custom
 * status really clears it on the server.
 *
 * The status goes through the web's own setOwnStatus (stores/presence): instant between
 * online, idle and dnd, rolled back if the save fails - but a change to or from invisible shows
 * only once the server has it. The game a desktop reports follows our own status, and applied
 * early, its clear (or, leaving invisible, its re-send) reached the gateway before the new
 * status was saved, which fanned it out with the old status. Only the newest change applies or
 * rolls back.
 *
 * Neither write here carries an activity, so neither touches the one the store holds (the
 * web's setUserPresence leaves `activities` alone without `{ activities: true }`): a custom
 * status edit never clears what one of your desktops says you are playing.
 */
import { t } from '@web/i18n/t';
import { patchMe } from '@web/api/users';
import { auth } from '@web/stores/auth';
import { presence, setOwnStatus as saveOwnStatus, setUserPresence, type UserPresence } from '@web/stores/presence';
import { plainActivities } from '@/data/activity';
import { toast } from '@/ui';

/** The server's limit for a custom status (the web input's maxLength). */
export const CUSTOM_STATUS_MAX = 128;

export const STATUS_OPTIONS: readonly UserPresence['status'][] = ['online', 'idle', 'dnd', 'invisible'];

/** A plain copy of our own entry, every field of it. */
function current(uid: string): UserPresence {
  const p = presence.byUser[uid];
  const activities = plainActivities(p?.activities);
  return {
    status: p?.status ?? 'offline',
    ...(p?.custom_status ? { custom_status: p.custom_status } : {}),
    ...(activities ? { activities } : {}),
  };
}

/** Put the custom status back. The status stays what it is now: a status change saved
 * meanwhile (one to invisible lands only when the server confirms it) is not this one's to
 * undo. Passing custom_status: undefined deletes it from the store entry (Solid's merge). */
function restoreCustomStatus(uid: string, prev: UserPresence): void {
  setUserPresence(uid, { status: presence.byUser[uid]?.status ?? prev.status, custom_status: prev.custom_status });
}

/** Set Online / Idle / DND / Invisible. Resolves false (the web store has rolled back, when
 * it showed the change early) when the save fails. */
export async function setOwnStatus(status: UserPresence['status']): Promise<boolean> {
  if (!auth.user?.id) return false;
  try {
    await saveOwnStatus(status);
    return true;
  } catch {
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
    // Clearing sends an empty string: the server leaves a missing field as it was, so the
    // web's `undefined` (dropped from the JSON) never clears it and the old one comes back.
    await patchMe({ presence: { custom_status: next } });
    return true;
  } catch {
    restoreCustomStatus(uid, prev);
    toast.error(t('mobile.nav.customStatusFailed'));
    return false;
  }
}
