/**
 * Where a push notification leads, in the two shapes it arrives in:
 *
 * - Android: the native renderer's tap and action intents carry a deep link,
 *   `strafe://push/open?slot=<slot>&rid=<rid>[&sid=<sid>][&mid=<mid>][&reply=1|&answer=1]`,
 *   which expo-router hands to src/app/+native-intent.tsx;
 * - iOS: the Notification Service Extension puts `{strafe: {slot, rid, sid, mid, t}}` where
 *   expo-notifications exposes a remote notification's `content.data` (the `body` key of the
 *   APNs userInfo), and taps / action buttons arrive as notification responses.
 *
 * Everything here is parsing: ids are kept as strings and checked to be snowflakes, and a
 * slot must be a slot - the link is reachable by anything that can open a URL on the device.
 * That is also why a link's Reply / Answer only counts when it carries this install's link
 * key (trustedLinkTarget): any app or web page can open `strafe://push/open?...&answer=1`,
 * and joining a call - a live microphone - must take a person's tap on our own notification.
 * Without the key a link can open a room of a signed-in account, nothing more.
 */
import { isValidSlot } from './slots';

export interface PushTarget {
  slot: string;
  /** '' when the notification was about the account, not a room (a test, the group summary). */
  roomId: string;
  spaceId?: string;
  messageId?: string;
  /** Reply: focus the composer. Answer: join the call. */
  action?: 'reply' | 'answer';
  /** The link key a link carried; see trustedLinkTarget. */
  key?: string;
}

const ID_RE = /^\d{1,20}$/;
const KEY_RE = /^[A-Za-z0-9_-]{1,64}$/;
const PUSH_URL_RE = /^strafe:\/\/push(?:[/?#]|$)/i;

function id(v: unknown): string | undefined {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return String(v);
  return typeof v === 'string' && ID_RE.test(v) ? v : undefined;
}

/** Any `strafe://push...` URL: ours, whether or not it parses (it is never a screen). */
export function isPushUrl(url: string): boolean {
  return PUSH_URL_RE.test(url.trim());
}

/**
 * `strafe://push/open?...` -> the target, or null for any other URL. A link with only a
 * slot (the test notification, the group summary) is about the account: roomId ''.
 */
export function parsePushUrl(url: string): PushTarget | null {
  const m = /^strafe:\/\/push\/open\/?\?(.*)$/i.exec(url.trim());
  if (!m) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(m[1]!.split('#')[0]);
  } catch {
    return null;
  }
  const slot = params.get('slot') ?? '';
  if (!isValidSlot(slot)) return null;
  const rawRoom = params.get('rid');
  const roomId = rawRoom === null ? '' : id(rawRoom);
  if (roomId === undefined) return null;
  const spaceId = id(params.get('sid'));
  const messageId = id(params.get('mid'));
  // Reply and Answer are about a room; without one there is nothing to act on.
  const action = !roomId ? undefined : params.get('answer') === '1' ? 'answer' : params.get('reply') === '1' ? 'reply' : undefined;
  const key = params.get('k');
  return {
    slot,
    roomId,
    ...(spaceId ? { spaceId } : {}),
    ...(messageId ? { messageId } : {}),
    ...(action ? { action } : {}),
    ...(key && KEY_RE.test(key) ? { key } : {}),
  };
}

export function buildPushUrl(target: PushTarget): string {
  const q = new URLSearchParams({ slot: target.slot });
  if (target.roomId) q.set('rid', target.roomId);
  if (target.spaceId) q.set('sid', target.spaceId);
  if (target.messageId) q.set('mid', target.messageId);
  if (target.action === 'reply') q.set('reply', '1');
  if (target.action === 'answer') q.set('answer', '1');
  if (target.key) q.set('k', target.key);
  return `strafe://push/open?${q.toString()}`;
}

/**
 * What a link may do: its Reply / Answer only when it carries `linkKey` - this install's,
 * which only our own notifications put in their links - and never the key itself onwards.
 * Anything else that opens `strafe://push/open` gets the room opened, at most.
 */
export function trustedLinkTarget(target: PushTarget, linkKey: string | null): PushTarget {
  const { key, action, ...rest } = target;
  const trusted = !!linkKey && key === linkKey;
  return action && trusted ? { ...rest, action } : rest;
}

/** The routing data the iOS extension attached, as one of our pushes carries it. */
export interface PushData {
  slot: string;
  roomId: string;
  spaceId?: string;
  messageId?: string;
  /** The payload type: msg, call, test... */
  type: string;
}

/**
 * `content.data` of a notification (and, as a fallback, the raw APNs payload of a remote
 * notification's trigger) -> our routing data, or null when it is not a Strafe push.
 */
export function pushDataOf(content: { data?: unknown } | null | undefined, triggerPayload?: unknown): PushData | null {
  const fromData = (content?.data as { strafe?: unknown } | undefined)?.strafe;
  const payload = triggerPayload as { strafe?: unknown; body?: { strafe?: unknown } } | undefined;
  const raw = fromData ?? payload?.body?.strafe ?? payload?.strafe;
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const slot = typeof o.slot === 'string' && isValidSlot(o.slot) ? o.slot : null;
  if (!slot) return null;
  const type = typeof o.t === 'string' ? o.t : 'msg';
  // A test push names no room, nor does the generic alert iOS shows when a push could not be
  // decrypted (only its slot): both still belong to an account. roomId '' then.
  const roomId = id(o.rid);
  const spaceId = id(o.sid);
  const messageId = id(o.mid);
  return { slot, roomId: roomId ?? '', type, ...(spaceId ? { spaceId } : {}), ...(messageId ? { messageId } : {}) };
}
