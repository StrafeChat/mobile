/**
 * Mobile wrapper for web/src/lib/formatApiError.ts.
 *
 * The web recognises a dropped connection by the browser's wording ("Failed to fetch",
 * Firefox's "NetworkError when attempting to fetch resource"). React Native's fetch says
 * "Network request failed" (or "...timed out" / "Aborted"), which would otherwise surface
 * raw instead of the translated "network error" line. Those are mapped to the browser's
 * wording before the web's translation runs; everything else is the web's code. Every function
 * that translates a caught error is wrapped (translateCaughtApiError, translateRoleApiError):
 * the web's call each other inside its own module, past this file.
 */
import {
  splitErrorMessage,
  translateApiErrorMessage as webTranslateApiErrorMessage,
  translateCaughtApiError as webTranslateCaughtApiError,
  translateRoleApiError as webTranslateRoleApiError,
  type ErrorTranslateFn,
} from '@web-original/lib/formatApiError';

export * from '@web-original/lib/formatApiError';
export { splitErrorMessage };

const RN_NETWORK = /^(network request (failed|timed out)|aborted)$/i;

function normalizeNetwork(raw: string): string {
  return RN_NETWORK.test(raw.trim()) ? 'Failed to fetch' : raw;
}

export function translateApiErrorMessage(raw: string, t: ErrorTranslateFn): string[] {
  return webTranslateApiErrorMessage(normalizeNetwork(raw), t);
}

function isRnNetworkError(err: unknown): boolean {
  return err instanceof Error && RN_NETWORK.test(err.message.trim());
}

export function translateCaughtApiError(err: unknown, t: ErrorTranslateFn): string[] {
  if (isRnNetworkError(err)) return webTranslateApiErrorMessage('Failed to fetch', t);
  return webTranslateCaughtApiError(err, t);
}

/** The role surfaces' translation (the hierarchy refusal worded for a role), with the same
 * dropped-connection mapping: the web's falls back to its own translateCaughtApiError. */
export function translateRoleApiError(err: unknown, t: ErrorTranslateFn): string[] {
  if (isRnNetworkError(err)) return webTranslateApiErrorMessage('Failed to fetch', t);
  return webTranslateRoleApiError(err, t);
}
