/**
 * The jump flash (the web's `.msg-jump-flash`): after a jump lands exactly on its message,
 * that row tints primary, holds, then fades - 1.2 s + 2 s. A restartable store keyed by
 * message id, so only the one row re-renders.
 */
import { useSyncExternalStore } from 'react';

export const FLASH_HOLD_MS = 1200;
export const FLASH_FADE_MS = 2000;

let current: { id: string; nonce: number } | null = null;
let nonce = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of [...listeners]) l();
}

export function flashMessage(id: string): void {
  current = { id, nonce: ++nonce };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    current = null;
    timer = null;
    emit();
  }, FLASH_HOLD_MS + FLASH_FADE_MS + 100);
  emit();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** A changing number while `id` is flashing (each new flash a new value), 0 otherwise. */
export function useFlashNonce(id: string): number {
  return useSyncExternalStore(subscribe, () => (current?.id === id ? current.nonce : 0));
}
