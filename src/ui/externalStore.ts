/**
 * A minimal subscribable value for the presenters (toasts, action sheets, dialogs).
 *
 * Those are called from anywhere - a store action, an API error handler, a web override - so
 * their state can't live in React. It isn't shared web state either, so it doesn't need to be
 * a Solid store; a plain value with listeners, read by the hosts through
 * useSyncExternalStore, is the whole requirement.
 */
import { useSyncExternalStore } from 'react';

export interface ExternalStore<T> {
  get(): T;
  set(next: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
}

export function createExternalStore<T>(initial: T): ExternalStore<T> {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next) {
      const v = typeof next === 'function' ? (next as (prev: T) => T)(value) : next;
      if (Object.is(v, value)) return;
      value = v;
      for (const l of [...listeners]) l();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useExternalStore<T>(store: ExternalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
