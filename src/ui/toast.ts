/**
 * toast(): brief, non-blocking feedback ("Copied", "Couldn't send - tap to retry").
 *
 * Callable from anywhere - components, store actions, API error paths, web overrides - with
 * no React in this module; `<ToastHost/>` (inside `<UiHosts/>`) renders whatever is current.
 *
 * Snackbar semantics: one toast at a time, a newer one replaces the one on screen (the newest
 * news is the relevant one), and a toast with the same `id` updates in place instead of
 * flashing out and in. Screen readers hear every toast as it appears.
 */
import { createExternalStore } from './externalStore';

export type ToastTone = 'default' | 'success' | 'error' | 'warning' | 'info';

export interface ToastAction {
  label: string;
  onPress: () => void;
}

export interface ToastOptions {
  message: string;
  tone?: ToastTone;
  /** Font Awesome class or name; defaults per tone. */
  icon?: string;
  /** Milliseconds on screen. Default 3 s, 5 s with an action; 0 keeps it until dismissed. */
  duration?: number;
  action?: ToastAction;
  /** Same id = update the toast on screen rather than show a new one. */
  id?: string;
}

export interface ActiveToast extends Required<Pick<ToastOptions, 'message' | 'tone' | 'duration'>> {
  id: string;
  icon?: string;
  action?: ToastAction;
  /** Bumps on every show/update so the host restarts its timer. */
  version: number;
}

export const toastStore = createExternalStore<ActiveToast | null>(null);

let seq = 0;

function show(input: string | ToastOptions, defaults?: Partial<ToastOptions>): string {
  const opts: ToastOptions = typeof input === 'string' ? { ...defaults, message: input } : { ...defaults, ...input };
  const id = opts.id ?? `toast-${++seq}`;
  const tone = opts.tone ?? 'default';
  toastStore.set({
    id,
    message: opts.message,
    tone,
    icon: opts.icon,
    action: opts.action,
    duration: opts.duration ?? (opts.action ? 5000 : 3000),
    version: ++seq,
  });
  return id;
}

/**
 * Show a toast. Returns its id (for `dismissToast` or an in-place update).
 *
 *   toast(t('common.copied'))
 *   toast.error(t('chat.sendFailed'), { action: { label: t('common.retry'), onPress: retry } })
 */
export const toast = Object.assign((input: string | ToastOptions) => show(input), {
  success: (message: string, opts?: Omit<ToastOptions, 'message' | 'tone'>) => show({ ...opts, message, tone: 'success' }),
  error: (message: string, opts?: Omit<ToastOptions, 'message' | 'tone'>) => show({ ...opts, message, tone: 'error' }),
  warning: (message: string, opts?: Omit<ToastOptions, 'message' | 'tone'>) => show({ ...opts, message, tone: 'warning' }),
  info: (message: string, opts?: Omit<ToastOptions, 'message' | 'tone'>) => show({ ...opts, message, tone: 'info' }),
});

/** Dismiss the toast on screen (only if it is `id`, when given). */
export function dismissToast(id?: string): void {
  toastStore.set((cur) => (cur && (!id || cur.id === id) ? null : cur));
}
