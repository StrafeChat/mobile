/**
 * The instance field's state and the line under it - the web's InstancePicker
 * (web/src/components/desktop/InstancePicker.tsx) statuses and strings.
 */
import { t } from '@web/i18n/t';
import type { InstanceResolveCode } from '@/platform/session';

export type InstanceStatus =
  | { kind: 'idle' }
  | { kind: 'resolving'; host: string }
  | { kind: 'ok'; domain: string; version?: string }
  | { kind: 'error'; code: InstanceResolveCode; host: string };

/** What the person typed, down to the host the messages name (InstancePicker's host()). */
export function hostOf(raw: string): string {
  return raw.trim().replace(/^@/, '').replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
}

export function instanceStatusMessage(s: InstanceStatus): string {
  switch (s.kind) {
    case 'resolving':
      return t('desktop.instance.resolving', { host: s.host });
    case 'ok':
      return s.version
        ? t('desktop.instance.connectedVersion', { host: s.domain, version: s.version })
        : t('desktop.instance.connected', { host: s.domain });
    case 'error':
      return s.code === 'invalid'
        ? t('desktop.instance.errorInvalid')
        : s.code === 'not_strafe'
          ? t('desktop.instance.errorNotStrafe', { host: s.host })
          : t('desktop.instance.errorUnreachable', { host: s.host });
    default:
      return t('desktop.instance.hint');
  }
}

/**
 * What to hand chooseInstance() to find an instance already known (a saved account's): its
 * domain when it lives at the standard layout or announces itself, otherwise its API URL (a
 * development API on a port has no well-known document to find it by).
 */
export function instanceInputFor(inst: { domain: string; apiUrl: string }): string {
  const api = inst.apiUrl.replace(/\/+$/, '');
  if (api === `https://${inst.domain}/api`) return inst.domain;
  if (/^https:\/\//i.test(api) && !/:\d+(\/|$)/.test(api.replace(/^https:\/\//i, ''))) return inst.domain;
  return api;
}
