/**
 * Webhook and bridged messages, and what a room is bridged with.
 *
 * A message a webhook or a bridge posted carries `webhook_id`, and its `sender_id` is the
 * webhook (or, for a bot-driven bridge, the bot) - never a person who could be messaged,
 * befriended, nicknamed or kicked. Who it shows as is the message's own `masquerade`,
 * snapshotted when it was posted: one webhook posts under many names, so nothing here looks it
 * up by id or folds its compatibility `author` into a user cache. All of the rules are the
 * web's (lib/webhookMessages, components/messageList/utils getMessageSenderDisplay,
 * lib/bridgePlatforms, stores/bridges); this file is their React side.
 *
 * - messageAuthorDisplay / useMessageAuthor: who a message shows as - a person through
 *   userDisplay (role colour, space profile), or the webhook / bridged identity with its
 *   WEBHOOK or platform tag, its default avatar picked from the webhook or puppet id, and a
 *   bridged person's own name colour when their bridge allows it.
 * - Bridges: a room's public summaries (on the room, kept current by BRIDGE_* events), the
 *   platforms they reach named once each, and whether the signed-in person's messages are
 *   copied (the server decides; this only explains it).
 */
import type { Reactor } from '@web/api/messages';
import type { BridgeSummary } from '@web/api/bridges';
import { auth } from '@web/stores/auth';
import type { DecryptedMessage } from '@web/stores/messages';
import { spaces } from '@web/stores/spaces';
import { spaceMembers } from '@web/stores/spaceMembers';
import { bridges, myBridgeConsentIn, roomBridges, spaceBridgeConsentMode } from '@web/stores/bridges';
import { getMessageSenderDisplay, type SenderDisplay } from '@web/components/messageList/utils';
import { messageAuthorKey } from '@web/lib/webhookMessages';
import { bridgePlatformLabel, nameSkeleton } from '@web/lib/bridgePlatforms';
import { canBlockBridgedIn } from '@web/lib/roomPerms';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { deepEqual, useDerived } from './derived';
import { userDisplay, useUserDisplay, type UserContext, type UserDisplay } from './users';

export { messageAuthorKey };

/** The fields of a message that decide who it shows as. */
export type AuthorMessage = Pick<DecryptedMessage, 'sender_id' | 'webhook_id' | 'masquerade' | 'author'>;

/** A message's author as the list shows it: a person's display, or a webhook's / bridged
 * person's (`webhook` set; `userId` is then the webhook or puppet id, never a person). */
export type MessageAuthorDisplay = UserDisplay & Pick<SenderDisplay, 'webhook' | 'colour'>;

/** Who a message shows as, read now (reactive inside a computation). */
export function messageAuthorDisplay(msg: AuthorMessage, ctx: UserContext): MessageAuthorDisplay {
  if (!msg.webhook_id) return userDisplay(msg.sender_id, ctx);
  const s = getMessageSenderDisplay(msg, [], auth.user?.id);
  // A webhook has no roles, and a bridged person must never wear the bot's colour: only the
  // colour their bridge allows (getMessageSenderDisplay leaves it out otherwise).
  return { ...s, ...(s.colour ? { nameColor: s.colour } : {}) };
}

/** True for a message a webhook or bridge posted. */
export function isWebhookAuthored(msg: { webhook_id?: string } | null | undefined): boolean {
  return !!msg?.webhook_id;
}

/**
 * useUserDisplay for a message: the person, or the webhook / bridged identity the message was
 * posted under. Re-renders when the person's display changes, or (webhooks) when the reader's
 * "Show webhook and bridged avatars" changes.
 */
export function useMessageAuthor(msg: AuthorMessage | null | undefined, ctx: UserContext = {}): MessageAuthorDisplay | undefined {
  const webhook = !!msg?.webhook_id;
  const person = useUserDisplay(webhook ? null : msg?.sender_id, ctx);
  const roomId = ctx.roomId ?? null;
  const spaceId = ctx.spaceId ?? null;
  const masked = useSolid(() => (webhook && msg ? messageAuthorDisplay(msg, { roomId, spaceId }) : undefined), [msg, webhook, roomId, spaceId]);
  return webhook ? masked : person;
}

/** "Alice (Discord)" / "CI (webhook)": how a notification or a list that has no room for the
 * tag names a webhook's or bridged person's message - never a bare name that could pass for a
 * member. Undefined for a person's message. */
export function maskedAuthorLabel(author: Pick<MessageAuthorDisplay, 'name' | 'webhook'>): string | undefined {
  const w = author.webhook;
  if (!w) return undefined;
  if (w.bridge) return t('bridges.notificationName', { name: author.name, platform: bridgePlatformLabel(w.bridge.platform, w.bridge.platformName) });
  return t('webhooks.notificationName', { name: author.name });
}

/** The tag's accessible name for a bridged person ("Bridged from Discord by Strife"). */
export function bridgeTagLabel(bridge: NonNullable<SenderDisplay['webhook']>['bridge']): string {
  if (!bridge) return t('badges.webhook');
  const platform = bridgePlatformLabel(bridge.platform, bridge.platformName);
  const via = bridge.via?.name || bridge.bridgeName || '';
  return via ? t('bridges.tagLabelVia', { platform, via }) : t('bridges.tagLabel', { platform });
}

// ---- moderation ---------------------------------------------------------------------------------------

/** May the viewer block a bridged person from a bridge in this room (Kick Members, or Manage
 * Messages there - the web's roomPerms rule)? Only what is offered: the server decides. */
export function canBlockBridged(spaceId: string | null | undefined, roomId: string | null | undefined): boolean {
  return canBlockBridgedIn(spaceId ?? undefined, roomId ?? undefined);
}

// ---- reactors ---------------------------------------------------------------------------------------

/** A reactor who is a bridged person (their id is a puppet id: nobody here). */
export function isPuppetReactor(r: Pick<Reactor, 'puppet' | 'bridge'>): boolean {
  return !!(r.puppet ?? r.bridge);
}

/** "Alice (Discord)" for a bridged reactor; undefined for a person (named from the space). */
export function puppetReactorName(r: Pick<Reactor, 'puppet' | 'bridge' | 'display_name' | 'username'>): string | undefined {
  const b = r.puppet ?? (r.bridge ? { platform: r.bridge.platform, platform_name: r.bridge.platform_name } : undefined);
  if (!b) return undefined;
  const name = r.display_name || r.username || t('webhooks.defaultName');
  return t('bridges.notificationName', { name, platform: bridgePlatformLabel(b.platform, b.platform_name) });
}

// ---- the bridged person's card ------------------------------------------------------------------------

/**
 * A member of the space whose username, display name or nickname is the bridged person's name:
 * the server's verdict from when it was posted (`lookalike`), else the member list this client
 * holds (the web card's rule). The card says "Not the Strafe account @username".
 */
export function bridgedNamesake(
  spaceId: string | null | undefined,
  name: string,
  lookalike: { id: string; username: string } | undefined,
): { id: string; username: string } | undefined {
  if (lookalike?.id) {
    const m = spaceId ? spaceMembers.bySpaceId[spaceId]?.find((x) => x.id === lookalike.id) : undefined;
    return { id: lookalike.id, username: m?.username || lookalike.username || lookalike.id };
  }
  if (!spaceId) return undefined;
  const key = nameSkeleton(name);
  if (!key) return undefined;
  const m = (spaceMembers.bySpaceId[spaceId] ?? []).find(
    (x) => !x.bot && [x.username, x.display_name, (x as { nick?: string }).nick].some((n) => !!n && nameSkeleton(n) === key),
  );
  return m ? { id: m.id, username: m.username } : undefined;
}

// ---- bridges ------------------------------------------------------------------------------------------

/** The platforms a list of bridges reaches, each named once ("Discord, Matrix") - the web
 * RoomBridgeBadge's bridgedPlatformsLabel. */
export function bridgedPlatformsLabel(list: readonly Pick<BridgeSummary, 'platform' | 'platform_name'>[]): string {
  const names: string[] = [];
  for (const b of list) {
    const n = bridgePlatformLabel(b.platform, b.platform_name);
    if (!names.includes(n)) names.push(n);
  }
  return names.join(', ');
}

/** What the room is bridged with (public summaries, as plain data). Re-renders when a bridge
 * is added, changed or removed. */
export function useRoomBridges(spaceId: string | null | undefined, roomId: string | null | undefined): BridgeSummary[] {
  return useDerived(
    `roomBridges:${spaceId ?? ''}:${roomId ?? ''}`,
    () => (roomId ? roomBridges(spaceId ?? undefined, roomId).map((b) => ({ ...b, remote: b.remote ? { ...b.remote } : b.remote })) : []),
    deepEqual,
  );
}

export interface BridgeConsentView {
  /** Whether bridges copy the signed-in person's messages in the space. */
  effective: 'allow' | 'deny';
  /** The space's mode. */
  mode: 'optout' | 'optin';
  /** The person's own choice for the space (inherit until loaded). */
  spaceState: 'inherit' | 'allow' | 'deny';
  /** The person's choice for the space has been read from the server. */
  spaceLoaded: boolean;
  /** The account default: null = never set; undefined = not loaded yet. */
  account: 'allow' | 'deny' | null | undefined;
}

/** The signed-in person's bridge consent in a space (stores/bridges). Load it with
 * ensureAccountBridgeConsent / ensureSpaceBridgeConsent. */
export function bridgeConsentView(spaceId: string | null | undefined): BridgeConsentView {
  const sid = spaceId ?? undefined;
  const mine = sid ? bridges.bySpace[sid] : undefined;
  return {
    effective: myBridgeConsentIn(sid),
    mode: spaceBridgeConsentMode(sid),
    spaceState: mine?.state ?? 'inherit',
    spaceLoaded: mine !== undefined,
    account: bridges.account !== undefined ? bridges.account : auth.user?.bridge_consent,
  };
}

export function useBridgeConsent(spaceId: string | null | undefined): BridgeConsentView {
  return useDerived(`bridgeConsent:${spaceId ?? ''}`, () => bridgeConsentView(spaceId), deepEqual);
}

/** The spaces with a bridged room, and the platforms each reaches (Privacy > Bridges). */
export function useBridgedSpaces(): { spaceId: string; name: string; platforms: string }[] {
  return useDerived(
    'bridgedSpaces',
    () =>
      spaces.spaces
        .map((sp) => {
          const list = (spaces.spaceRoomsBySpaceId[sp.id] ?? []).flatMap((r) => roomBridges(sp.id, r.id));
          return { spaceId: sp.id, name: sp.name, platforms: bridgedPlatformsLabel(list), count: list.length };
        })
        .filter((x) => x.count > 0)
        .map(({ spaceId, name, platforms }) => ({ spaceId, name, platforms })),
    deepEqual,
  );
}
