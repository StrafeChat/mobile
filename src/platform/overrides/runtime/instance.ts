/**
 * Mobile wrapper for web/src/stores/instance.ts: the same store and exports, with one
 * behaviour changed - what a failed GET / means.
 *
 * The web's loadInstanceInfo() asks GET / once. When that fails it still marks the store
 * `loaded` with every feature off and no federation domain, and never asks again. In a
 * browser tab that only hides a few controls until the next page load. In the app it is
 * worse, because the app starts offline as a matter of course and the E2EE engine
 * (lib/e2ee/machine.ts) awaits this very call to learn the instance's domain before it
 * names the account's identity: `@id:<domain>` on a federating instance, the legacy
 * `@id:strafe.internal` otherwise. Resolving with the defaults after a failure would open
 * (or provision) the engine under the wrong identity - a silent crypto downgrade.
 *
 * So, here:
 * - while a session exists, loadInstanceInfo() does not resolve until the instance has
 *   actually answered. It retries with backoff, and at once when the network returns or
 *   the app comes to the foreground. Anything awaiting it (the engine above all) waits
 *   rather than guessing;
 * - signed out (the sign-in forms), a failure resolves with the defaults as on the web, so
 *   the forms render. instanceInfoFailed() says so, and the next call asks again;
 * - a failure is never sticky: any later call retries.
 *
 * The parsing of GET / stays in the web module. To tell its success from its failure
 * without copying it, `version` is set to a sentinel before each attempt: a successful
 * answer always overwrites `version`, the failure path never touches it.
 */
import { createSignal } from 'solid-js';
import {
  instance,
  setInstance,
  loadInstanceInfo as loadInstanceInfoOnce,
  resetInstanceInfo as resetInstanceInfoOriginal,
} from '@web-original/stores/instance';

export * from '@web-original/stores/instance';

const PENDING_VERSION = '\u0000strafe:pending';
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;

/** The last attempt reached the instance (as opposed to `loaded`, which a failure also sets). */
let reached = false;
let running: Promise<void> | null = null;
/** Cuts the current backoff short (network back, app foregrounded, an explicit retry). */
let wake: (() => void) | null = null;

const [failed, setFailed] = createSignal(false);

/**
 * The instance's version for display: '' while an attempt is out (the store then holds the
 * sentinel, which must never reach the screen). Reactive.
 */
export function instanceVersion(): string {
  return instance.version === PENDING_VERSION ? '' : instance.version;
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
  // The web function returns at once while `loaded` is set, which a failure leaves behind.
  setInstance('loaded', false);
  setInstance('version', PENDING_VERSION);
  await loadInstanceInfoOnce();
  if (gen !== generation) return null;
  const ok = instance.version !== PENDING_VERSION;
  if (!ok) setInstance('version', '');
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
  if (!reached && instance.loaded) void loadInstanceInfo();
}

/** Forget what was loaded (a different instance was picked); the next load asks again. */
export function resetInstanceInfo(): void {
  generation++;
  reached = false;
  setFailed(false);
  resetInstanceInfoOriginal();
  // A load for the old instance is not the new one's: the next call starts its own. The old
  // request still lands in the web store when it answers, so if the new instance had already
  // been read by then, read it again.
  const stale = running;
  running = null;
  if (stale) {
    const gen = generation;
    void stale.then(() => {
      if (gen === generation && reached) {
        reached = false;
        void loadInstanceInfo();
      }
    });
  }
  // A retry waiting on the old instance gives up at once.
  wake?.();
}
