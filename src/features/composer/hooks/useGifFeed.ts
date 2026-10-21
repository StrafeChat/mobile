/**
 * The GIF picker's feed, as the web GifPicker runs it: trending when the query is empty,
 * search otherwise (typing debounced 350 ms), 24 per page, paging on demand, a short first
 * page pulling the next at once, superseded requests aborted, and three distinct states -
 * not configured (the instance has no API key for the provider), error (retry), and ok.
 *
 * Requests go through the instance (GET /gifs/*, lib/gif/providers' fetchGifs), never to the
 * provider directly, and which providers exist is the instance's answer to GET /
 * (instance.gifProviders). Until that answer is in, "not configured" would be a guess, so the
 * feed asks for it and shows loading; it reloads when the answer lands.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { GIF_PROVIDERS, fetchGifs, gifProviderConfigured, GifNotConfiguredError, type GifProviderId, type GifResult } from '@web/lib/gif/providers';
import { instance, loadInstanceInfo } from '@web/stores/instance';
import { useSolid } from '@/bridge/solid';

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

/**
 * The provider the picker queries: the one chosen in Appearance settings when this instance
 * offers it, otherwise the first one it does, so a preference for Heypster does not leave the
 * tab empty on an instance that only has a GIPHY key (the web picker's rule). The preference
 * itself is left alone - the app moves between instances that offer different ones. With none
 * offered the chosen one stays, and its "not configured" note shows.
 */
export function effectiveGifProvider(chosen: GifProviderId, offered: readonly GifProviderId[]): GifProviderId {
  return offered.length === 0 || offered.includes(chosen) ? chosen : offered[0]!;
}

export interface GifProviderChoice {
  /** The provider to query (effectiveGifProvider). */
  provider: GifProviderId;
  /** The providers this instance serves, in the web's order: the switch offers only these. */
  offered: GifProviderId[];
}

/** The picker's provider and the instance's offer, re-rendering when GET / answers. */
export function useGifProviderChoice(chosen: GifProviderId): GifProviderChoice {
  const offered = useSolid(() => GIF_PROVIDERS.filter((p) => instance.gifProviders.includes(p.id)).map((p) => p.id));
  return { provider: effectiveGifProvider(chosen, offered), offered: [...offered] };
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
  // What the instance answered on GET / (reactive): whether it has, and for this provider.
  const instanceLoaded = useSolid(() => instance.loaded);
  const configured = useSolid(() => gifProviderConfigured(provider), [provider]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), GIF_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const load = useCallback(
    async (reset: boolean) => {
      if (!instanceLoaded) {
        // GET / has not answered yet, or failed, so which providers exist is unknown and "not
        // configured" would be a guess. Ask again; the effect below reloads once it lands.
        const mine = ++reqId.current;
        controller.current?.abort();
        itemsRef.current = [];
        setItems([]);
        setState('ok');
        setLoading(true);
        await loadInstanceInfo();
        if (mine === reqId.current && !instance.loaded) {
          setLoading(false);
          setState('error');
        }
        return;
      }
      if (!configured) {
        // Supersede anything still loading from the provider just switched away from, or its
        // results would land over the "not configured" note.
        ++reqId.current;
        controller.current?.abort();
        busy.current = false;
        setLoading(false);
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
        // Trending shifts between requests, so a later page can repeat a GIF already shown;
        // the grid keys tiles by id, so a repeat is dropped rather than shown twice.
        const seen = new Set(reset ? [] : itemsRef.current.map((g) => g.id));
        const fresh = page.results.filter((g) => !seen.has(g.id) && (seen.add(g.id), true));
        const next = reset ? fresh : [...itemsRef.current, ...fresh];
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
    [provider, debounced, instanceLoaded, configured],
  );

  // Reset and reload whenever the query, the provider or what the instance offers changes.
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
