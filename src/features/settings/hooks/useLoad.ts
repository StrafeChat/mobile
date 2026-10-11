/**
 * Server data for one settings screen: fetch on mount (and when `deps` change), expose the
 * loading / refreshing / error states the pages render, and let the page patch the value
 * locally after a mutation (a revoked grant leaves the list without a refetch, as the web's
 * pages do).
 *
 * A reload that fails keeps the previous value on screen; a result that arrives after the
 * screen went away, or after a newer request, is dropped.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface LoadState<T> {
  data: T | undefined;
  /** The first load (nothing to show yet). */
  loading: boolean;
  /** A pull-to-refresh / retry while data is shown. */
  refreshing: boolean;
  error: unknown;
  reload: () => Promise<void>;
  setData: (next: T | ((prev: T | undefined) => T | undefined)) => void;
}

export function useLoad<T>(loader: () => Promise<T>, deps: readonly unknown[] = []): LoadState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const seq = useRef(0);
  const mounted = useRef(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const hasData = useRef(false);

  const run = useCallback(async (asRefresh: boolean) => {
    const id = ++seq.current;
    if (asRefresh && hasData.current) setRefreshing(true);
    else setLoading(true);
    try {
      const value = await loaderRef.current();
      if (!mounted.current || id !== seq.current) return;
      hasData.current = true;
      setDataState(value);
      setError(null);
    } catch (e) {
      if (!mounted.current || id !== seq.current) return;
      setError(e);
    } finally {
      if (mounted.current && id === seq.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    hasData.current = false;
    void run(false);
    return () => {
      mounted.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const reload = useCallback(() => run(true), [run]);
  const setData = useCallback((next: T | ((prev: T | undefined) => T | undefined)) => {
    setDataState((prev) => (typeof next === 'function' ? (next as (p: T | undefined) => T | undefined)(prev) : next));
  }, []);

  return { data, loading, refreshing, error, reload, setData };
}
