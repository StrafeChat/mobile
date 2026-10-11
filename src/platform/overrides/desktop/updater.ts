/**
 * Mobile replacement for web/src/desktop/updater.ts.
 *
 * The desktop app updates itself from signed GitHub releases through Tauri's updater. The
 * mobile app is updated by the App Store / Play Store (or the person's own sideloading), never
 * by downloading code at run time, so the update state stays idle and every action is inert.
 * Same exports, so anything that reads the state (a settings page) renders "nothing to do".
 */
import { createStore } from 'solid-js/store';

export type DesktopUpdateStatus = 'idle' | 'checking' | 'upToDate' | 'available' | 'downloading' | 'ready' | 'installing' | 'error';

export interface DesktopUpdateState {
  status: DesktopUpdateStatus;
  version: string;
  notes: string;
  /** 0-100 while downloading. */
  progress: number;
  error: string;
  lastCheckedAt: number;
  /** The banner was waved away; the settings page still offers the restart. */
  dismissed: boolean;
}

export const [desktopUpdate, setDesktopUpdate] = createStore<DesktopUpdateState>({
  status: 'idle',
  version: '',
  notes: '',
  progress: 0,
  error: '',
  lastCheckedAt: 0,
  dismissed: false,
});

export function checkForDesktopUpdate(): Promise<void> {
  return Promise.resolve();
}

export function installDesktopUpdate(): Promise<void> {
  return Promise.resolve();
}

export function dismissDesktopUpdate(): void {
  setDesktopUpdate('dismissed', true);
}

export function scheduleDesktopUpdateChecks(): void {
  /* updates come through the app stores */
}
