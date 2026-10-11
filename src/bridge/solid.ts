/**
 * React <-> Solid bridge.
 *
 * The app's state lives in the web client's Solid stores (imported from the `web` submodule)
 * so mobile and web share one implementation of the gateway, unread counting, E2EE, voice and
 * the rest. Solid's reactive core runs anywhere; these hooks are how a React component reads
 * from it and re-renders when what it read changes.
 *
 * `useSolid(fn)` runs `fn` inside a Solid computation, so every store field `fn` touches is
 * tracked; when any of them changes the component re-renders and reads `fn` again. The value
 * handed to React is a *snapshot*: store proxies are mutated in place, so returning one would
 * give React the same reference after a change and memoized children would never update.
 * The snapshot is a plain, frozen copy, rebuilt only when something it read changed, so its
 * identity is stable between changes and new after one - exactly what React expects.
 *
 * Keep selectors narrow. Reading a whole room's message array re-renders on any change to
 * any message; reading the id list in the list and one message per row does not.
 */
import { createComputed, createRoot, untrack } from 'solid-js';
import { $RAW } from 'solid-js/store';
import { useCallback, useRef, useSyncExternalStore } from 'react';

const MAX_DEPTH = 32;

function isPlainObject(v: object): boolean {
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/**
 * Deep-read a value through any store proxies it contains (which tracks every field it
 * visits) and return a plain copy. Non-plain objects (Date, Map, class instances, typed
 * arrays) are passed through as they are - stores don't hold those as reactive data.
 */
export function snapshot<T>(value: T, depth = 0): T {
  if (value === null || typeof value !== 'object') return value;
  if (depth > MAX_DEPTH) return value;
  if (Array.isArray(value)) {
    const out = new Array(value.length);
    for (let i = 0; i < value.length; i++) out[i] = snapshot(value[i], depth + 1);
    return Object.freeze(out) as T;
  }
  // A store proxy exposes its raw object under $RAW; its prototype is the raw one's.
  const raw = (value as Record<PropertyKey, unknown>)[$RAW] ?? value;
  if (!isPlainObject(raw as object)) return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object)) {
    out[key] = snapshot((value as Record<string, unknown>)[key], depth + 1);
  }
  return Object.freeze(out) as T;
}

interface Subscription<T> {
  version: number;
  value: T;
}

/**
 * Subscribe a component to Solid state. `deps` are the React values `fn` closes over (a room
 * id, say): when they change the selector is re-run and re-subscribed.
 */
export function useSolid<T>(fn: () => T, deps: ReadonlyArray<unknown> = []): T {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const sub = useRef<Subscription<T> | null>(null);
  const depsKey = useRef<ReadonlyArray<unknown>>(deps);

  const depsChanged =
    depsKey.current.length !== deps.length || depsKey.current.some((d, i) => !Object.is(d, deps[i]));
  if (sub.current === null || depsChanged) {
    depsKey.current = deps;
    sub.current = { version: (sub.current?.version ?? 0) + 1, value: untrack(() => snapshot(fnRef.current())) };
  }

  const subscribe = useCallback((notify: () => void) => {
    return createRoot((dispose) => {
      let first = true;
      createComputed(() => {
        const next = snapshot(fnRef.current());
        if (first) {
          first = false;
          // The render may have read an older value than the one we now track (a change can
          // land between render and subscribe); publish it if so.
          if (sub.current && !shallowSame(sub.current.value, next)) {
            sub.current = { version: sub.current.version + 1, value: next };
            notify();
          }
          return;
        }
        sub.current = { version: (sub.current?.version ?? 0) + 1, value: next };
        notify();
      });
      return dispose;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useSyncExternalStore(subscribe, () => sub.current!.version);
  return sub.current!.value;
}

function shallowSame(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const va = (a as Record<string, unknown>)[k];
    const vb = (b as Record<string, unknown>)[k];
    if (!Object.is(va, vb) && !(typeof va === 'object' && JSON.stringify(va) === JSON.stringify(vb))) return false;
  }
  return true;
}

/**
 * Run a Solid effect for the lifetime of a component (e.g. to drive an Animated value from a
 * store field without re-rendering). Returns nothing; the effect is disposed on unmount.
 */
export function useSolidEffect(fn: () => void, deps: ReadonlyArray<unknown> = []): void {
  const subscribe = useCallback(() => createRoot((dispose) => {
    createComputed(fn);
    return dispose;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), deps);
  useSyncExternalStore(subscribe, () => 0);
}
