/**
 * Deep links before the router sees them.
 *
 * `strafe://push/open?...` is where a push notification's tap and buttons lead on Android
 * (the native renderer builds it; see src/platform/push/links.ts). It is not a screen: the
 * target is handed to push routing - which opens the room in the shell, switching to the
 * push's account first when it is another one - and the router just goes to the app's root
 * (the boot gate moves on from there as usual). Every other link passes through unchanged.
 *
 * Any app or web page can open such a link, so its Reply / Answer only count when it carries
 * this install's link key, which only our own notifications have (trustedLinkTarget): a
 * crafted link opens a room at most, it never joins a call.
 */
import { getLinkKey } from '@strafe/push';
import { isPushUrl, parsePushUrl, trustedLinkTarget } from '@/platform/push/links';
import { routePushTarget } from '@/platform/push/routing';

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    const target = parsePushUrl(path);
    // A push link that does not parse is still not a screen: the app's root, not "not found".
    if (!target) return isPushUrl(path) ? '/' : path;
    routePushTarget(trustedLinkTarget(target, getLinkKey()));
    return '/';
  } catch (e) {
    console.warn('[push] could not open a notification link', e);
    return isPushUrl(path) ? '/' : path;
  }
}
