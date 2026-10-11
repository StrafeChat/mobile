/**
 * Opening what a push notification was about.
 *
 * A tap can arrive for the account that is open (open the room now), while the app is still
 * starting (open it once the session is ready), or for another account on this device. Each
 * account is its own JS session here (session.ts: switching restarts the app), so the last
 * case is: remember the target, switch through the app's account switcher, and pick the
 * target up again after the restart. One path covers all three - the target is written
 * down first and then settled by processPendingPushTarget(), which the lifecycle calls again
 * whenever the session's state moves.
 *
 * Reply focuses the composer; Answer joins the call through the app's own join flow, which
 * keeps every rule a join button has (no call without encryption, permission prompts, the
 * switch-call confirmation) - and only while the call is still there, so a late tap never
 * rings the caller back.
 */
import { createSignal } from 'solid-js';
import { activeDesktopAccountId, desktopAccounts, desktopAccountsLoaded } from '@web/desktop/accounts';
import { appStorage } from '../storage';
import { accountForSlot } from './slots';
import type { PushTarget } from './links';

const PENDING_KEY = 'strafe.push.pendingTarget';
/** The shell's panel animation, after which the conversation's composer is mounted. */
const COMPOSER_FOCUS_DELAY_MS = 350;
/** A target older than this is stale: whatever it was about has moved on. */
export const PENDING_TTL_MS = 10 * 60 * 1000;

interface PendingTarget {
  target: PushTarget;
  at: number;
  /**
   * The JS run that started the account switch for it. The same run: the switch is under
   * way (the restart is coming). A later run still on another account: the switch failed
   * or was refused - give up rather than loop.
   */
  switchedIn?: string;
}

/** This JS run (an account switch restarts the JS, so the next run has another). */
const RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * What opening a target needs from the app; injected by the lifecycle (and by tests). Kept
 * out of this module so the deep-link entry (+native-intent) loads nothing of the session.
 */
export interface PushRoutingHost {
  /** The session is up and the shell can show a room. */
  ready(): boolean;
  switchAccount(accountId: string): Promise<void>;
  /** Show the room; `spaceId` undefined when the push did not say (look it up). */
  openRoom(roomId: string, spaceId: string | undefined): void;
  /** Scroll the open room to a message, loading a window around it when it isn't loaded. */
  jumpToMessage(roomId: string, messageId: string): void;
  focusComposer(roomId: string): void;
  /** What the room's call is doing for this account right now. */
  callState(roomId: string): 'ringing' | 'ongoing' | 'none';
  acceptIncomingCall(): Promise<unknown>;
  joinCall(roomId: string, spaceId: string | undefined): Promise<unknown>;
}

let host: PushRoutingHost | null = null;
const [pendingTick, setPendingTick] = createSignal(0);

export function setPushRoutingHost(next: PushRoutingHost | null): void {
  host = next;
}

/** Bumps when a target is written down, for the lifecycle's effect to settle it. */
export function pendingPushTargetTick(): number {
  return pendingTick();
}

function readPending(): PendingTarget | null {
  try {
    const raw = appStorage.getString(PENDING_KEY);
    const p = raw ? (JSON.parse(raw) as PendingTarget) : null;
    return p && p.target && typeof p.target.slot === 'string' && typeof p.target.roomId === 'string' ? p : null;
  } catch {
    return null;
  }
}

function writePending(p: PendingTarget | null): void {
  if (p) appStorage.set(PENDING_KEY, JSON.stringify(p));
  else appStorage.remove(PENDING_KEY);
}

/** Open `target` now if possible, else as soon as possible (possibly after an account switch). */
export function routePushTarget(target: PushTarget): void {
  writePending({ target, at: Date.now() });
  setPendingTick((n) => n + 1);
  processPendingPushTarget();
}

/**
 * Settle the written-down target, if any: open it, switch to its account, keep waiting for
 * the session, or drop it (stale, or its account is gone). Safe to call any time.
 */
export function processPendingPushTarget(now = Date.now()): void {
  const pending = readPending();
  if (!pending || !host) return;
  if (!(now - pending.at < PENDING_TTL_MS)) {
    writePending(null);
    return;
  }
  // The slot's account comes from the account list, which loads at start-up.
  if (!desktopAccountsLoaded()) return;
  const accountId = accountForSlot(pending.target.slot);
  if (!accountId || !desktopAccounts().some((a) => a.id === accountId)) {
    writePending(null);
    return;
  }
  if (accountId !== activeDesktopAccountId()) {
    if (pending.switchedIn === RUN_ID) return;
    if (pending.switchedIn) {
      writePending(null);
      return;
    }
    writePending({ ...pending, switchedIn: RUN_ID });
    void host.switchAccount(accountId).catch(() => writePending(null));
    return;
  }
  if (!host.ready()) return;
  writePending(null);
  openTarget(host, pending.target);
}

function openTarget(h: PushRoutingHost, target: PushTarget): void {
  // About the account, not a room (a test, the group summary): being on it is the whole job.
  if (!target.roomId) return;
  const spaceId = target.spaceId;
  h.openRoom(target.roomId, spaceId);
  // Land on the message the notification was about (Discord does the same), not wherever the
  // room was last left: a saved scroll position from days ago would hide what was tapped.
  if (target.messageId && target.action !== 'answer') h.jumpToMessage(target.roomId, target.messageId);
  if (target.action === 'reply') {
    // The composer only takes a focus request once it is mounted: after the panel moved.
    setTimeout(() => h.focusComposer(target.roomId), COMPOSER_FOCUS_DELAY_MS);
  } else if (target.action === 'answer') {
    const call = h.callState(target.roomId);
    if (call === 'ringing') void h.acceptIncomingCall();
    else if (call === 'ongoing') void h.joinCall(target.roomId, spaceId);
    // Neither ringing nor going on: the call is over. The room is open; that is all.
  }
}

/** For tests. */
export function pendingPushTarget(): PushTarget | null {
  return readPending()?.target ?? null;
}

/** For tests: pretend the JS restarted (as an account switch does). */
export function simulateRestartForTests(): void {
  const p = readPending();
  if (p?.switchedIn === RUN_ID) writePending({ ...p, switchedIn: 'an-earlier-run' });
}
