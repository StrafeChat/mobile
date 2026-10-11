/**
 * One clock for every live ("R") timestamp on screen, as the web's DynamicTimestamp keeps it:
 * a single 10-second interval that exists only while at least one live timestamp is mounted,
 * so a room full of `<t:…:R>` tokens does not run a timer each.
 */
import { useSyncExternalStore } from 'react';

export const CLOCK_REFRESH_MS = 10_000;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === undefined) {
    timer = setInterval(() => {
      now = Date.now();
      for (const l of [...listeners]) l();
    }, CLOCK_REFRESH_MS);
  }
  // Another clock may have gone stale while nothing was listening.
  now = Date.now();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };
}

const getNow = () => now;
const noSubscribe = () => () => undefined;

/** The shared "now" (ms), refreshed every 10 s while `live`; a fixed value otherwise. */
export function useLiveNow(live: boolean): number {
  return useSyncExternalStore(live ? subscribe : noSubscribe, getNow);
}

/** For tests: how many live timestamps hold the clock. */
export function liveClockListeners(): number {
  return listeners.size;
}
