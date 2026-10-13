/**
 * Before redeeming an emailed token: make sure it goes to the instance that issued it.
 *
 * A link that names its instance (an https link's host, or ?instance= on an app link) is
 * checked against the chosen one; signed out, the app switches to it (chooseInstance), signed
 * in it refuses rather than move a live session. A link that names none uses the chosen
 * instance, and with none chosen there is nowhere to send it.
 *
 * "Signed in" is any stored session, restored yet or not (hasStoredSession): anyone can make
 * a link, and switching under a stored token would hand that token to their server with the
 * redeem request that follows.
 */
import { t } from '@web/i18n/t';
import { InstanceResolveError, chooseInstance, currentInstance, hasStoredSession } from '@/platform/session';
import { sameInstanceHost } from './authLinks';
import { instanceStatusMessage } from './instanceStatus';

export type LinkInstanceResult = { ok: true } | { ok: false; reason: 'noInstance' | 'otherInstance' | 'unresolved'; message: string };

function knownHosts(): string[] {
  const inst = currentInstance();
  if (!inst) return [];
  const hosts = [inst.domain];
  const api = /^https?:\/\/([^/]+)/i.exec(inst.apiUrl)?.[1];
  if (api) hosts.push(api);
  const origin = (globalThis as { location?: { host?: string } }).location?.host;
  if (origin) hosts.push(origin);
  return hosts;
}

export async function ensureLinkInstance(host: string | null): Promise<LinkInstanceResult> {
  if (!host) {
    return currentInstance() ? { ok: true } : { ok: false, reason: 'noInstance', message: t('mobile.auth.linkNoInstance') };
  }
  if (knownHosts().some((h) => sameInstanceHost(h, host))) return { ok: true };
  if (hasStoredSession()) {
    return { ok: false, reason: 'otherInstance', message: t('mobile.auth.linkOtherInstance', { host }) };
  }
  try {
    await chooseInstance(host);
    return { ok: true };
  } catch (e) {
    const code = e instanceof InstanceResolveError ? e.code : 'unreachable';
    return { ok: false, reason: 'unresolved', message: instanceStatusMessage({ kind: 'error', code, host }) };
  }
}
