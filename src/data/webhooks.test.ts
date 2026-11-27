/**
 * Webhook and bridged messages in the data layer: who a message shows as (the web's
 * getMessageSenderDisplay, never a user looked up by the webhook's id), grouping by author key
 * (listLogic), the sheet's actions (no Edit, block from a bridge for moderators), the reply
 * line, reactors "Alice (Discord)", the "Not the Strafe account" namesake, and what a room is
 * bridged with.
 */
import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals';
import './testing/webMocks';
import i18next from 'i18next';
import webEn from '@web/i18n/locales/en';
import { setMessages, type DecryptedMessage } from '@web/stores/messages';
import { setSpaces } from '@web/stores/spaces';
import { setSpaceMembers } from '@web/stores/spaceMembers';
import { setAppearance } from '@web/stores/appearance';
import { setAuth } from '@web/stores/auth';
import { clearBridges, setSpaceConsentLocal } from '@web/stores/bridges';
import { orPerms } from '@web/lib/permBits';
import { PermKickMembers, PermManageMessages, PermSendMessages, PermViewChannel } from '@web/lib/spacePermissions';
import type { MessageMasquerade } from '@web/api/messages';
import { ME, member, message, resetStores, role, space, sroom, user } from './testing/fixtures';
import { buildMessageList, listAuthorKey, type ListMessage } from './messageListModel';
import { messageActions } from './permissions';
import { findParticipant } from './users';
import { replyReferenceView } from './messages';
import {
  bridgeConsentView,
  bridgedNamesake,
  bridgedPlatformsLabel,
  canBlockBridged,
  maskedAuthorLabel,
  messageAuthorDisplay,
  messageAuthorKey,
  puppetReactorName,
} from './webhooks';

const ROOM = 'r1';
const SPACE = 's1';
const HOOK = '900';
const BOT = '800';

function webhookMessage(id: string, name: string, extra: Partial<DecryptedMessage> = {}): DecryptedMessage {
  return message(ROOM, id, HOOK, {
    webhook_id: HOOK,
    masquerade: { kind: 'webhook', name },
    author: { id: HOOK, username: name, display_name: name, bot: true } as DecryptedMessage['author'],
    ...extra,
  });
}

function bridged(id: string, puppet: string, name: string, m: Partial<MessageMasquerade> = {}): DecryptedMessage {
  return message(ROOM, id, BOT, {
    webhook_id: HOOK,
    masquerade: {
      kind: 'bridge',
      name,
      avatar: 'https://chat.example/api/media/v1/external/sig/abc',
      colour: 0xe74c3c,
      bridge: { id: HOOK, name: 'Discord #general', platform: 'discord', puppet_id: puppet },
      via: { id: BOT, username: 'strife', display_name: 'Strife', bot: true },
      ...m,
    },
    author: { id: puppet, username: name, display_name: name, bot: true } as DecryptedMessage['author'],
  });
}

function seedSpace(everyonePerms: number, extra: { bridges?: unknown[] } = {}) {
  const ev = role('ev', 0, everyonePerms, { name: '@everyone' });
  setSpaces('spaces', [space(SPACE, [ev])]);
  setSpaces('spaceRoomsBySpaceId', { [SPACE]: [sroom(ROOM, 3, extra.bridges ? { bridges: extra.bridges as never } : {})] });
  setSpaceMembers('bySpaceId', SPACE, [member(ME, []), member('alice', [], { username: 'alice', display_name: 'Alice' })]);
}

beforeAll(async () => {
  // eslint-disable-next-line import/no-named-as-default-member -- i18next's instance
  await i18next.init({ lng: 'en', initAsync: false, resources: { en: { translation: webEn } }, interpolation: { escapeValue: false } });
});

beforeEach(() => {
  resetStores();
  clearBridges();
  setAppearance('externalAvatars', true);
});

describe('who a message shows as', () => {
  test('a webhook: its posted-as name, the WEBHOOK identity, the default avatar from the webhook id', () => {
    const a = messageAuthorDisplay(webhookMessage('1', 'CI'), { roomId: ROOM });
    expect(a.name).toBe('CI');
    expect(a.userId).toBe(HOOK);
    expect(a.webhook).toMatchObject({ id: HOOK, kind: 'webhook' });
    expect(a.bot).toBeFalsy();
    expect(a.nameColor).toBeUndefined();
    expect(maskedAuthorLabel(a)).toBe('CI (webhook)');
  });

  test('a webhook without a name says "Webhook"', () => {
    const m = message(ROOM, '1', HOOK, { webhook_id: HOOK });
    expect(messageAuthorDisplay(m, { roomId: ROOM }).name).toBe('Webhook');
  });

  test('a bridged person: puppet id (their own default avatar), platform, the bot behind it, their own colour', () => {
    const a = messageAuthorDisplay(bridged('1', 'p77', 'Alice'), { roomId: ROOM });
    expect(a.name).toBe('Alice');
    expect(a.userId).toBe('p77');
    expect(a.webhook?.kind).toBe('bridge');
    expect(a.webhook?.bridge).toMatchObject({ platform: 'discord', bridgeName: 'Discord #general', via: { id: BOT, name: 'Strife' } });
    expect(a.nameColor).toBe('#e74c3c');
    expect(a.avatar).toBe('https://chat.example/api/media/v1/external/sig/abc');
    expect(maskedAuthorLabel(a)).toBe('Alice (Discord)');
  });

  test('"Show webhook and bridged avatars" off: the default avatar', () => {
    setAppearance('externalAvatars', false);
    expect(messageAuthorDisplay(bridged('1', 'p77', 'Alice'), { roomId: ROOM }).avatar).toBeUndefined();
  });

  test("a person's message is the person (maskedAuthorLabel says nothing)", () => {
    setSpaces('spaces', [space(SPACE, [role('ev', 0, PermViewChannel, { name: '@everyone' })])]);
    const a = messageAuthorDisplay(message(ROOM, '1', ME), { roomId: ROOM });
    expect(a.webhook).toBeUndefined();
    expect(a.name).toBe('Me');
    expect(maskedAuthorLabel(a)).toBeUndefined();
  });

  test("a webhook's compatibility author never becomes a participant", () => {
    (setMessages as unknown as (k: string, r: string, v: DecryptedMessage[]) => void)('byRoom', ROOM, [webhookMessage('1', 'CI')]);
    expect(findParticipant(HOOK, { roomId: ROOM })).toBeUndefined();
    (setMessages as unknown as (k: string, r: string, v: DecryptedMessage[]) => void)('byRoom', ROOM, [
      message(ROOM, '2', 'bob', { author: user('bob', { display_name: 'Bob' }) }),
    ]);
    expect(findParticipant('bob', { roomId: ROOM })?.display_name).toBe('Bob');
  });

  test('a reply to a bridged message names the bridged person with their tag, never the bot', () => {
    seedSpace(orPerms(PermViewChannel, PermSendMessages));
    const original = bridged('10', 'p77', 'Alice');
    (setMessages as unknown as (k: string, r: string, v: DecryptedMessage[]) => void)('byRoom', ROOM, [original]);
    const ref = replyReferenceView(ROOM, '10', undefined);
    expect(ref).toMatchObject({ state: 'found', authorName: 'Alice', authorId: 'p77', authorBot: false, authorColour: '#e74c3c' });
    if (ref.state === 'found') expect(ref.authorWebhook?.kind).toBe('bridge');
  });
});

describe('grouping by author key', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 10, 12, 0, s)).toISOString();
  const row = (id: string, m: DecryptedMessage, s: number): ListMessage => ({
    id,
    sender_id: m.sender_id,
    created_at: at(s),
    ...(m.webhook_id ? { authorKey: messageAuthorKey(m) } : {}),
  });
  const headers = (list: ListMessage[]) =>
    buildMessageList({
      messages: list,
      currentUserId: ME,
      isBlocked: () => false,
      lastReadMessageId: null,
      maxMessageIdWhenEntered: null,
      newHeaderDismissed: true,
      hasMoreOlder: false,
      hasMoreNewer: false,
    })
      .items.filter((i) => i.kind === 'message')
      .map((i) => (i.kind === 'message' && i.showHeader ? `${i.id}*` : i.kind === 'message' ? i.id : ''));

  test('one webhook as "CI", "CI", "Deploy": two authors', () => {
    expect(headers([row('1', webhookMessage('1', 'CI'), 1), row('2', webhookMessage('2', 'CI'), 2), row('3', webhookMessage('3', 'Deploy'), 3)])).toEqual(['1*', '2', '3*']);
  });

  test('two bridged people through one bot never merge, nor with the bot itself', () => {
    const botOwn = message(ROOM, '4', BOT);
    expect(
      headers([row('1', bridged('1', 'p1', 'Alice'), 1), row('2', bridged('2', 'p1', 'Alice'), 2), row('3', bridged('3', 'p2', 'Bob'), 3), row('4', botOwn, 4)]),
    ).toEqual(['1*', '2', '3*', '4*']);
  });

  test("a person's key is their sender", () => {
    expect(listAuthorKey({ sender_id: '5' })).toBe('u:5');
    expect(messageAuthorKey(message(ROOM, '1', '5'))).toBe('u:5');
  });
});

describe('the message sheet', () => {
  const gates = { canReact: true, canReply: true, canPin: false, canDeleteOthers: false, canOfferCreateThread: false };

  test('a webhook message is never your own: no Edit, Report offered', () => {
    // Even a webhook whose id happened to be yours (it never is) would not be.
    const m = { ...webhookMessage('1', 'CI'), sender_id: ME };
    const actions = messageActions(m, ME, gates);
    expect(actions).not.toContain('edit');
    expect(actions).not.toContain('delete');
    expect(actions).toContain('report');
  });

  test('a moderator may block a bridged person; nobody may block a webhook', () => {
    expect(messageActions(bridged('1', 'p1', 'Alice'), ME, gates, { canBlockBridged: true })).toContain('blockBridged');
    expect(messageActions(bridged('1', 'p1', 'Alice'), ME, gates, { canBlockBridged: false })).not.toContain('blockBridged');
    expect(messageActions(webhookMessage('1', 'CI'), ME, gates, { canBlockBridged: true })).not.toContain('blockBridged');
  });

  test('blocking is Kick Members or Manage Messages in the room', () => {
    seedSpace(orPerms(PermViewChannel, PermSendMessages));
    expect(canBlockBridged(SPACE, ROOM)).toBe(false);
    seedSpace(orPerms(PermViewChannel, PermSendMessages, PermManageMessages));
    expect(canBlockBridged(SPACE, ROOM)).toBe(true);
    seedSpace(orPerms(PermViewChannel, PermSendMessages, PermKickMembers));
    expect(canBlockBridged(SPACE, ROOM)).toBe(true);
  });
});

describe('reactors and namesakes', () => {
  test('a bridged reactor is "Alice (Discord)"; a person is left to the member list', () => {
    expect(puppetReactorName({ id: 'p1', username: 'Alice', puppet: { platform: 'discord' } } as never)).toBe('Alice (Discord)');
    expect(puppetReactorName({ id: 'p1', display_name: 'Mx', bridge: { platform: 'other', platform_name: 'Mastodon' } } as never)).toBe('Mx (Mastodon)');
    expect(puppetReactorName({ id: 'u1', username: 'bob' } as never)).toBeUndefined();
  });

  test('"Not the Strafe account": the server\'s verdict, else a member with the same name skeleton', () => {
    seedSpace(PermViewChannel);
    expect(bridgedNamesake(SPACE, 'Ａlice', undefined)).toEqual({ id: 'alice', username: 'alice' });
    expect(bridgedNamesake(SPACE, 'Carol', undefined)).toBeUndefined();
    expect(bridgedNamesake(SPACE, 'Whoever', { id: 'alice', username: '' })).toEqual({ id: 'alice', username: 'alice' });
  });
});

describe('bridges', () => {
  test('platforms are named once each', () => {
    expect(bridgedPlatformsLabel([{ platform: 'discord' }, { platform: 'discord' }, { platform: 'matrix' }, { platform: 'other', platform_name: 'Mastodon' }])).toBe(
      'Discord, Matrix, Mastodon',
    );
  });

  test('consent: the per-space choice, else the account default when off, else the space mode', () => {
    seedSpace(PermViewChannel);
    expect(bridgeConsentView(SPACE)).toMatchObject({ effective: 'allow', mode: 'optout', spaceState: 'inherit', spaceLoaded: false });
    setAuth('user', { id: ME, username: 'me', bridge_consent: 'deny' } as never);
    expect(bridgeConsentView(SPACE).effective).toBe('deny');
    setSpaceConsentLocal(SPACE, 'allow');
    expect(bridgeConsentView(SPACE)).toMatchObject({ effective: 'allow', spaceState: 'allow', spaceLoaded: true });
    setSpaces('spaces', 0, 'bridge_consent_mode', 'optin');
    setSpaceConsentLocal(SPACE, 'inherit');
    setAuth('user', { id: ME, username: 'me' } as never);
    expect(bridgeConsentView(SPACE)).toMatchObject({ effective: 'deny', mode: 'optin' });
  });
});
