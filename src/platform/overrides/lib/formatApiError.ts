/**
 * Mobile wrapper for web/src/lib/formatApiError.ts.
 *
 * The web recognises a dropped connection by the browser's wording ("Failed to fetch",
 * Firefox's "NetworkError when attempting to fetch resource"). React Native's fetch says
 * "Network request failed" (or "...timed out" / "Aborted"), which would otherwise surface
 * raw instead of the translated "network error" line. Those are mapped to the browser's
 * wording before the web's translation runs; everything else is the web's code.
 */
import {
  splitErrorMessage,
  translateApiErrorMessage as webTranslateApiErrorMessage,
  translateCaughtApiError as webTranslateCaughtApiError,
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

export function translateCaughtApiError(err: unknown, t: ErrorTranslateFn): string[] {
  if (err instanceof Error && RN_NETWORK.test(err.message.trim())) {
    return webTranslateApiErrorMessage('Failed to fetch', t);
  }
  return webTranslateCaughtApiError(err, t);
}
