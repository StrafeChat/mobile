/**
 * What the native renderer needs to turn a decrypted push into a notification while the
 * JavaScript app is not running: every string already in the person's language, every
 * account on this device (to label notifications and to act on them), which account is open
 * (foreground suppression), and the preview / sound preferences.
 *
 * Templates keep their `{{name}}` placeholders for the native side to fill: they are passed
 * to t() as their own names, so i18next writes them back unchanged.
 */
import type { DisplayAccount, DisplayConfig, PushStrings } from '@strafe/push';
import { t } from '@web/i18n/t';
import { accountLabel } from './accounts';
import type { PushAccount } from './api';

/** Every key of PushStrings, and the placeholders each template carries. */
const STRING_KEYS: Record<keyof PushStrings, readonly string[]> = {
  appName: [],
  newMessage: [],
  encryptedMessage: [],
  attachment: [],
  spaceRoom: ['room', 'space'],
  threadRoom: ['thread', 'room'],
  incomingCall: [],
  callFrom: ['name'],
  callFromIn: ['name', 'room'],
  markRead: [],
  reply: [],
  answer: [],
  decline: [],
  testTitle: [],
  testBody: [],
  channelMessages: [],
  channelMessagesSilent: [],
  channelCalls: [],
};

/** The localized strings for the native renderer, placeholders intact. */
export function pushStrings(): PushStrings {
  const out = {} as PushStrings;
  for (const [key, placeholders] of Object.entries(STRING_KEYS) as [keyof PushStrings, readonly string[]][]) {
    const keep = Object.fromEntries(placeholders.map((p) => [p, `{{${p}}}`]));
    out[key] = t(`mobile.push.${key}`, keep);
  }
  return out;
}

export interface DisplayInputs {
  accounts: readonly PushAccount[];
  activeAccountId: string | null;
  preview: boolean;
  sounds: boolean;
  /** Android keeps each account's token (encrypted, natively) for Mark as read / Decline. */
  includeTokens: boolean;
}

export function buildDisplayConfig(inputs: DisplayInputs): DisplayConfig {
  const active = inputs.accounts.find((a) => a.id === inputs.activeAccountId) ?? null;
  const localDomain = active?.domain ?? null;
  const accounts: DisplayAccount[] = inputs.accounts.map((a) => ({
    slot: a.slot,
    userId: a.userId,
    label: accountLabel(a, localDomain),
    apiBase: a.apiBase,
    ...(inputs.includeTokens ? { token: a.token } : {}),
  }));
  return {
    strings: pushStrings(),
    accounts,
    activeSlot: active?.slot ?? null,
    preview: inputs.preview,
    sounds: inputs.sounds,
  };
}
