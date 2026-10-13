/**
 * The pure parts of push: deep links and iOS routing data, slots, who shows a notification,
 * and the strings handed to the native renderer.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('../../storage', () => {
  const m = new Map<string, unknown>();
  return {
    appStorage: {
      getString: (k: string) => m.get(k) as string | undefined,
      set: (k: string, v: unknown) => void m.set(k, v),
      remove: (k: string) => void m.delete(k),
      clearAll: () => m.clear(),
    },
  };
});

const { buildPushUrl, isPushUrl, parsePushUrl, pushDataOf, trustedLinkTarget } = require('../links') as typeof import('../links');
const slots = require('../slots') as typeof import('../slots');
const { presentRemoteNotification, presentRemotePush, suppressLocalNotification } = require('../suppression') as typeof import('../suppression');
const { appStorage } = jest.requireMock('../../storage') as { appStorage: { clearAll(): void } };

beforeEach(() => appStorage.clearAll());

describe('push deep links', () => {
  it('parses what the Android renderer builds', () => {
    expect(parsePushUrl('strafe://push/open?slot=1a2b3c4d_100&rid=456&sid=789&mid=1011')).toEqual({
      slot: '1a2b3c4d_100',
      roomId: '456',
      spaceId: '789',
      messageId: '1011',
    });
    expect(parsePushUrl('strafe://push/open?slot=s&rid=456&reply=1')).toEqual({ slot: 's', roomId: '456', action: 'reply' });
    expect(parsePushUrl('strafe://push/open?slot=s&rid=456&answer=1')).toEqual({ slot: 's', roomId: '456', action: 'answer' });
  });

  it('round-trips', () => {
    const target = { slot: 'abc_1', roomId: '2', spaceId: '3', messageId: '4', action: 'reply' as const };
    expect(parsePushUrl(buildPushUrl(target))).toEqual(target);
  });

  it('refuses anything else, or anything malformed', () => {
    expect(parsePushUrl('strafe://invite/abc')).toBeNull();
    expect(parsePushUrl('https://push/open?slot=s&rid=1')).toBeNull();
    expect(parsePushUrl('strafe://push/open?slot=s&rid=../../x')).toBeNull();
    expect(parsePushUrl('strafe://push/open?slot=bad%20slot&rid=1')).toBeNull();
    expect(parsePushUrl(`strafe://push/open?slot=${'x'.repeat(33)}&rid=1`)).toBeNull();
    // A bad optional id is dropped, not trusted.
    expect(parsePushUrl('strafe://push/open?slot=s&rid=1&sid=abc')).toEqual({ slot: 's', roomId: '1' });
  });

  it('a link with only a slot is about the account (the test notification, the group summary)', () => {
    expect(parsePushUrl('strafe://push/open?slot=s')).toEqual({ slot: 's', roomId: '' });
    expect(parsePushUrl('strafe://push/open?slot=s&k=abc')).toEqual({ slot: 's', roomId: '', key: 'abc' });
    // Nothing to reply in or answer without a room.
    expect(parsePushUrl('strafe://push/open?slot=s&answer=1')).toEqual({ slot: 's', roomId: '' });
    expect(parsePushUrl(buildPushUrl({ slot: 's', roomId: '' }))).toEqual({ slot: 's', roomId: '' });
    // A room id that is there but not an id is still refused.
    expect(parsePushUrl('strafe://push/open?slot=s&rid=')).toBeNull();
  });

  it('recognises every push link, parseable or not', () => {
    expect(isPushUrl('strafe://push/open?slot=s')).toBe(true);
    expect(isPushUrl('strafe://push/whatever')).toBe(true);
    expect(isPushUrl('STRAFE://push')).toBe(true);
    expect(isPushUrl('strafe://pushy/open')).toBe(false);
    expect(isPushUrl('strafe://invite/abc')).toBe(false);
  });

  it('a link only answers or replies with this install’s key', () => {
    const answer = parsePushUrl('strafe://push/open?slot=s&rid=1&answer=1&k=secret-key')!;
    expect(answer).toEqual({ slot: 's', roomId: '1', action: 'answer', key: 'secret-key' });
    // Our own notification's link: the action stands, the key goes no further.
    expect(trustedLinkTarget(answer, 'secret-key')).toEqual({ slot: 's', roomId: '1', action: 'answer' });
    // Anything else that opens the link - another app, a web page - opens the room, nothing more.
    expect(trustedLinkTarget(answer, 'another-key')).toEqual({ slot: 's', roomId: '1' });
    expect(trustedLinkTarget(answer, null)).toEqual({ slot: 's', roomId: '1' });
    const forged = parsePushUrl('strafe://push/open?slot=s&rid=1&mid=9&reply=1')!;
    expect(trustedLinkTarget(forged, 'secret-key')).toEqual({ slot: 's', roomId: '1', messageId: '9' });
    // An empty key never matches.
    expect(trustedLinkTarget({ ...forged, key: '' }, '')).toEqual({ slot: 's', roomId: '1', messageId: '9' });
    // A malformed key is not even parsed.
    expect(parsePushUrl('strafe://push/open?slot=s&rid=1&k=a%20b')).toEqual({ slot: 's', roomId: '1' });
  });
});

describe('iOS routing data', () => {
  it('reads data.strafe as the extension writes it', () => {
    expect(pushDataOf({ data: { strafe: { slot: 's', rid: '1', sid: '2', mid: '3', t: 'msg' } } })).toEqual({
      slot: 's',
      roomId: '1',
      spaceId: '2',
      messageId: '3',
      type: 'msg',
    });
  });

  it('falls back to the raw APNs payload', () => {
    expect(pushDataOf({ data: {} }, { body: { strafe: { slot: 's', rid: '1', t: 'call' } } })).toEqual({ slot: 's', roomId: '1', type: 'call' });
  });

  it('accepts a test push without a room, nothing that is not ours', () => {
    expect(pushDataOf({ data: { strafe: { slot: 's', t: 'test' } } })).toEqual({ slot: 's', roomId: '', type: 'test' });
    expect(pushDataOf({ data: { roomId: '1' } })).toBeNull();
    // iOS's generic alert for an undecryptable push names only the slot.
    expect(pushDataOf({ data: { strafe: { slot: 's' } } })).toEqual({ slot: 's', roomId: '', type: 'msg' });
    expect(pushDataOf({ data: { strafe: { rid: '1' } } })).toBeNull();
    expect(pushDataOf(null)).toBeNull();
  });
});

describe('slots', () => {
  it('are in the native charset, short, and stable', () => {
    const id = 'chat.some-really-long-instance-name.example.org:123456789012345678';
    const slot = slots.slotFor(id);
    expect(slots.isValidSlot(slot)).toBe(true);
    expect(slot.length).toBeLessThanOrEqual(32);
    expect(slot.endsWith('_123456789012345678')).toBe(true);
    expect(slots.slotFor(id)).toBe(slot);
    expect(slots.accountForSlot(slot)).toBe(id);
  });

  it('never give two accounts the same slot', () => {
    // Same user id, two instances: different domain hashes.
    expect(slots.slotFor('a.example:1')).not.toBe(slots.slotFor('b.example:1'));
    // A forced collision (two ids that truncate alike) gets a suffix.
    const long = '9'.repeat(40);
    const first = slots.slotFor(`x.example:${long}1`);
    const second = slots.slotFor(`x.example:${long}2`);
    expect(first).not.toBe(second);
    expect(slots.isValidSlot(second)).toBe(true);
  });

  it('are released with their account', () => {
    const slot = slots.slotFor('a.example:1');
    slots.releaseSlot('a.example:1');
    expect(slots.existingSlot('a.example:1')).toBeNull();
    expect(slots.accountForSlot(slot)).toBeNull();
  });

  it('fingerprints are stable and distinct', () => {
    expect(slots.fingerprint('abc')).toBe(slots.fingerprint('abc'));
    expect(slots.fingerprint('abc')).not.toBe(slots.fingerprint('abd'));
    expect(slots.fingerprint('abc')).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('suppression', () => {
  it('the local message notification stands aside only in the background with push working', () => {
    const msg = { tag: 'room:123' };
    expect(suppressLocalNotification(msg, 'background', true)).toBe(true);
    expect(suppressLocalNotification(msg, 'inactive', true)).toBe(true);
    expect(suppressLocalNotification(msg, 'active', true)).toBe(false);
    expect(suppressLocalNotification(msg, 'background', false)).toBe(false);
    // Not a message notification: never covered by a push.
    expect(suppressLocalNotification({ tag: 'strafe-test' }, 'background', true)).toBe(false);
    expect(suppressLocalNotification({}, 'background', true)).toBe(false);
  });

  it('a push reaching the active app shows unless it is the open account’s', () => {
    const data = { slot: 'a', roomId: '1', type: 'msg' };
    expect(presentRemotePush(data, 'a', true, 'active', true)).toEqual({ show: false, sound: false });
    expect(presentRemotePush(data, 'b', true, 'active', true)).toEqual({ show: true, sound: true });
    expect(presentRemotePush(data, null, false, 'active', true)).toEqual({ show: true, sound: false });
    expect(presentRemotePush({ ...data, type: 'test' }, 'a', true, 'active', true)).toEqual({ show: true, sound: true });
  });

  it('open but inactive (iOS: Notification Center over it), the open account’s message notifies exactly once', () => {
    const data = { slot: 'a', roomId: '1', type: 'msg' };
    const msg = { tag: 'room:1' };
    // Push working: the local one stands aside, so the push shows.
    expect(suppressLocalNotification(msg, 'inactive', true)).toBe(true);
    expect(presentRemotePush(data, 'a', true, 'inactive', true)).toEqual({ show: true, sound: true });
    // Push not known to work: the local one shows, so the push stays hidden.
    expect(suppressLocalNotification(msg, 'inactive', false)).toBe(false);
    expect(presentRemotePush(data, 'a', true, 'inactive', false)).toEqual({ show: false, sound: false });
    // A call rings in the app itself.
    expect(presentRemotePush({ ...data, type: 'call' }, 'a', true, 'inactive', true)).toEqual({ show: false, sound: false });
    expect(presentRemoteNotification({ data: { strafe: { slot: 'a', rid: '1', t: 'msg' } } }, undefined, 'a', false, 'inactive', true)).toEqual({
      show: true,
      sound: false,
    });
  });

  it('a gateway push with nothing to route (the extension showed nothing) stays hidden', () => {
    // The extension's "nothing to show" content: only the gateway's slot in the payload.
    expect(presentRemoteNotification({ data: {} }, { aps: {}, s: 'a' }, 'a', true, 'active', true)).toEqual({ show: false, sound: false });
    expect(presentRemoteNotification({ data: {} }, { aps: {}, s: 'b' }, 'a', true, 'active', true)).toEqual({ show: false, sound: false });
    expect(presentRemoteNotification({ data: {} }, { aps: {}, s: 'a' }, 'a', true, 'inactive', true)).toEqual({ show: false, sound: false });
    // The generic alert of an undecryptable push: hidden for the open account, shown for another.
    expect(presentRemoteNotification({ data: { strafe: { slot: 'a' } } }, { s: 'a' }, 'a', true, 'active', true)).toEqual({ show: false, sound: false });
    expect(presentRemoteNotification({ data: { strafe: { slot: 'b' } } }, { s: 'b' }, 'a', true, 'active', true)).toEqual({ show: true, sound: true });
    // Not ours at all: the default presentation.
    expect(presentRemoteNotification({ data: { roomId: '1' } }, { aps: {} }, 'a', true, 'active', true)).toBeNull();
    expect(presentRemoteNotification({ data: {} }, undefined, 'a', true, 'active', true)).toBeNull();
  });
});
