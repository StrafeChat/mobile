/**
 * Sheets the message list owns (the reaction picker, delete confirmation, create-thread) are
 * driven by small module stores and drawn by a host inside the list. More than one list can be
 * mounted at once - the conversation in the shell and a thread screen on top of it - so only
 * the most recently mounted list draws them; the one beneath takes over again when the top
 * one goes away.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';

const stacks = new Map<string, number[]>();
const listeners = new Set<() => void>();
let seq = 0;

function notify(): void {
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Whether this mounted instance is the top-most holder of `name`. */
export function useHostSlot(name: string): boolean {
  const [id] = useState(() => ++seq);
  useEffect(() => {
    const stack = stacks.get(name) ?? [];
    stack.push(id);
    stacks.set(name, stack);
    notify();
    return () => {
      const s = stacks.get(name) ?? [];
      const i = s.indexOf(id);
      if (i >= 0) s.splice(i, 1);
      notify();
    };
  }, [name, id]);
  return useSyncExternalStore(subscribe, () => {
    const s = stacks.get(name);
    return !!s && s[s.length - 1] === id;
  });
}
