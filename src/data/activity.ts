/**
 * Game activity ("Playing X") as the app shows it. Display only: the phone never detects or
 * reports a game - that is the desktop shell's (the web's stores/activity.ts, started only from
 * desktop/boot, which the app replaces with an inert module; desktop/native's gamesAvailable()
 * answers false here).
 *
 * The rules are the web's own (stores/presence activityOf, customStatusOf; lib/activity):
 * - an activity comes from the live presence store only, never from the presence a member
 *   row or room participant embeds (a snapshot from when the list was fetched - falling back
 *   to it would bring a finished game back);
 * - only while the person is online, idle or dnd: offline and invisible never show one;
 * - on one-line rows (member list, PM list, friends, the PM header) a custom status beats it;
 *   the profile sheet and the full profile show it as its own card, with how long;
 * - the name is someone else's text, shown as plain text: never linkified, never markdown,
 *   emoji or mentions.
 */
import { batch, untrack } from 'solid-js';
import { activityOf, dropActivity, isPresentStatus, presence, type Activity, type UserPresence } from '@web/stores/presence';
import { relationshipType, RelType } from '@web/stores/relationships';
import { auth } from '@web/stores/auth';
import { formatActivityDuration } from '@web/lib/activity';
import { currentLanguage, t } from '@web/i18n/t';
import { deepEqual, useDerived } from './derived';

export type { Activity };

/** A plain copy of an activity (never a store proxy), or undefined. */
export function plainActivity(a: Activity | null | undefined): Activity | undefined {
  if (!a) return undefined;
  return a.started_at ? { type: a.type, name: a.name, started_at: a.started_at } : { type: a.type, name: a.name };
}

/** A presence's `activities`, copied plain (the whitelist copies of a presence carry them). */
export function plainActivities(list: readonly Activity[] | null | undefined): Activity[] | undefined {
  if (!list?.length) return undefined;
  const out: Activity[] = [];
  for (const a of list) {
    const p = plainActivity(a);
    if (p) out.push(p);
  }
  return out.length ? out : undefined;
}

/** What the user is playing, while they are around (the web's activityOf), as plain data. */
export function activityFor(userId: string | null | undefined): Activity | undefined {
  return userId ? plainActivity(activityOf(userId)) : undefined;
}

/** Re-renders when that user's game starts, changes or ends, or they go offline/invisible. */
export function useActivity(userId: string | null | undefined): Activity | undefined {
  return useDerived(`activity:${userId ?? ''}`, () => activityFor(userId), deepEqual);
}

/** Stands in for the name while a sentence is translated (SentenceWithName's slot). */
const NAME_SLOT = '\u0000';

/**
 * "Playing <name>" in the app's language - the sentence SentenceWithName sets the name in bold
 * inside, and the plain string for accessibility labels and the PM header. The name never goes
 * through the translator: the sentence is translated around a placeholder and the name put in
 * its place, so nothing in it (a `{{...}}`, a `$t(...)`) is ever read as anything but text.
 */
export function playingLabel(name: string): string {
  const s = t('activity.playing', { name: NAME_SLOT });
  return s.includes(NAME_SLOT) ? s.split(NAME_SLOT).join(name) : `${s} ${name}`;
}

/**
 * "for 1 hr 2 min" since `startedAt` (unix ms), in the app's language; '' when the start is
 * unknown. The duration is the web's formatActivityDuration, which falls back to "1:02" on an
 * engine without unit formatting (Hermes builds without it) and joins the parts with a space
 * where Intl.ListFormat is missing (Hermes has none).
 */
export function activityElapsedLabel(startedAt: number | undefined, now: number, locale: string = currentLanguage()): string {
  if (!startedAt) return '';
  return t('activity.elapsed', { duration: formatActivityDuration(now - startedAt, locale) });
}

// First strong isolate ... pop directional isolate: what <bdi> does on the web, and what
// ui/SentenceWithName wraps the name in where it draws the line itself.
const FSI = String.fromCodePoint(0x2068);
const PDI = String.fromCodePoint(0x2069);

/**
 * The line under a PM's other person (the conversation header, its info sheet), from their
 * entry in the presence store (presenceOf): while they are around, their custom status, else
 * what they are playing; otherwise - and when they are offline or invisible - the status label.
 * Drawn as one plain string, so the game's name is isolated in it: a right-to-left name cannot
 * reorder the words around it.
 */
export function pmStatusLine(p: UserPresence, statusLabel: (status: UserPresence['status']) => string): string {
  if (isPresentStatus(p.status)) {
    if (p.custom_status) return p.custom_status;
    const game = p.activities?.[0]?.name;
    if (game) return playingLabel(`${FSI}${game}${PDI}`);
  }
  return statusLabel(p.status);
}

/**
 * After the socket comes back (READY): drop every game known only through a member list or a
 * PRESENCE_UPDATE. One that ended while the socket was down sends no event, and member lists are
 * only marked stale on reconnect, not refetched - the web keeps those games until the list's next
 * load, which on the phone (it reconnects on nearly every resume) left an ended game ticking for
 * hours. Friends keep theirs (READY just rewrote them) and so do we; the others come back with the
 * next member list load or PRESENCE_UPDATE.
 */
export function dropActivitiesAfterReconnect(): void {
  untrack(() => {
    const self = auth.user?.id;
    batch(() => {
      for (const id of Object.keys(presence.byUser)) {
        if (id === self || presence.byUser[id]?.activities === undefined) continue;
        if (relationshipType(id) === RelType.Friend) continue;
        dropActivity(id);
      }
    });
  });
}
