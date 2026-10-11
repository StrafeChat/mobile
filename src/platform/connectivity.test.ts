import { API, flush, reply, resetEnv, routeFetch } from './boot.testenv';
import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

type Connectivity = typeof import('./connectivity');
type Network = { isConnected: boolean | null; isInternetReachable: boolean | null };
type AppStateHandler = (state: string) => void;

let conn: Connectivity;
let reportOnline: jest.Mock;
let setNetwork: (s: Network) => void;
let appStateChange: AppStateHandler;
let stop: () => void;

beforeEach(async () => {
  jest.useFakeTimers({ doNotFake: ['queueMicrotask', 'nextTick'] });
  resetEnv();
  localStorage.setItem('session_token', 'tok-1');
  localStorage.setItem('strafe.desktop.instance', JSON.stringify({ domain: 'chat.example.org', apiUrl: API, stargateUrl: 'wss://x' }));
  const { AppState } = require('react-native') as { AppState: { currentState: unknown; addEventListener: jest.Mock } };
  AppState.currentState = 'active';
  conn = require('./connectivity') as Connectivity;
  reportOnline = (require('@/platform/shims/window') as { reportOnline: jest.Mock }).reportOnline;
  setNetwork = (require('@react-native-community/netinfo') as { __setNetwork(s: Network): void }).__setNetwork;
  stop = conn.startConnectivity();
  appStateChange = AppState.addEventListener.mock.calls.at(-1)![1] as AppStateHandler;
  await flush();
});

afterEach(() => {
  stop();
  jest.useRealTimers();
});

describe('connectivity', () => {
  test('only a definite "no" is offline', () => {
    expect(conn.isReachable({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(conn.isReachable({ isConnected: null, isInternetReachable: null })).toBe(true);
    expect(conn.isReachable({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(conn.isReachable({ isConnected: false, isInternetReachable: null })).toBe(false);
  });

  test('network changes become window online / offline, once per change', () => {
    expect(reportOnline).not.toHaveBeenCalled();
    setNetwork({ isConnected: false, isInternetReachable: false });
    setNetwork({ isConnected: false, isInternetReachable: false });
    expect(reportOnline.mock.calls).toEqual([[false]]);
    expect(conn.isOnline()).toBe(false);
    setNetwork({ isConnected: true, isInternetReachable: null });
    expect(reportOnline.mock.calls).toEqual([[false], [true]]);
    expect(conn.isOnline()).toBe(true);
  });

  test('going to the background flushes the pending read position', async () => {
    const fetch = routeFetch({ '/rooms/9/ack': () => reply(204) });
    (globalThis as unknown as { fetch: unknown }).fetch = fetch;
    (require('@web/stores/pendingAck') as typeof import('@web/stores/pendingAck')).setPendingAck('9', '10');
    appStateChange('inactive');
    expect(fetch).not.toHaveBeenCalled();
    appStateChange('background');
    await flush();
    expect(fetch).toHaveBeenCalledWith(
      `${API}/rooms/9/ack`,
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ last_read_message_id: '10' }) }),
    );
  });

  test('a long absence wakes the gateway and re-pulls the room on screen; a short one does neither', () => {
    const rooms = require('./rooms') as typeof import('./rooms');
    const msgs = require('@web/stores/messages') as { setMessages(...a: unknown[]): void; loadMessages: jest.Mock };
    msgs.setMessages('byRoom', '300', [{ id: '301' }]);
    const entry = rooms.enterRoom('300', { spaceId: null });
    msgs.loadMessages.mockClear();

    appStateChange('background');
    jest.advanceTimersByTime(3_000);
    appStateChange('active');
    expect(reportOnline).not.toHaveBeenCalled();
    expect(msgs.loadMessages).not.toHaveBeenCalled();

    appStateChange('background');
    jest.advanceTimersByTime(45_000);
    appStateChange('active');
    expect(reportOnline).toHaveBeenCalledWith(true);
    expect(msgs.loadMessages).toHaveBeenCalledWith('300', undefined, undefined, { quiet: true });
    entry.leave();
  });
});
