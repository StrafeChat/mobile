/**
 * Shared, keyed Solid memos between the web stores and the data hooks.
 *
 * `useSolid` re-renders whenever anything its selector read changes, even when the result
 * comes out the same: a row reading one room's unread count would re-render on every message
 * in every room, because the count is computed from stores that change constantly. Putting a
 * `createMemo` with an equality check between the store and the component stops that - the
 * memo re-runs on every change, but only notifies its readers when the *value* differs.
 *
 * The memos are keyed (`spaceBadges:<id>`, `msg:<room>:<id>`...) and shared: the space rail and
 * the notifications tab asking for the same badge share one computation. Each lives in its own
 * Solid root, kept alive while a mounted component holds it and disposed a little after the
 * last one lets go - the grace period is what lets a recycled list row (FlashList hands a row a
 * new key on scroll) or a quick remount pick the memo back up instead of rebuilding it.
 *
 * Rule for compute functions: return plain data, never a store proxy. A proxy keeps its
 * identity across in-place updates (reactions, pins are written with `produce`), so an
 * equality check on it would swallow exactly the changes a row needs. `snapshot()` both copies
 * and tracks every field it visits.
 */
import { createMemo, createRoot, type Accessor } from 'solid-js';
import { useEffect, useReducer } from 'react';
import { useSolid } from '@/bridge/solid';

export type Equals<T> = (a: T, b: T) => boolean;

interface Entry {
  read: Accessor<unknown>;
  dispose: () => void;
  refs: number;
  timer: ReturnType<typeof setTimeout> | null;
}

const registry = new Map<string, Entry>();

/** How long a memo nobody is mounted on survives. Long enough for list recycling and a
 * passive effect that runs late on a slow device; short enough not to keep dead rows'
 * computations running against every store change. */
const IDLE_DISPOSE_MS = 2000;

function scheduleDispose(key: string, entry: Entry): void {
  if (entry.timer) clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    entry.timer = null;
    if (entry.refs > 0) return;
    if (registry.get(key) === entry) registry.delete(key);
    entry.dispose();
  }, IDLE_DISPOSE_MS);
}

/**
 * The shared memo for `key`, created on first use. The key must encode every input `compute`
 * closes over: a second caller with the same key gets the first caller's computation.
 *
 * Call it during render (hooks do); nested inside another memo's compute it would be owned by
 * nothing and could be disposed under its reader.
 */
export function derived<T>(key: string, compute: () => T, equals: Equals<T> = Object.is): Accessor<T> {
  let entry = registry.get(key);
  if (!entry) {
    entry = createRoot((dispose) => ({
      read: createMemo(compute, undefined, { equals }) as Accessor<unknown>,
      dispose,
      refs: 0,
      timer: null,
    }));
    registry.set(key, entry);
    // Released again unless a mounted component retains it (an aborted render never does).
    scheduleDispose(key, entry);
  }
  return entry.read as Accessor<T>;
}

/** Hold `key`'s memo alive; returns the release, or null when it was already disposed. */
function retain(key: string, read: Accessor<unknown>): (() => void) | null {
  const entry = registry.get(key);
  if (!entry || entry.read !== read) return null;
  entry.refs += 1;
  if (entry.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  return () => {
    entry.refs -= 1;
    if (entry.refs <= 0) scheduleDispose(key, entry);
  };
}

/**
 * Read a shared derived value in a component. Re-renders only when the value changes by
 * `equals` - not when the stores under it change in a way that leaves it the same.
 */
export function useDerived<T>(key: string, compute: () => T, equals?: Equals<T>): T {
  const read = derived(key, compute, equals);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const release = retain(key, read);
    // The memo went idle and was dropped between render and mount (a very late effect):
    // render again, which recreates it, and retain that one.
    if (!release) {
      rerender();
      return undefined;
    }
    return release;
  }, [key, read]);
  return useSolid(() => read(), [read]);
}

/** Number of live shared memos - for tests and leak checks. */
export function derivedCount(): number {
  return registry.size;
}

// ---- equality ----------------------------------------------------------------------------------

/** Structural equality for the plain JSON-like data the memos return. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

/** Same elements in the same order (ids lists). */
export function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
  return true;
}
