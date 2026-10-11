/**
 * The slice of `window` the shared web stores use, on React Native.
 *
 * RN already makes `window` the global object and provides timers, fetch, WebSocket,
 * TextEncoder, atob/btoa. What it lacks and the stores reach for:
 *
 * - `window.addEventListener` / `removeEventListener` / `dispatchEvent` for 'online',
 *   'offline', 'focus', 'blur', 'visibilitychange', 'pagehide' and a few custom events the
 *   stores send each other. App foreground/background drives focus/blur/visibilitychange,
 *   so the gateway's "wake up and reconnect when the tab comes back" logic works unchanged.
 * - `window.location`, read-only for the most part: `origin` is the signed-in instance's web
 *   origin (invite and OAuth links are built from it), `pathname` mirrors the screen on show
 *   (the notification code skips the room you are looking at), and `assign`/`replace`/
 *   `reload` restart the app or navigate, the way a page load would have.
 * - `document.visibilityState` / `document.hidden` and document-level listeners, for the same
 *   visibility logic. Deliberately nothing else: a `document` that pretended to be a DOM
 *   would send library code down browser paths it cannot complete.
 */
import { AccessibilityInfo, AppState, Appearance, Dimensions, type AppStateStatus } from 'react-native';
import { getDesktopInstance } from '@web/desktop/instanceOverride';

type Listener = (ev: { type: string; [k: string]: unknown }) => void;

class SimpleEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, fn: Listener | { handleEvent: Listener } | null): void {
    if (!fn) return;
    const l: Listener = typeof fn === 'function' ? fn : (ev) => fn.handleEvent(ev);
    if (typeof fn !== 'function') (fn as { __l?: Listener }).__l = l;
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(l);
  }

  removeEventListener(type: string, fn: Listener | { handleEvent: Listener } | null): void {
    if (!fn) return;
    const l = typeof fn === 'function' ? fn : (fn as { __l?: Listener }).__l;
    if (l) this.listeners.get(type)?.delete(l);
  }

  dispatchEvent(ev: { type: string; [k: string]: unknown }): boolean {
    const set = this.listeners.get(ev.type);
    if (!set) return true;
    for (const l of [...set]) {
      try {
        l(ev);
      } catch (e) {
        console.error(`[window shim] ${ev.type} listener threw`, e);
      }
    }
    return true;
  }
}

const g = globalThis as unknown as Record<string, unknown>;

// ---- window events -----------------------------------------------------------------------------

const windowEvents = new SimpleEventTarget();
if (typeof g.addEventListener !== 'function') {
  g.addEventListener = windowEvents.addEventListener.bind(windowEvents);
  g.removeEventListener = windowEvents.removeEventListener.bind(windowEvents);
  g.dispatchEvent = windowEvents.dispatchEvent.bind(windowEvents);
}

/** CustomEvent, which a few stores construct to talk to each other. */
if (typeof g.CustomEvent !== 'function') {
  g.CustomEvent = class CustomEvent<T = unknown> {
    readonly type: string;
    readonly detail: T;
    constructor(type: string, init?: { detail?: T }) {
      this.type = type;
      this.detail = init?.detail as T;
    }
  };
}
if (typeof g.Event !== 'function') {
  g.Event = class Event {
    readonly type: string;
    constructor(type: string) {
      this.type = type;
    }
  };
}

// ---- document (visibility only) ----------------------------------------------------------------

const documentEvents = new SimpleEventTarget();
let visibility: 'visible' | 'hidden' = AppState.currentState === 'active' ? 'visible' : 'hidden';

const visibilityDocument = {
  get visibilityState() {
    return visibility;
  },
  get hidden() {
    return visibility === 'hidden';
  },
  hasFocus: () => visibility === 'visible',
  addEventListener: documentEvents.addEventListener.bind(documentEvents),
  removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
  dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
};

/** Exposed for modules that need it explicitly; not installed as a global `document`. */
export { visibilityDocument };

function onAppState(state: AppStateStatus): void {
  const next = state === 'active' ? 'visible' : 'hidden';
  if (next === visibility) return;
  visibility = next;
  documentEvents.dispatchEvent({ type: 'visibilitychange' });
  windowEvents.dispatchEvent({ type: 'visibilitychange' });
  windowEvents.dispatchEvent({ type: next === 'visible' ? 'focus' : 'blur' });
  if (next === 'hidden') windowEvents.dispatchEvent({ type: 'pagehide' });
}
AppState.addEventListener('change', onAppState);

/** Network reachability changes, reported by whoever watches the connection. */
export function reportOnline(online: boolean): void {
  (g.navigator as { onLine?: boolean } | undefined) && ((g.navigator as { onLine?: boolean }).onLine = online);
  windowEvents.dispatchEvent({ type: online ? 'online' : 'offline' });
}

// ---- location ------------------------------------------------------------------------------------

let currentPath = '/';
type Navigate = (path: string, replace: boolean) => void;
let navigate: Navigate | null = null;
let reload: (() => void) | null = null;

/** The screen on show, kept current by the navigation layer. */
export function setLocationPath(path: string): void {
  currentPath = path || '/';
}

/** Wire `location.assign` & co. to the router and to an app reload. */
export function bindLocation(nav: Navigate, reloadApp: () => void): void {
  navigate = nav;
  reload = reloadApp;
}

function instanceOrigin(): string {
  const inst = getDesktopInstance();
  if (!inst) return 'https://strafe.invalid';
  const api = inst.apiUrl.replace(/\/+$/, '');
  if (api.endsWith('/api')) return api.slice(0, -'/api'.length);
  return `https://${inst.domain}`;
}

/**
 * A full navigation on the web (`location.assign('/')` after switching accounts, `'/login?
 * reason=...'` when a session is revoked) starts the page from scratch; the app restarts its
 * JS for the same reason. Same-app paths otherwise just navigate.
 */
function goTo(target: string, replace: boolean): void {
  let path = target;
  try {
    const u = new URL(target, instanceOrigin());
    if (u.origin !== instanceOrigin()) {
      navigate?.(target, replace);
      return;
    }
    path = `${u.pathname}${u.search}`;
  } catch {
    /* relative path as given */
  }
  if (path === '/' || path.startsWith('/login')) {
    reload?.();
    return;
  }
  navigate?.(path, replace);
}

const locationShim = {
  get origin() {
    return instanceOrigin();
  },
  get protocol() {
    return instanceOrigin().startsWith('http:') ? 'http:' : 'https:';
  },
  get host() {
    return instanceOrigin().replace(/^https?:\/\//, '');
  },
  get hostname() {
    return instanceOrigin().replace(/^https?:\/\//, '').replace(/:\d+$/, '');
  },
  get port() {
    return /:(\d+)$/.exec(instanceOrigin())?.[1] ?? '';
  },
  get pathname() {
    return currentPath.split('?')[0] || '/';
  },
  get search() {
    const i = currentPath.indexOf('?');
    return i >= 0 ? currentPath.slice(i) : '';
  },
  get hash() {
    return '';
  },
  get href() {
    return `${instanceOrigin()}${currentPath}`;
  },
  assign(url: string) {
    goTo(String(url), false);
  },
  replace(url: string) {
    goTo(String(url), true);
  },
  reload() {
    reload?.();
  },
  toString() {
    return this.href;
  },
};

if (!g.location) g.location = locationShim;

// ---- matchMedia ------------------------------------------------------------------------------------
//
// The stores ask a handful of media queries (reduced motion, colour scheme, pointer type, a
// width breakpoint). Each is answered from the matching RN API and updates its listeners.

type MQListener = (ev: { matches: boolean; media: string }) => void;

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((v) => {
    reduceMotion = v;
    notifyMedia();
  })
  .catch(() => undefined);
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
  reduceMotion = v;
  notifyMedia();
});
Appearance.addChangeListener(() => notifyMedia());
Dimensions.addEventListener('change', () => notifyMedia());

function evaluateMedia(query: string): boolean {
  const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
  let m: RegExpExecArray | null;
  if (q.includes('prefers-reduced-motion')) return q.includes('reduce') ? reduceMotion : !reduceMotion;
  if (q.includes('prefers-color-scheme')) {
    const scheme = Appearance.getColorScheme() ?? 'light';
    return q.includes('dark') ? scheme === 'dark' : scheme === 'light';
  }
  if (q.includes('pointer: coarse') || q.includes('hover: none')) return true;
  if (q.includes('pointer: fine') || q.includes('hover: hover')) return false;
  if ((m = /min-width: ?(\d+)px/.exec(q))) return Dimensions.get('window').width >= Number(m[1]);
  if ((m = /max-width: ?(\d+)px/.exec(q))) return Dimensions.get('window').width <= Number(m[1]);
  return false;
}

const mediaLists = new Set<{ media: string; matches: boolean; listeners: Set<MQListener> }>();

function notifyMedia(): void {
  for (const ml of mediaLists) {
    const next = evaluateMedia(ml.media);
    if (next === ml.matches) continue;
    ml.matches = next;
    for (const l of [...ml.listeners]) l({ matches: next, media: ml.media });
  }
}

if (typeof g.matchMedia !== 'function') {
  g.matchMedia = (media: string) => {
    const state = { media, matches: evaluateMedia(media), listeners: new Set<MQListener>() };
    mediaLists.add(state);
    return {
      get matches() {
        return evaluateMedia(media);
      },
      media,
      onchange: null,
      addEventListener: (_t: string, l: MQListener) => state.listeners.add(l),
      removeEventListener: (_t: string, l: MQListener) => state.listeners.delete(l),
      addListener: (l: MQListener) => state.listeners.add(l),
      removeListener: (l: MQListener) => state.listeners.delete(l),
      dispatchEvent: () => true,
    };
  };
}

// ---- navigator bits --------------------------------------------------------------------------------

const nav = (g.navigator ?? (g.navigator = {})) as Record<string, unknown>;
if (nav.onLine === undefined) nav.onLine = true;
if (!nav.language) nav.language = 'en';
if (!nav.languages) nav.languages = ['en'];
if (!nav.userAgent) nav.userAgent = 'StrafeMobile';
