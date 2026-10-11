/**
 * Before redeeming an emailed token: make sure it goes to the instance that issued it.
 *
 * A link that names its instance (an https link's host, or ?instance= on an app link) is
 * checked against the chosen one; signed out, the app switches to it (chooseInstance), signed
 * in it refuses rather than move a live session. A link that names none uses the chosen
 * instance, and with none chosen there is nowhere to send it.
 */
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { InstanceResolveError, chooseInstance, currentInstance } from '@/platform/session';
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
  if (auth.token) {
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
