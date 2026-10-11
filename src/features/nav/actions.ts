/**
 * What the nav's menus do: the web's handlers (SpaceBar, SpaceRoomsBar, RoomsBar), the same
 * API calls and store updates, with the phone's additions - a confirm before the few
 * destructive actions the web runs unasked (delete room, leave group), and a toast when
 * something fails where the web only logs.
 */
import * as Clipboard from 'expo-clipboard';
import { t } from '@web/i18n/t';
import { ackAllSpaceRooms, deleteSpaceRoom, leaveSpace } from '@web/api/spaces';
import { removeRoomParticipant } from '@web/api/rooms';
import { joinThread, leaveThread } from '@web/api/threads';
import { spaces, removeSpace, setSpaceRooms } from '@web/stores/spaces';
import { removeRoom, rooms } from '@web/stores/rooms';
import { ackRoomOptimistic } from '@web/stores/readState';
import { auth } from '@web/stores/auth';
import { confirmDialog } from '@web/stores/confirmDialog';
import { muteRoom, setRoomNotifyMode, unmuteRoom } from '@web/lib/roomNotify';
import { translateCaughtApiError } from '@web/lib/formatApiError';
import { isApiError } from '@web/api/ApiError';
import { ROOM_TYPE_TEXT } from '@/data';
import { closeView, currentRoomId, openRoom, setSelectedSpaceId, shell } from '@/shell/state';
import { haptics, toast } from '@/ui';
import { moveRoomStep, moveRoomToSection } from './reorder';

/**
 * What to tell the user about a failure: the server's own reason, translated, when it gave
 * one; otherwise the caller's message for what went wrong (a dropped connection or a crash
 * says nothing a person can act on).
 */
export function errorMessage(err: unknown, fallbackKey = 'errors.unknown'): string {
  if (isApiError(err)) return translateCaughtApiError(err, t)[0] ?? t(fallbackKey);
  return t(fallbackKey);
}

export async function copyText(text: string): Promise<void> {
  try {
    await Clipboard.setStringAsync(text);
    haptics.success();
    toast.success(t('common.copied'));
  } catch {
    toast.error(t('errors.unknown'));
  }
}

/** The open room is gone (deleted / left): show the list rather than a dead conversation. */
function leaveViewIf(predicate: (roomId: string, spaceId: string | undefined) => boolean): void {
  const v = shell.view();
  if (v.kind === 'room' && predicate(v.roomId, v.spaceId)) closeView();
}

/** Leave a space after the web's confirm. The owner never gets here (they transfer or delete). */
export async function leaveSpaceFlow(spaceId: string): Promise<boolean> {
  const sp = spaces.spaces.find((s) => s.id === spaceId);
  const ok = await confirmDialog({
    title: t('space.leave'),
    body: t('space.leaveConfirm', { name: sp?.name ?? t('space.thisSpace') }),
    confirmLabel: t('space.leave'),
    tone: 'danger',
    icon: 'fa-solid fa-right-from-bracket',
  });
  if (!ok) return false;
  try {
    const roomIds = new Set((spaces.spaceRoomsBySpaceId[spaceId] ?? []).map((r) => r.id));
    await leaveSpace(spaceId);
    leaveViewIf((roomId, sid) => sid === spaceId || roomIds.has(roomId));
    if (shell.selectedSpaceId() === spaceId) setSelectedSpaceId(null);
    removeSpace(spaceId);
    return true;
  } catch (err) {
    toast.error(errorMessage(err, 'mobile.nav.leaveFailed'));
    return false;
  }
}

/** POST /spaces/:id/ack-all (the rail's "Mark space as read"). */
export function markSpaceRead(spaceId: string): void {
  ackAllSpaceRooms(spaceId).catch((err) => toast.error(errorMessage(err)));
}

/** Ack each room up to the given message (a section's Mark as read). */
export function markRoomsRead(targets: readonly { roomId: string; messageId: string }[]): void {
  for (const tg of targets) ackRoomOptimistic(tg.roomId, tg.messageId);
}

export function markRoomRead(roomId: string, messageId: string | null): void {
  if (messageId) ackRoomOptimistic(roomId, messageId);
}

/** Mute for a while (null = until turned back on) or unmute. */
export function setRoomMuted(roomId: string, muted: boolean, durationMs: number | null = null): void {
  void (muted ? muteRoom(roomId, durationMs) : unmuteRoom(roomId)).catch((err) => toast.error(errorMessage(err)));
}

export function setNotifyMode(roomId: string, mode: number): void {
  void setRoomNotifyMode(roomId, mode).catch((err) => toast.error(errorMessage(err)));
}

/** Mute every room of a section (when any is unmuted), else unmute them all. */
export function setSectionMuted(childIds: readonly string[], mute: boolean): void {
  for (const id of childIds) setRoomMuted(id, mute, null);
}

/** Delete a text/voice room (confirmed - the web deletes on the click). */
export async function deleteRoomFlow(spaceId: string, roomId: string): Promise<void> {
  const room = spaces.spaceRoomsBySpaceId[spaceId]?.find((r) => r.id === roomId);
  if (!room) return;
  const ok = await confirmDialog({
    title: t('space.deleteRoom'),
    body: t('mobile.nav.deleteRoomConfirm', { name: room.name || t('space.unnamed') }),
    confirmLabel: t('space.deleteRoom'),
    tone: 'danger',
    icon: 'fa-solid fa-trash',
  });
  if (!ok) return;
  try {
    await deleteSpaceRoom(spaceId, roomId);
    const rest = (spaces.spaceRoomsBySpaceId[spaceId] ?? []).filter((r) => r.id !== roomId);
    setSpaceRooms(spaceId, rest);
    if (currentRoomId() === roomId) {
      // The web moves to the space's first room; a text room is the one that makes sense to land in.
      const fallback = rest.filter((r) => r.type === ROOM_TYPE_TEXT).sort((a, b) => a.position - b.position)[0];
      if (fallback) openRoom(fallback.id, spaceId);
      else closeView();
    }
  } catch (err) {
    toast.error(errorMessage(err, 'common.deleteFailed'));
  }
}

/** Delete a section after the web's confirm; its rooms move to the top level server-side. */
export async function deleteSectionFlow(spaceId: string, sectionId: string): Promise<void> {
  const section = spaces.spaceRoomsBySpaceId[spaceId]?.find((r) => r.id === sectionId);
  if (!section) return;
  const ok = await confirmDialog({
    title: t('space.deleteSection'),
    body: t('space.deleteSectionConfirm', { name: section.name || t('space.section') }),
    confirmLabel: t('space.deleteSection'),
    tone: 'danger',
    icon: 'fa-solid fa-trash',
  });
  if (!ok) return;
  try {
    await deleteSpaceRoom(spaceId, sectionId);
    setSpaceRooms(spaceId, (spaces.spaceRoomsBySpaceId[spaceId] ?? []).filter((r) => r.id !== sectionId));
  } catch (err) {
    toast.error(errorMessage(err, 'common.deleteFailed'));
  }
}

/** Leave a group PM (confirmed - the web leaves on the click). */
export async function leaveGroupFlow(roomId: string): Promise<void> {
  const uid = auth.user?.id;
  if (!uid) return;
  const room = rooms.rooms.find((r) => r.id === roomId);
  const ok = await confirmDialog({
    title: t('contextMenu.leaveGroup'),
    body: t('mobile.nav.leaveGroupConfirm', { name: room?.name || t('nav.conversations') }),
    confirmLabel: t('contextMenu.leaveGroup'),
    tone: 'danger',
    icon: 'fa-solid fa-right-from-bracket',
  });
  if (!ok) return;
  try {
    await removeRoomParticipant(roomId, uid);
    removeRoom(roomId);
    leaveViewIf((id) => id === roomId);
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

export function setThreadJoined(threadId: string, join: boolean): void {
  void (join ? joinThread(threadId) : leaveThread(threadId)).catch((err) => toast.error(errorMessage(err)));
}

export function moveStep(spaceId: string, roomId: string, dir: -1 | 1): void {
  moveRoomStep(spaceId, roomId, dir).catch((err) => toast.error(errorMessage(err, 'mobile.nav.reorderFailed')));
}

export function moveToSection(spaceId: string, roomId: string, sectionId: string | null): void {
  moveRoomToSection(spaceId, roomId, sectionId).catch((err) => toast.error(errorMessage(err, 'mobile.nav.reorderFailed')));
}
