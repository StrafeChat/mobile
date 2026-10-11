/**
 * Errors of the crypto host itself (as opposed to the engine's, which cross verbatim), and
 * the rebuilding of a forwarded error on the app side.
 */
import type { WireError } from './protocol';

/** The WebView died (iOS content-process termination, Android renderer gone) mid-call. */
export class CryptoHostCrashedError extends Error {
  constructor(reason: string) {
    super(`the crypto host stopped (${reason}); the call did not complete`);
    this.name = 'CryptoHostCrashedError';
  }
}

/** A machine opened before the host restarted: its handle no longer exists. Reopen it. */
export class CryptoHostRestartedError extends Error {
  constructor() {
    super('the crypto host restarted since this machine was opened; open it again');
    this.name = 'CryptoHostRestartedError';
  }
}

/** The host did not answer in time. The call may still complete in the page; its result is dropped. */
export class CryptoHostTimeoutError extends Error {
  constructor(method: string, ms: number) {
    super(`crypto host call ${method} did not answer within ${Math.round(ms / 1000)} s`);
    this.name = 'CryptoHostTimeoutError';
  }
}

/** The host could not boot (the engine failed to load) or keeps crashing. */
export class CryptoHostUnavailableError extends Error {
  constructor(detail: string) {
    super(`end-to-end encryption engine unavailable: ${detail}`);
    this.name = 'CryptoHostUnavailableError';
  }
}

/** The facade does not offer this part of the package's API (it is not used by Strafe). */
export class CryptoHostUnsupportedError extends Error {
  constructor(what: string) {
    super(`${what} is not available through the crypto host`);
    this.name = 'CryptoHostUnsupportedError';
  }
}

/**
 * A forwarded engine exception, rebuilt as an Error with the page's `name` and `message`
 * exactly. `hostStack` keeps the page-side stack for debugging; `data` the extra fields of
 * non-Error throwables.
 */
export interface ForwardedError extends Error {
  hostStack?: string;
  data?: Record<string, unknown>;
}

export function fromWireError(w: WireError | undefined): ForwardedError {
  const e = new Error(w?.message ?? 'unknown crypto host error') as ForwardedError;
  e.name = w?.name || 'Error';
  if (w?.stack) e.hostStack = w.stack;
  if (w?.data) e.data = w.data;
  return e;
}
