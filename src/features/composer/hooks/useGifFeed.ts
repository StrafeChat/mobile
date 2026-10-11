/**
 * The GIF picker's feed, as the web GifPicker runs it: trending when the query is empty,
 * search otherwise (typing debounced 350 ms), 24 per page, paging on demand, a short first
 * page pulling the next at once, superseded requests aborted, and three distinct states -
 * not configured (no API key in the instance config), error (retry), and ok.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchGifs, gifProviderConfigured, GifNotConfiguredError, type GifProviderId, type GifResult } from '@web/lib/gif/providers';

export const GIF_PAGE_SIZE = 24;
export const GIF_SEARCH_DEBOUNCE_MS = 350;

export type GifFeedState = 'ok' | 'config' | 'error';

export interface GifFeed {
  items: GifResult[];
  loading: boolean;
  state: GifFeedState;
  done: boolean;
  loadMore(): void;
  retry(): void;
}

export function useGifFeed(provider: GifProviderId, query: string, enabled = true): GifFeed {
  const [debounced, setDebounced] = useState(query.trim());
  const [items, setItems] = useState<GifResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [state, setState] = useState<GifFeedState>('ok');
  const [done, setDone] = useState(false);
  const offset = useRef(0);
  const reqId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const doneRef = useRef(false);
  const itemsRef = useRef<GifResult[]>([]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), GIF_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (reset: boolean) => {
      if (!gifProviderConfigured(provider)) {
        setState('config');
        setItems([]);
        itemsRef.current = [];
        return;
      }
      if (!reset && (busy.current || doneRef.current)) return;
      const mine = ++reqId.current;
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      busy.current = true;
      setLoading(true);
      try {
        const page = await fetchGifs(provider, {
          query: debounced,
          offset: reset ? 0 : offset.current,
          limit: GIF_PAGE_SIZE,
          signal: ctrl.signal,
        });
        if (mine !== reqId.current) return;
        offset.current = page.nextOffset;
        const next = reset ? page.results : [...itemsRef.current, ...page.results];
        itemsRef.current = next;
        setItems(next);
        const finished = page.results.length === 0 || page.nextOffset >= page.totalCount;
        doneRef.current = finished;
        setDone(finished);
        setState('ok');
      } catch (e) {
        if (mine !== reqId.current || (e instanceof Error && e.name === 'AbortError')) return;
        setState(e instanceof GifNotConfiguredError ? 'config' : 'error');
        if (reset) {
          itemsRef.current = [];
          setItems([]);
        }
      } finally {
        if (mine === reqId.current) {
          busy.current = false;
          setLoading(false);
        }
      }
    },
    [provider, debounced],
  );

  // Reset and reload whenever the query or the provider changes.
  useEffect(() => {
    if (!enabled) return undefined;
    offset.current = 0;
    doneRef.current = false;
    setDone(false);
    void load(true);
    return undefined;
  }, [load, enabled]);

  useEffect(() => () => controller.current?.abort(), []);

  // A short first page (fewer than a screenful) pulls the next one straight away.
  useEffect(() => {
    if (enabled && state === 'ok' && !loading && !done && items.length > 0 && items.length < GIF_PAGE_SIZE) void load(false);
  }, [enabled, state, loading, done, items.length, load]);

  return {
    items,
    loading,
    state,
    done,
    loadMore: () => {
      if (state === 'ok') void load(false);
    },
    retry: () => void load(true),
  };
}
