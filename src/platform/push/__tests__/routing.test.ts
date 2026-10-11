/**
 * Opening a push's target: now, after start-up, or after switching to its account - and
 * Answer only joining a call that is still there.
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

const mockAccounts = { list: [] as { id: string }[], active: null as string | null, loaded: true };
jest.mock('@web/desktop/accounts', () => ({
  desktopAccounts: () => mockAccounts.list,
  activeDesktopAccountId: () => mockAccounts.active,
  desktopAccountsLoaded: () => mockAccounts.loaded,
}));

const routing = require('../routing') as typeof import('../routing');
const slots = require('../slots') as typeof import('../slots');
const { redirectSystemPath } = require('../../../app/+native-intent') as typeof import('../../../app/+native-intent');
const { appStorage } = jest.requireMock('../../storage') as { appStorage: { clearAll(): void } };

const A = 'a.example:1';
const B = 'b.example:2';

function makeHost(overrides: Partial<import('../routing').PushRoutingHost> = {}) {
  let ready = true;
  const host = {
    ready: jest.fn(() => ready),
    switchAccount: jest.fn(async (_id: string) => undefined),
    openRoom: jest.fn((_roomId: string, _spaceId: string | undefined) => undefined),
    jumpToMessage: jest.fn((_roomId: string, _messageId: string) => undefined),
    focusComposer: jest.fn((_roomId: string) => undefined),
    callState: jest.fn((_roomId: string): 'ringing' | 'ongoing' | 'none' => 'none'),
    acceptIncomingCall: jest.fn(async () => undefined),
    joinCall: jest.fn(async (_roomId: string, _spaceId: string | undefined) => undefined),
    ...overrides,
  };
  return { host, setReady: (r: boolean) => (ready = r) };
}

beforeEach(() => {
  appStorage.clearAll();
  mockAccounts.list = [{ id: A }, { id: B }];
  mockAccounts.active = A;
  mockAccounts.loaded = true;
  routing.setPushRoutingHost(null);
});

describe('routePushTarget', () => {
  it('opens a room of the open account at once', () => {
    const { host } = makeHost();
    routing.setPushRoutingHost(host);
    routing.routePushTarget({ slot: slots.slotFor(A), roomId: '10', spaceId: '20' });
    expect(host.openRoom).toHaveBeenCalledWith('10', '20');
    expect(routing.pendingPushTarget()).toBeNull();
  });

  it('lands on the notified message, but not when answering a call', () => {
    const { host } = makeHost();
    routing.setPushRoutingHost(host);
    routing.routePushTarget({ slot: slots.slotFor(A), roomId: '10', messageId: '99' });
    expect(host.jumpToMessage).toHaveBeenCalledWith('10', '99');
    routing.routePushTarget({ slot: slots.slotFor(A), roomId: '11', messageId: '98', action: 'answer' });
    expect(host.jumpToMessage).toHaveBeenCalledTimes(1);
  });

  it('waits for the session, then opens', () => {
    const { host, setReady } = makeHost();
    setReady(false);
    routing.setPushRoutingHost(host);
    routing.routePushTarget({ slot: slots.slotFor(A), roomId: '10' });
    expect(host.openRoom).not.toHaveBeenCalled();
    setReady(true);
    routing.processPendingPushTarget();
    expect(host.openRoom).toHaveBeenCalledWith('10', undefined);
  });

  it('a cold start: written down before the app is wired, settled after', () => {
    const slot = slots.slotFor(A);
    expect(redirectSystemPath({ path: `strafe://push/open?slot=${slot}&rid=10`, initial: true })).toBe('/');
    expect(routing.pendingPushTarget()).toEqual({ slot, roomId: '10' });
    const { host } = makeHost();
    routing.setPushRoutingHost(host);
    routing.processPendingPushTarget();
    expect(host.openRoom).toHaveBeenCalledWith('10', undefined);
  });

  it('passes other links through untouched', () => {
    expect(redirectSystemPath({ path: 'strafe://invite/abc', initial: false })).toBe('strafe://invite/abc');
  });

  it('a push link that names no room opens the app (switching account), never a missing screen', () => {
    const { host } = makeHost();
    routing.setPushRoutingHost(host);
    expect(redirectSystemPath({ path: `strafe://push/open?slot=${slots.slotFor(B)}`, initial: false })).toBe('/');
    expect(host.switchAccount).toHaveBeenCalledWith(B);
    // The open account's: nothing to open, nothing pending.
    routing.setPushRoutingHost(makeHost().host);
    routing.simulateRestartForTests();
    mockAccounts.active = B;
    routing.processPendingPushTarget();
    expect(routing.pendingPushTarget()).toBeNull();
    // Malformed push links still land on the root, not on "this screen does not exist".
    expect(redirectSystemPath({ path: 'strafe://push/open?rid=1', initial: false })).toBe('/');
    expect(redirectSystemPath({ path: 'strafe://push/elsewhere', initial: false })).toBe('/');
  });

  it('a link from outside our notifications cannot answer a call or open the composer', () => {
    const { host } = makeHost({ callState: jest.fn((): 'ringing' | 'ongoing' | 'none' => 'ongoing') });
    routing.setPushRoutingHost(host);
    const slot = slots.slotFor(A);
    // This build has no native link key (Jest): no link carries a matching one.
    expect(redirectSystemPath({ path: `strafe://push/open?slot=${slot}&rid=10&answer=1&k=guessed`, initial: false })).toBe('/');
    expect(host.openRoom).toHaveBeenCalledWith('10', undefined);
    expect(host.joinCall).not.toHaveBeenCalled();
    expect(host.acceptIncomingCall).not.toHaveBeenCalled();
    jest.useFakeTimers();
    try {
      redirectSystemPath({ path: `strafe://push/open?slot=${slot}&rid=11&reply=1`, initial: false });
      jest.advanceTimersByTime(1000);
    } finally {
      jest.useRealTimers();
    }
    expect(host.openRoom).toHaveBeenCalledWith('11', undefined);
    expect(host.focusComposer).not.toHaveBeenCalled();
  });

  it('another account: switches to it, and opens after the restart', () => {
    const { host } = makeHost();
    routing.setPushRoutingHost(host);
    routing.routePushTarget({ slot: slots.slotFor(B), roomId: '30' });
    expect(host.switchAccount).toHaveBeenCalledWith(B);
    expect(host.openRoom).not.toHaveBeenCalled();
    // Until the restart, settling again changes nothing (the switch is under way).
    routing.processPendingPushTarget();
    expect(host.switchAccount).toHaveBeenCalledTimes(1);
    expect(routing.pendingPushTarget()).not.toBeNull();
    // The app restarts as B; the same target is picked up.
    routing.simulateRestartForTests();
    mockAccounts.active = B;
    const after = makeHost();
    routing.setPushRoutingHost(after.host);
    routing.processPendingPushTarget();
    expect(after.host.openRoom).toHaveBeenCalledWith('30', undefined);
    expect(after.host.switchAccount).not.toHaveBeenCalled();
  });

  it('gives up when the switch did not happen, instead of looping', () => {
    const { host } = makeHost();
    routing.setPushRoutingHost(host);
    routing.routePushTarget({ slot: slots.slotFor(B), roomId: '30' });
    routing.simulateRestartForTests();
    routing.processPendingPushTarget();
    expect(host.switchAccount).toHaveBeenCalledTimes(1);
    expect(routing.pendingPushTarget()).toBeNull();
  });

  it('drops targets of accounts no longer here, and stale ones', () => {
    const { host } = makeHost();
    routing.setPushRoutingHost(host);
    routing.routePushTarget({ slot: 'unknown_slot', roomId: '1' });
    expect(routing.pendingPushTarget()).toBeNull();

    const { host: h2, setReady } = makeHost();
    setReady(false);
    routing.setPushRoutingHost(h2);
    routing.routePushTarget({ slot: slots.slotFor(A), roomId: '1' });
    setReady(true);
    routing.processPendingPushTarget(Date.now() + routing.PENDING_TTL_MS + 1);
    expect(h2.openRoom).not.toHaveBeenCalled();
    expect(routing.pendingPushTarget()).toBeNull();
  });

  it('Reply focuses the composer once the room is up', async () => {
    const { host } = makeHost();
    routing.setPushRoutingHost(host);
    routing.routePushTarget({ slot: slots.slotFor(A), roomId: '10', action: 'reply' });
    await new Promise((r) => setTimeout(r, 400));
    expect(host.focusComposer).toHaveBeenCalledWith('10');
  });

  it('Answer accepts a ringing call, joins an ongoing one, and never restarts an ended one', () => {
    const ringing = makeHost({ callState: jest.fn(() => 'ringing' as const) });
    routing.setPushRoutingHost(ringing.host);
    routing.routePushTarget({ slot: slots.slotFor(A), roomId: '10', action: 'answer' });
    expect(ringing.host.acceptIncomingCall).toHaveBeenCalled();
    expect(ringing.host.joinCall).not.toHaveBeenCalled();

    const ongoing = makeHost({ callState: jest.fn(() => 'ongoing' as const) });
    routing.setPushRoutingHost(ongoing.host);
    routing.routePushTarget({ slot: slots.slotFor(A), roomId: '10', spaceId: '5', action: 'answer' });
    expect(ongoing.host.joinCall).toHaveBeenCalledWith('10', '5');

    const over = makeHost();
    routing.setPushRoutingHost(over.host);
    routing.routePushTarget({ slot: slots.slotFor(A), roomId: '10', action: 'answer' });
    expect(over.host.openRoom).toHaveBeenCalled();
    expect(over.host.acceptIncomingCall).not.toHaveBeenCalled();
    expect(over.host.joinCall).not.toHaveBeenCalled();
  });
});
