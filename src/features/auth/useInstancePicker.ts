/**
 * The instance field's behaviour - the web's InstancePicker
 * (web/src/components/desktop/InstancePicker.tsx) on top of chooseInstance():
 *
 * - looked up 700 ms after the last keystroke, at once on the keyboard's Go, or on blur when
 *   nothing is running yet; a newer lookup cancels an older one;
 * - every edit makes the field "not ready" until the instance has answered, so a typo can
 *   never send a password to the wrong server;
 * - prefilled with the chosen instance (ready at once, its version refreshed in the
 *   background), else the last account's, else the build's default instance
 *   (app.strafe.chat) - both of those looked up straight away.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  InstanceResolveError,
  chooseInstance,
  currentInstance,
  defaultInstanceAddress,
  suggestedInstance,
  type Instance,
} from '@/platform/session';
import { hostOf, instanceInputFor, type InstanceStatus } from './logic/instanceStatus';

export const INSTANCE_DEBOUNCE_MS = 700;

export interface InstancePicker {
  value: string;
  status: InstanceStatus;
  ready: boolean;
  setValue: (next: string) => void;
  /** Look up what is in the field now; resolves true when an instance answered. */
  resolveNow: () => Promise<boolean>;
  onBlur: () => void;
}

function initialFrom(inst: Instance | null): { value: string; input: string } | null {
  return inst ? { value: inst.domain, input: instanceInputFor(inst) } : null;
}

export function useInstancePicker(): InstancePicker {
  const startRef = useRef<{ current: Instance | null; suggested: Instance | null } | null>(null);
  if (!startRef.current) startRef.current = { current: currentInstance(), suggested: suggestedInstance() };
  const start = startRef.current;
  const fallback = defaultInstanceAddress();
  const prefill = initialFrom(start.current) ?? initialFrom(start.suggested) ?? (fallback ? { value: fallback, input: fallback } : null);

  const [value, setValueState] = useState(prefill?.value ?? '');
  const [status, setStatusState] = useState<InstanceStatus>(
    start.current ? { kind: 'ok', domain: start.current.domain } : { kind: 'idle' },
  );
  const valueRef = useRef(value);
  // Kept in step synchronously: a caller awaiting resolveNow() acts before the re-render.
  const statusRef = useRef(status);
  const setStatus = useCallback((next: InstanceStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);
  /** What chooseInstance() gets for the prefilled value (an API URL for a dev instance). */
  const prefillInput = useRef(prefill?.input ?? null);

  const lookup = useCallback(async (raw: string, quiet: boolean): Promise<boolean> => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    inflight.current?.abort();
    const shown = raw.trim();
    if (!shown) {
      setStatus({ kind: 'idle' });
      return false;
    }
    const input = shown === valueRef.current.trim() && prefillInput.current && shown === prefill?.value ? prefillInput.current : shown;
    const mine = new AbortController();
    inflight.current = mine;
    if (!quiet) setStatus({ kind: 'resolving', host: hostOf(shown) });
    try {
      const inst = await chooseInstance(input, mine.signal);
      if (mine.signal.aborted) return false;
      setStatus({ kind: 'ok', domain: inst.domain, ...(inst.version ? { version: inst.version } : {}) });
      return true;
    } catch (e) {
      if (mine.signal.aborted) return false;
      setStatus({
        kind: 'error',
        code: e instanceof InstanceResolveError ? e.code : 'unreachable',
        host: hostOf(shown),
      });
      return false;
    } finally {
      if (inflight.current === mine) inflight.current = null;
    }
    // prefill is fixed for the component's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setStatus]);

  // On arrival: refresh the chosen instance quietly (for its version), or look up the
  // last account's instance when none is chosen.
  useEffect(() => {
    if (start.current) void lookup(prefill!.value, true);
    else if (prefill) void lookup(prefill.value, false);
    return () => {
      inflight.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    };
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setValue = useCallback(
    (next: string) => {
      valueRef.current = next;
      setValueState(next);
      inflight.current?.abort();
      setStatus({ kind: 'idle' });
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      if (!next.trim()) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        void lookup(next, false);
      }, INSTANCE_DEBOUNCE_MS);
    },
    [lookup, setStatus],
  );

  const resolveNow = useCallback(() => {
    // Already answered (a quiet version refresh may still be running): nothing to wait for.
    if (statusRef.current.kind === 'ok' && !timer.current) return Promise.resolve(true);
    return lookup(valueRef.current, false);
  }, [lookup]);

  const onBlur = useCallback(() => {
    if (statusRef.current.kind === 'idle' && valueRef.current.trim()) void lookup(valueRef.current, false);
  }, [lookup]);

  return { value, status, ready: status.kind === 'ok', setValue, resolveNow, onBlur };
}

/**
 * The chosen instance, re-read whenever the screen comes back into focus: the instance screen
 * above it may have changed it, and the stored choice is not reactive.
 */
export function useChosenInstance(): Instance | null {
  const [inst, setInst] = useState<Instance | null>(() => currentInstance());
  useFocusEffect(
    useCallback(() => {
      const now = currentInstance();
      setInst((prev) => (prev?.apiUrl === now?.apiUrl && prev?.domain === now?.domain ? prev : now));
    }, []),
  );
  return inst;
}
