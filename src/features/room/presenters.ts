/**
 * The room area's own sheets that other code opens: the create-thread form, a members list
 * for a pushed screen, and a one-field text prompt (the web's window.prompt, which a phone
 * does not have). Plain subscribable values, no React - the hosts in RoomHosts render them,
 * and any area can call the open functions. A room's notification settings are the settings
 * area's Notifications page; openRoomNotifySheet is the one way there from a conversation.
 */
import { openRoomSettings } from '@/features/settings';
import { createExternalStore } from '@/ui';

// ---- notification settings ------------------------------------------------------------------

/**
 * A room's notification settings (mode + mute): the room settings' Notifications page, which
 * serves PMs, groups, channels and threads alike. `spaceId` is accepted for callers that have
 * it; the page finds the room itself.
 */
export function openRoomNotifySheet(roomId: string, _spaceId?: string | null): void {
  openRoomSettings(roomId, 'notifications');
}

// ---- create a thread ---------------------------------------------------------------------------

export interface CreateThreadRequest {
  spaceId: string;
  /** The text channel the thread goes in. */
  roomId: string;
  /** Started from this message (its preview suggests the name; the thread takes its id). */
  starterMessageId?: string;
  /**
   * The same, the way the web's CreateThreadModal takes it (the chat's message actions): the
   * message's id and the one-line preview already built for it. Its id wins over
   * `starterMessageId`; an empty preview is rebuilt from the loaded message.
   */
  starter?: { id: string; preview: string } | null;
  /** Preselect "Private thread" (the browser's Private button; never for a started thread). */
  privateDefault?: boolean;
}

export const createThreadStore = createExternalStore<(CreateThreadRequest & { id: number }) | null>(null);

let createThreadSeq = 0;

/**
 * Discord's "Create Thread" form - from a message's actions (pass `starterMessageId`) or the
 * thread browser's New / Private buttons. Creating opens the new thread.
 */
export function openCreateThread(request: CreateThreadRequest): void {
  const next = { ...request, id: ++createThreadSeq };
  const starterMessageId = request.starter?.id || request.starterMessageId;
  if (starterMessageId) next.starterMessageId = starterMessageId;
  else delete next.starterMessageId;
  createThreadStore.set(next);
}

export function closeCreateThread(): void {
  createThreadStore.set(null);
}

// ---- a members list over a pushed screen -------------------------------------------------------

export interface MembersSheetTarget {
  roomId: string;
  spaceId: string | null;
}

export const membersSheetStore = createExternalStore<MembersSheetTarget | null>(null);

/** The members list as a sheet - for a pushed thread screen, which has no shell drawer. */
export function openMembersSheet(roomId: string, spaceId: string | null): void {
  membersSheetStore.set({ roomId, spaceId });
}

export function closeMembersSheet(): void {
  membersSheetStore.set(null);
}

// ---- one line of text ---------------------------------------------------------------------------

export interface TextPromptRequest {
  id: number;
  title: string;
  description?: string;
  label?: string;
  placeholder?: string;
  initial: string;
  maxLength?: number;
  confirmLabel: string;
  resolve: (value: string | null) => void;
}

export const textPromptStore = createExternalStore<TextPromptRequest | null>(null);

let promptSeq = 0;

/**
 * Ask for one line of text (a thread's new name). Resolves with what was entered, or null when
 * the sheet was dismissed. A newer prompt replaces an open one, which resolves null.
 */
export function promptText(opts: Omit<TextPromptRequest, 'id' | 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => {
    textPromptStore.get()?.resolve(null);
    textPromptStore.set({ ...opts, id: ++promptSeq, resolve });
  });
}

/** Answer (or with null, dismiss) the open prompt `id`. */
export function settleTextPrompt(id: number, value: string | null): void {
  const cur = textPromptStore.get();
  if (!cur || cur.id !== id) return;
  textPromptStore.set(null);
  cur.resolve(value);
}
