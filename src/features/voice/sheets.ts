/**
 * The voice area's overlays that anything can open - a tile, a dock avatar, a sidebar voice
 * row - and that VoiceHosts draws once at the root: the per-user voice sheet (the web's
 * VoiceUserMenu), voice statistics (VoiceStatsPopover) and the screen-share quality picker
 * (ScreenShareDialog). Plain external stores: not shared web state, and no React needed to
 * open them.
 */
import { createExternalStore } from '@/ui';

export interface VoiceUserTarget {
  userId: string;
  roomId: string;
  /** Space voice rooms only; PMs have no moderation. */
  spaceId?: string | null;
}

export const voiceUserSheetStore = createExternalStore<VoiceUserTarget | null>(null);
export const voiceStatsStore = createExternalStore(false);
export const screenShareSheetStore = createExternalStore(false);

/** The per-user sheet: volume, mute for me, profile, and moderation where permitted. */
export function openVoiceUserSheet(target: VoiceUserTarget): void {
  voiceUserSheetStore.set({ ...target });
}

export function closeVoiceUserSheet(): void {
  voiceUserSheetStore.set(null);
}

/** Voice statistics; a second call while open closes it, like the web's toggle. */
export function toggleVoiceStats(): void {
  voiceStatsStore.set((open) => !open);
}

export function closeVoiceStats(): void {
  voiceStatsStore.set(false);
}

export function openScreenShareSheet(): void {
  screenShareSheetStore.set(true);
}

export function closeScreenShareSheet(): void {
  screenShareSheetStore.set(false);
}
