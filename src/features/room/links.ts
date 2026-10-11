/**
 * Opening a link from a message body, a bio or an About Me.
 *
 * A space invite on this instance (`/invite/:code`, or `code@other.instance`) opens the
 * app's own invite screen; anything else goes through the web's external-link guard
 * (stores/externalLink): a trusted domain opens straight away, any other shows the "Leaving
 * Strafe" confirmation that RoomHosts renders.
 */
import { Linking } from 'react-native';
import { router } from 'expo-router';
import { extractSpaceInviteCodeFromUrl } from '@web/lib/utils/spaceInviteLink';
import { isExternalLink, requestOpenExternalLink } from '@web/stores/externalLink';

export function openLink(href: string): void {
  const url = href.trim();
  if (!url) return;
  if (!isExternalLink(url)) {
    const code = extractSpaceInviteCodeFromUrl(url);
    if (code) {
      router.push(`/invite/${encodeURIComponent(code)}` as never);
      return;
    }
  }
  if (/^mailto:/i.test(url)) {
    // Nothing leaves the device until the person sends the mail themselves; the domain
    // guard has no host to check here either.
    void Linking.openURL(url).catch(() => undefined);
    return;
  }
  if (!/^https?:\/\//i.test(url)) return;
  requestOpenExternalLink(url);
}
