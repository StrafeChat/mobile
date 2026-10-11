/**
 * iOS notification responses to our pushes: taps and Reply / Answer route, Mark as read and
 * Decline act in the background as the push's account; local notifications are not ours.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Platform } from 'react-native';

const mockAckRoom = jest.fn(async (_r: string, _m: string) => undefined);
const mockDeclineCall = jest.fn(async (_r: string) => undefined);
const mockDeclineIncoming = jest.fn(async () => undefined);
const mockVoice = { incoming: null as null | { roomId: string } };
const mockRoute = jest.fn();
const mockClearRoom = jest.fn(async (_s: string, _r: string) => undefined);
const mockSetCategory = jest.fn(async (_id: string, _actions: unknown[]) => ({}));
const mockDismiss = jest.fn(async (_id: string) => undefined);

jest.mock('@web/api/rooms', () => ({ ackRoom: (r: string, m: string) => mockAckRoom(r, m) }));
jest.mock('@web/api/voice', () => ({ declineCall: (r: string) => mockDeclineCall(r) }));
jest.mock('@web/stores/voice', () => ({ voice: mockVoice, declineIncomingCall: () => mockDeclineIncoming() }));
jest.mock('@web/i18n/t', () => ({ t: (k: string) => k }));
jest.mock('@strafe/push', () => ({ clearRoom: (s: string, r: string) => mockClearRoom(s, r) }));
jest.mock('expo-notifications', () => ({
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationCategoryAsync: (id: string, actions: unknown[]) => mockSetCategory(id, actions),
  dismissNotificationAsync: (id: string) => mockDismiss(id),
}));
jest.mock('../../storage', () => ({ appStorage: { getString: () => undefined, set: () => undefined, remove: () => undefined } }));
jest.mock('../routing', () => ({ routePushTarget: (t: unknown) => mockRoute(t) }));

const ACTIVE = { id: 'a:1', slot: 'sa', userId: '1', username: 'a', domain: 'a', apiBase: 'https://api.a', token: 'ta' };
const OTHER = { id: 'b:2', slot: 'sb', userId: '2', username: 'b', domain: 'b', apiBase: 'https://api.b', token: 'tb' };
jest.mock('../accounts', () => ({
  activePushAccount: () => ACTIVE,
  pushAccounts: () => [ACTIVE, OTHER],
}));

const fetchMock = jest.fn(async (_url: string, _init?: RequestInit) => ({ ok: true, status: 204, text: async () => '' }) as unknown as Response);
(globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

const actions = require('../actions') as typeof import('../actions');

function response(strafe: Record<string, string> | null, actionIdentifier = 'expo.modules.notifications.actions.DEFAULT') {
  return {
    actionIdentifier,
    notification: {
      request: {
        identifier: 'n1',
        content: { data: strafe ? { strafe } : { roomId: '5' } },
        trigger: { type: 'push', payload: {} },
      },
    },
  } as never;
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  jest.clearAllMocks();
  mockVoice.incoming = null;
});

describe('handlePushResponse', () => {
  it('leaves local notifications to the local path', () => {
    expect(actions.handlePushResponse(response(null))).toBe(false);
  });

  it('a tap opens the room, on its account', () => {
    expect(actions.handlePushResponse(response({ slot: 'sb', rid: '10', sid: '20', mid: '30', t: 'msg' }))).toBe(true);
    expect(mockRoute).toHaveBeenCalledWith({ slot: 'sb', roomId: '10', spaceId: '20', messageId: '30' });
  });

  it('a push about the account (a test, an undecryptable alert) switches to it, no room', () => {
    expect(actions.handlePushResponse(response({ slot: 'sb', t: 'test' }))).toBe(true);
    expect(mockRoute).toHaveBeenLastCalledWith({ slot: 'sb', roomId: '' });
    // iOS's generic alert carries only the slot.
    expect(actions.handlePushResponse(response({ slot: 'sb' }))).toBe(true);
    expect(mockRoute).toHaveBeenLastCalledWith({ slot: 'sb', roomId: '' });
    // Its Mark as read has nothing to read.
    actions.handlePushResponse(response({ slot: 'sb' }, actions.ACTION_MARK_READ));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Reply and Answer route with their action', () => {
    actions.handlePushResponse(response({ slot: 'sa', rid: '10', t: 'msg' }, actions.ACTION_REPLY));
    expect(mockRoute).toHaveBeenLastCalledWith({ slot: 'sa', roomId: '10', action: 'reply' });
    actions.handlePushResponse(response({ slot: 'sa', rid: '11', t: 'call' }, actions.ACTION_ANSWER));
    expect(mockRoute).toHaveBeenLastCalledWith({ slot: 'sa', roomId: '11', action: 'answer' });
    expect(mockDismiss).toHaveBeenCalledWith('n1');
  });

  it('Mark as read acks through the web API for the open account', async () => {
    actions.handlePushResponse(response({ slot: 'sa', rid: '10', mid: '30', t: 'msg' }, actions.ACTION_MARK_READ));
    await settle();
    expect(mockAckRoom).toHaveBeenCalledWith('10', '30');
    expect(mockClearRoom).toHaveBeenCalledWith('sa', '10');
    expect(mockRoute).not.toHaveBeenCalled();
  });

  it('Mark as read acks with the other account’s own session', async () => {
    actions.handlePushResponse(response({ slot: 'sb', rid: '10', mid: '30', t: 'msg' }, actions.ACTION_MARK_READ));
    await settle();
    expect(mockAckRoom).not.toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://api.b/rooms/10/ack');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tb');
    expect(JSON.parse(init?.body as string)).toEqual({ last_read_message_id: '30' });
  });

  it('Decline goes through the voice store when it is ringing, else the API', async () => {
    mockVoice.incoming = { roomId: '10' };
    actions.handlePushResponse(response({ slot: 'sa', rid: '10', t: 'call' }, actions.ACTION_DECLINE));
    await settle();
    expect(mockDeclineIncoming).toHaveBeenCalled();
    mockVoice.incoming = null;
    actions.handlePushResponse(response({ slot: 'sa', rid: '12', t: 'call' }, actions.ACTION_DECLINE));
    await settle();
    expect(mockDeclineCall).toHaveBeenCalledWith('12');
    actions.handlePushResponse(response({ slot: 'sb', rid: '13', t: 'call' }, actions.ACTION_DECLINE));
    await settle();
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('https://api.b/rooms/13/call/decline');
  });
});

describe('registerPushCategories', () => {
  it('registers both categories on iOS, once per language', async () => {
    (Platform as { OS: string }).OS = 'ios';
    await actions.registerPushCategories();
    await actions.registerPushCategories();
    expect(mockSetCategory.mock.calls.map((c) => c[0])).toEqual([actions.MESSAGE_CATEGORY, actions.CALL_CATEGORY]);
    expect(mockSetCategory.mock.calls[1]![1]).toEqual([
      { identifier: 'answer', buttonTitle: 'mobile.push.answer', options: { opensAppToForeground: true } },
      { identifier: 'decline', buttonTitle: 'mobile.push.decline', options: { opensAppToForeground: false, isDestructive: true } },
    ]);
  });
});
