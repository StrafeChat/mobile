/**
 * An email link that started the app.
 *
 * Opening strafe://verify-email?token=... (or an instance https link the OS handed to the app)
 * on a cold start lands while the app is still booting, and the boot gate moves to the splash
 * and then to the sign-in screen or the shell - the link's screen mounts for a moment at most,
 * and redeems nothing before start-up has settled (it cannot know yet whose session, on which
 * instance, the request would carry). So the screens the boot gate lands on ask here once per
 * run for the link that launched the app, and open its screen. A verify / reset screen that
 * did take the link marks its token handled, so it is not opened twice.
 *
 * "Once per run" is not enough on its own: the OS keeps handing out the launch link for as
 * long as the process lives, and every JS restart (signing out, switching or adding an
 * account, an expired session, a language that flips the layout) is a new run that asks
 * again, with this module's memory gone. So a token that is done with - its screen redeemed
 * it, or was left - is also written down in app storage, and the launch link is not reopened
 * for it after a restart. A screen still open when the app died is not done with: a cold
 * start from the same link looks no different from a restart, and tapping the link again
 * should open it.
 */
import { Linking } from 'react-native';
import { fingerprint } from '@/platform/push/slots';
import { appStorage } from '@/platform/storage';
import { parseAuthLink, type AuthLink } from './authLinks';

const DONE_KEY = 'strafe.auth.doneLinks';
/** Only the launch link is ever checked against these, so the last few tokens are plenty. */
const DONE_KEEP = 4;

const handled = new Set<string>();
let checked = false;

/**
 * Fingerprints, not tokens: a reset token resets the account's password until it is used,
 * and app storage is a plain file.
 */
function readDone(): string[] {
  try {
    const raw = appStorage.getString(DONE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** A verify / reset screen is showing this token (from its route or a paste). */
export function markAuthLinkHandled(token: string): void {
  if (token) handled.add(token);
}

/**
 * The token is done with (redeemed, or its screen left): not reopened from the launch link by
 * this run or by a later one after a JS restart.
 */
export function markAuthLinkDone(token: string): void {
  if (!token) return;
  handled.add(token);
  const fp = fingerprint(token);
  const done = [...readDone().filter((d) => d !== fp), fp].slice(-DONE_KEEP);
  appStorage.set(DONE_KEY, JSON.stringify(done));
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
  if (!link || handled.has(link.token) || readDone().includes(fingerprint(link.token))) return null;
  handled.add(link.token);
  return link;
}

/**
 * Tests only. `restart` forgets what a JS restart forgets (this run's memory) and keeps what
 * is written down.
 */
export function resetPendingAuthLinkForTests(opts: { restart?: boolean } = {}): void {
  handled.clear();
  checked = false;
  if (!opts.restart) appStorage.remove(DONE_KEY);
}
