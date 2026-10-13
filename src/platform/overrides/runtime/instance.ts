/**
 * Mobile wrapper for web/src/stores/instance.ts: the same store and exports, with one
 * behaviour changed - how long a caller waits when GET / cannot be reached.
 *
 * `instance.loaded` means "this instance has answered GET /", and nothing less: the E2EE
 * engine names the account's identity from the answer (`@id:<domain>` on a federating
 * instance, the legacy `@id:strafe.internal` otherwise), and the web's requireInstanceInfo
 * (lib/e2ee/machine.ts) refuses to name one while `loaded` is false. An identity built from
 * the defaults after a failed request opens (or provisions) a device under the wrong name - a
 * silent crypto downgrade. The web store keeps that rule: a failure leaves `loaded` false and
 * the next call asks again. This wrapper only ever clears `loaded`, never sets it, so the rule
 * holds here too.
 *
 * What the web store does not do is wait. A browser tab cannot start offline; a phone does as
 * a matter of course, and on the web a failed E2EE open just fails until something retries
 * it. So, here:
 * - while a session exists, loadInstanceInfo() does not resolve until the instance has
 *   actually answered. It retries with backoff, and at once when the network returns or
 *   the app comes to the foreground. Anything awaiting it (the engine above all) waits
 *   rather than failing;
 * - signed out (the sign-in forms), a failure resolves as on the web, so the forms render
 *   with the store's defaults - still not `loaded`. instanceInfoFailed() says so, and the
 *   next call (retryInstanceInfoNow, on the network's return) asks again;
 * - a failure is never sticky: any later call retries.
 *
 * The parsing of GET / stays in the web module, whose `loaded` tells its success from its
 * failure.
 */
import { createSignal } from 'solid-js';
import {
  instance,
  setInstance,
  loadInstanceInfo as loadInstanceInfoOnce,
  resetInstanceInfo as resetInstanceInfoOriginal,
} from '@web-original/stores/instance';

export * from '@web-original/stores/instance';

const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/**
 * This instance's own answer is in the store. `loaded` alone can also be the answer of the
 * instance chosen before it, landing late (see resetInstanceInfo).
 */
let reached = false;
let running: Promise<void> | null = null;
/** Cuts the current backoff short (network back, app foregrounded, an explicit retry). */
let wake: (() => void) | null = null;

const [failed, setFailed] = createSignal(false);

/** The instance's version for display ('' until it has answered). Reactive. */
export function instanceVersion(): string {
  return instance.version;
}

/** True after an attempt to read the instance failed, until one succeeds. Reactive. */
export function instanceInfoFailed(): boolean {
  return failed();
}

/** The web client's API reads the token from here on every request; so does this. */
function hasSession(): boolean {
  try {
    return !!localStorage.getItem('session_token');
  } catch {
    return false;
  }
}

/**
 * Bumped by resetInstanceInfo: a load still running for the previously chosen instance
 * keeps its hands off the state of the new one.
 */
let generation = 0;

/** One GET /; null when the instance was changed meanwhile (the answer is not this one's). */
async function attemptOnce(gen: number): Promise<boolean | null> {
  // The web function returns at once while `loaded` is set. Here that can only be a previous
  // instance's late answer (loadInstanceInfo returns early once this one has answered), so
  // it must not pass for this one's.
  setInstance('loaded', false);
  await loadInstanceInfoOnce();
  if (gen !== generation) return null;
  const ok = instance.loaded;
  reached = ok;
  setFailed(!ok);
  return ok;
}

function backoff(attempt: number): Promise<void> {
  const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
  const target = globalThis as unknown as {
    addEventListener?: (type: string, fn: () => void) => void;
    removeEventListener?: (type: string, fn: () => void) => void;
  };
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      target.removeEventListener?.('online', done);
      target.removeEventListener?.('focus', done);
      if (wake === done) wake = null;
      resolve();
    };
    const timer = setTimeout(done, delay);
    // The window shim turns NetInfo and AppState into these, as a browser would.
    target.addEventListener?.('online', done);
    target.addEventListener?.('focus', done);
    wake = done;
  });
}

async function run(gen: number): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    const ok = await attemptOnce(gen);
    if (ok !== false || !hasSession()) return;
    await backoff(attempt);
    if (gen !== generation) return;
  }
}

/**
 * Fetch GET / and fill the store. Idempotent once the instance has answered; shared while
 * in flight. See the file comment for what happens when it cannot be reached.
 */
export function loadInstanceInfo(): Promise<void> {
  if (instance.loaded && reached) return Promise.resolve();
  if (!running) {
    const flight = run(generation).finally(() => {
      if (running === flight) running = null;
    });
    running = flight;
  }
  return running;
}

/**
 * Ask again now: wakes a waiting retry, or starts an attempt when the last one failed and
 * nothing is running (the sign-in screen after the network came back). A no-op once the
 * instance has answered.
 */
export function retryInstanceInfoNow(): void {
  if (wake) {
    wake();
    return;
  }
  // An attempt still out is shared rather than doubled (loadInstanceInfo returns it).
  if (failed()) void loadInstanceInfo();
}

/** Forget what was loaded (a different instance was picked); the next load asks again. */
export function resetInstanceInfo(): void {
  generation++;
  reached = false;
  setFailed(false);
  resetInstanceInfoOriginal();
  // A load for the old instance is not the new one's: the next call starts its own. The old
  // request still lands in the web store when it answers, `loaded` and all, so whatever it
  // wrote is wiped once it has - it is the old instance's domain, captcha and invite rule,
  // which neither the sign-in forms nor the engine may take for this one's. If the new
  // instance had been read by then, read it again; a read still out lands on the clean store,
  // and a failed one leaves it unloaded.
  const stale = running;
  running = null;
  if (stale) {
    const gen = generation;
    void stale.then(() => {
      if (gen !== generation) return;
      resetInstanceInfoOriginal();
      if (reached) {
        reached = false;
        void loadInstanceInfo();
      }
    });
  }
  // A retry waiting on the old instance gives up at once.
  wake?.();
}
