/**
 * Small pure pieces of the send path, shared with the web's RoomPage/SpacePage behaviour.
 */
import { t } from '@web/i18n/t';
import { isApiError } from '@web/api/ApiError';
import { translateCaughtApiError } from '@web/lib/formatApiError';

/**
 * How often "still typing" is re-announced while someone keeps typing. Above the server's 5 s
 * per-user rate limit (announcements inside it are dropped) and below the 10 s TTL, so a
 * continuous typist never flickers out (RoomPage's TYPING_PING_MS).
 */
export const TYPING_PING_MS = 6000;

export interface TypingEmitter {
  /** Call on every change of the draft. */
  onInput(): void;
  /** A send ends the typing run: the next keystroke announces at once. */
  reset(): void;
}

export function createTypingEmitter(send: () => void, now: () => number = Date.now): TypingEmitter {
  let last = 0;
  return {
    onInput() {
      const n = now();
      if (n - last >= TYPING_PING_MS) {
        last = n;
        send();
      }
    },
    reset() {
      last = 0;
    },
  };
}

/** The authoritative wait from a refused send (slowmode answers 429 + retry_after). */
export function retryAfterSeconds(err: unknown): number {
  if (!isApiError(err) || err.status !== 429) return 0;
  const v = (err.body as { retry_after?: unknown } | undefined)?.retry_after;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
}

/** Why a send failed, in the user's language (slowmode, rate limit, automod, verification). */
export function sendErrorText(err: unknown): string {
  return translateCaughtApiError(err, t).join(' ') || t('room.sendFailed');
}

/** Whether there is anything to send (the web's canSend, minus the transient states). */
export function hasContent(text: string, attachmentCount: number): boolean {
  return text.trim().length > 0 || attachmentCount > 0;
}
