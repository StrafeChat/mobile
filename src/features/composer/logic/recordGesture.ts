/**
 * Hold-to-record (WhatsApp / Discord mobile): press and hold the microphone to record,
 * slide towards the start edge to throw the take away, slide up to lock it so you can let
 * go and keep talking. Release (unlocked) stops and sends.
 *
 * Pure so the thresholds are testable without a gesture system.
 */

/** Distance (dp) towards the start edge that cancels. */
export const CANCEL_DISTANCE = 110;
/** Distance (dp) upwards that locks. */
export const LOCK_DISTANCE = 80;

export type DragIntent = 'none' | 'cancel' | 'lock';

/**
 * What a drag of (dx, dy) from the press point means. In right-to-left layouts the start edge
 * is on the right, so cancelling is a slide to the right.
 */
export function classifyDrag(dx: number, dy: number, rtl: boolean): DragIntent {
  const towardsStart = rtl ? dx : -dx;
  if (towardsStart >= CANCEL_DISTANCE) return 'cancel';
  if (-dy >= LOCK_DISTANCE && towardsStart < CANCEL_DISTANCE / 2) return 'lock';
  return 'none';
}

/** 0..1 progress of the slide-to-cancel hint (for its fade). */
export function cancelProgress(dx: number, rtl: boolean): number {
  const towardsStart = rtl ? dx : -dx;
  return Math.max(0, Math.min(1, towardsStart / CANCEL_DISTANCE));
}

/** m:ss for the recording timer (the web's formatMediaTime for whole seconds). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
