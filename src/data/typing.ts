/**
 * Who is typing in a room.
 *
 * Time-dependent: an announcement expires after 10 s with no "stopped" event. The web store's
 * getTypingUserIds reads its `typingVersion` signal, which every add, removal and expiry timer
 * bumps, so the memo below re-runs exactly when the answer can change - nothing here has to
 * poll the clock. Sending (POST /rooms/:id/typing, throttled to once per 6 s) is the
 * composer's job; removeTyping on send is the store's.
 */
import { getTypingUserIds } from '@web/stores/typing';
import { auth } from '@web/stores/auth';
import { t } from '@web/i18n/t';
import { deepEqual, sameArray, useDerived } from './derived';
import { userDisplay } from './users';

export interface TypingPerson {
  id: string;
  name: string;
  avatar?: string;
}

/** Ids typing in a room, oldest first, without yourself. Re-renders when that list changes. */
export function useTypingUserIds(roomId: string): string[] {
  return useDerived(`typingIds:${roomId}`, () => getTypingUserIds(roomId, auth.user?.id), sameArray);
}

/** The same, with names and avatars resolved for the room (space members, PM participants,
 * or embedded authors). */
export function useTypingPeople(roomId: string): TypingPerson[] {
  return useDerived(
    `typingPeople:${roomId}`,
    () =>
      getTypingUserIds(roomId, auth.user?.id).map((id) => {
        const d = userDisplay(id, { roomId });
        return { id, name: d.name, ...(d.avatar ? { avatar: d.avatar } : {}) };
      }),
    deepEqual,
  );
}

/** Beyond three named people the line reads "Several people are typing…" (TypingIndicator). */
export const TYPING_MAX_NAMED = 3;
/** Faces shown before the stack turns into a "+N" chip. */
export const TYPING_MAX_FACES = 3;

/** The indicator's sentence, with the web's strings. '' for nobody. */
export function typingLabel(people: ReadonlyArray<{ name: string }>): string {
  const names = people.map((p) => p.name);
  if (names.length === 0) return '';
  if (names.length === 1) return t('room.typingOne', { name: names[0] });
  if (names.length === 2) return t('room.typingPair', { a: names[0], b: names[1] });
  if (names.length === 3) return t('room.typingTrio', { a: names[0], b: names[1], c: names[2] });
  return t('room.typingMany');
}
