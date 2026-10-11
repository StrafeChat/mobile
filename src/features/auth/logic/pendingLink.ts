/**
 * An email link that started the app.
 *
 * Opening strafe://verify-email?token=... (or an instance https link the OS handed to the app)
 * on a cold start lands while the app is still booting, and the boot gate moves to the splash
 * and then to the sign-in screen - the link's own screen never shows. So the screens the boot
 * gate lands on ask here once per run for the link that launched the app, and open its screen.
 * A verify / reset screen that did open from the link marks its token handled, so it is not
 * opened twice.
 */
import { Linking } from 'react-native';
import { parseAuthLink, type AuthLink } from './authLinks';

const handled = new Set<string>();
let checked = false;

/** A verify / reset screen is showing this token (from its route or a paste). */
export function markAuthLinkHandled(token: string): void {
  if (token) handled.add(token);
}

/** The auth link the app was launched with, once per run, unless its screen already showed it. */
export async function takeLaunchAuthLink(): Promise<AuthLink | null> {
  if (checked) return null;
  checked = true;
  let url: string | null = null;
  try {
    url = await Linking.getInitialURL();
  } catch {
    return null;
  }
  const link = url ? parseAuthLink(url) : null;
  if (!link || handled.has(link.token)) return null;
  handled.add(link.token);
  return link;
}

/** Tests only. */
export function resetPendingAuthLinkForTests(): void {
  handled.clear();
  checked = false;
}
