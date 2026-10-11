/**
 * Bits the developer screens share: the docs link, the once-shown secret hand-off from the
 * list (create) to the detail screen, and the in-app install link for a bot.
 */
import { openExternalUrl } from '@/platform/overrides/desktop/native';
import { oauthConsentPath } from '../../routes';

/** A client secret or bot token the server returned once; kept in memory until dismissed. */
export interface OnceSecret {
  labelKey: string;
  value: string;
}

const pendingSecrets = new Map<string, OnceSecret>();

/** Hand a freshly minted secret to the application's detail screen. */
export function stashSecret(appId: string, secret: OnceSecret): void {
  pendingSecrets.set(appId, secret);
}

/** Take (and forget) the secret waiting for an application, if any. */
export function takeSecret(appId: string): OnceSecret | null {
  const s = pendingSecrets.get(appId) ?? null;
  pendingSecrets.delete(appId);
  return s;
}

/** This instance's developer documentation (the web image serves it at /docs/). */
export function docsUrl(): string {
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  return `${origin}/docs/`;
}

export function openDocs(): void {
  void openExternalUrl(docsUrl());
}

/** The router path of an authorize URL, for opening it on the in-app consent screen. */
export function consentPathFor(url: string): string | null {
  return oauthConsentPath(url);
}
