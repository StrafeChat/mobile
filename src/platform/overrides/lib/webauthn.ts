/**
 * Mobile replacement for web/src/lib/webauthn.ts: passkeys are not available in this version
 * of the app.
 *
 * A native passkey ceremony only succeeds when the relying party - each self-hosted instance -
 * publishes apple-app-site-association / assetlinks.json naming this app's bundle id and
 * signing key. Most instances will not, and a passkey prompt that fails after the person has
 * chosen it is worse than not offering it. So `webauthnSupported()` is false: login offers the
 * other second factors (authenticator app, recovery code) and the security settings hide "Add
 * a passkey". The ceremonies reject with an explanatory error in case anything calls them
 * anyway.
 *
 * Types are declared here rather than taken from the DOM lib's PublicKeyCredential*JSON so the
 * module stands on its own; they are the same JSON shapes the server sends and expects.
 */
import { t } from '@web/i18n/t';

/** The JSON a WebAuthn ceremony posts back to the server (`PublicKeyCredentialJSON`). */
export type PasskeyRegistrationResponse = Record<string, unknown>;
export type PasskeyAssertionResponse = Record<string, unknown>;

/** Passkeys need the instance to vouch for the app; not offered on mobile yet. */
export function webauthnSupported(): boolean {
  return false;
}

/** Error raised by the ceremonies on mobile; its message is user-facing. */
export class PasskeysUnavailableError extends Error {
  constructor() {
    super(t('mobile.webOverrides.passkeyUnavailable'));
    this.name = 'PasskeysUnavailableError';
  }
}

export async function createPasskey(_optionsJSON: unknown): Promise<PasskeyRegistrationResponse> {
  throw new PasskeysUnavailableError();
}

export async function getPasskeyAssertion(_optionsJSON: unknown): Promise<PasskeyAssertionResponse> {
  throw new PasskeysUnavailableError();
}

/**
 * True for "the person dismissed the prompt". There is no prompt on mobile, so never: a
 * PasskeysUnavailableError is a real outcome the caller should show.
 */
export function isWebauthnCancellation(_err: unknown): boolean {
  return false;
}
