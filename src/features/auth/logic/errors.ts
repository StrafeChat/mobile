/**
 * Error lines for the auth forms: the web's translateCaughtApiError (server English and codes
 * to errors.api.*), plus what only happens on React Native - its fetch fails with "Network
 * request failed" (or times out / aborts), which the web's mapper only knows in the browser's
 * wording, so it would show raw English instead of the translated network error.
 */
import { isApiError } from '@web/api/ApiError';
import { t } from '@web/i18n/t';
import { translateCaughtApiError } from '@web/lib/formatApiError';

const RN_NETWORK = /^(network request failed|network request timed out|aborted|the network connection was lost|the internet connection appears to be offline)\.?$/i;

export function isNetworkFailure(err: unknown): boolean {
  if (isApiError(err)) return err.status === 0;
  if (err && typeof err === 'object' && 'name' in err && (err as { name?: unknown }).name === 'AbortError') return true;
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  return RN_NETWORK.test(message.trim());
}

/** Translated lines for anything an auth request threw. */
export function authErrorLines(err: unknown): string[] {
  if (isNetworkFailure(err)) return [t('errors.network')];
  const lines = translateCaughtApiError(err, (key, opts) => t(key, opts));
  return lines.length ? lines : [t('errors.unknown')];
}

/** The pending login is dead (expired after five minutes, or five wrong codes): start over. */
export function isDeadMfaSession(err: unknown): boolean {
  return isApiError(err) && (err.code === 'mfa_token_invalid' || err.code === 'mfa_too_many_attempts');
}

/** Right password, unverified address: the 'unverified' step, and whether a link just went out. */
export function unverifiedEmail(err: unknown): { sent: boolean } | null {
  if (!isApiError(err) || err.code !== 'email_unverified') return null;
  return { sent: err.body?.verification_email_sent === true };
}
