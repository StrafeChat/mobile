/**
 * A Solid root owned by a React component: created on mount (and whenever `deps` change),
 * disposed on unmount. For per-screen reactive state that the web keeps in a page's
 * signals and effects - porting those effects as Solid code keeps their exact semantics
 * (tracked vs untracked reads, run order) instead of re-deriving them with React effects.
 */
import { createRoot } from 'solid-js';
import { useEffect, useReducer, useRef } from 'react';

interface Scope<T> {
  value: T;
  dispose: () => void;
  deps: readonly unknown[];
  disposed: boolean;
}

function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

export function useSolidScope<T>(factory: () => T, deps: readonly unknown[]): T {
  const ref = useRef<Scope<T> | null>(null);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const create = (): Scope<T> => createRoot((dispose) => ({ value: factory(), dispose, deps, disposed: false }));

  if (!ref.current || ref.current.disposed || !sameDeps(ref.current.deps, deps)) {
    if (ref.current && !ref.current.disposed) {
      ref.current.dispose();
      ref.current.disposed = true;
    }
    ref.current = create();
  }

  useEffect(() => {
    // StrictMode (and a remount of a kept component) runs cleanup then setup again on the
    // same render: the scope disposed by that cleanup is rebuilt here and rendered again.
    if (ref.current!.disposed) {
      ref.current = create();
      rerender();
    }
    const current = ref.current!;
    return () => {
      current.dispose();
      current.disposed = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref.current.value;
}
