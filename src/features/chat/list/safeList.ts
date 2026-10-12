/**
 * FlashList's imperative methods, called so that none of them can close the app.
 *
 * Why (0.1.1: deleting a message closed the app, "index out of bounds, not enough layouts"):
 * FlashList v2 trims its layouts to the new data length while it *renders* (processDataUpdate,
 * in a useMemo), but refreshes the indices it last saw on screen only after its own layout
 * pass, a commit later. recomputeViewableItems() in between re-reads those stale indices and
 * getLayout(i) throws for the row that was just removed. Called from a component's effect that
 * is a render error (fatal without a boundary); from a timer or an event handler it is
 * uncaught, and a release build closes on it.
 *
 * So every call here is guarded against the data length where it takes an index and caught
 * whatever happens: a scroll that cannot happen now is skipped, never fatal. scrollToIndex and
 * scrollToEnd are async and can also reject from inside FlashList's own steps; those
 * rejections are swallowed here, so no caller leaks an unhandled one. Viewability is
 * recomputed a frame after the data changed (see MessageList), once FlashList has caught up.
 */

/** The parts of a FlashList ref these helpers call (a FlashListRef, or a fake in tests). */
export interface ImperativeList {
  scrollToIndex(params: { index: number; animated?: boolean; viewPosition?: number; viewOffset?: number }): unknown;
  scrollToEnd(params?: { animated?: boolean }): unknown;
  recomputeViewableItems?(): void;
}

function skipped(op: string, e: unknown): void {
  console.warn(`[list] ${op} skipped:`, e instanceof Error ? e.message : e);
}

/** Swallow a rejection of whatever an async list method returned (a promise or nothing). */
function settle(op: string, result: unknown): Promise<void> {
  if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
    return Promise.resolve(result as PromiseLike<unknown>).then(
      () => undefined,
      (e: unknown) => skipped(op, e),
    );
  }
  return Promise.resolve();
}

/**
 * scrollToIndex for an index into data of `length` rows (the data the list was last given).
 * Out of range, or throwing, it does nothing. Always resolves - when the scroll has finished,
 * or at once when it was skipped - so a caller can chain "landed" onto it either way.
 */
export function safeScrollToIndex(
  list: ImperativeList | null | undefined,
  params: { index: number; animated?: boolean; viewPosition?: number; viewOffset?: number },
  length: number,
): Promise<void> {
  if (!list || !Number.isInteger(params.index) || params.index < 0 || params.index >= length) return Promise.resolve();
  try {
    return settle('scrollToIndex', list.scrollToIndex(params));
  } catch (e) {
    skipped('scrollToIndex', e);
    return Promise.resolve();
  }
}

/** scrollToEnd, fire and forget: an empty, unmounted or mid-update list just stays put. */
export function safeScrollToEnd(list: ImperativeList | null | undefined, params?: { animated?: boolean }): void {
  if (!list) return;
  try {
    void settle('scrollToEnd', list.scrollToEnd(params));
  } catch (e) {
    skipped('scrollToEnd', e);
  }
}

/** recomputeViewableItems, caught. Call it a frame after the data changed, not in that commit. */
export function safeRecomputeViewableItems(list: ImperativeList | null | undefined): void {
  if (!list?.recomputeViewableItems) return;
  try {
    list.recomputeViewableItems();
  } catch (e) {
    skipped('recomputeViewableItems', e);
  }
}
