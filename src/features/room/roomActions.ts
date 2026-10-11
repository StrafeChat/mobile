/**
 * What a conversation's header and its info sheet do: calls, the members list, mark as read,
 * leaving a group, going to a thread's channel.
 */
import { router } from 'expo-router';
import { getRoom, removeRoomParticipant } from '@web/api/rooms';
import { addOrUpdateRoom, removeRoom } from '@web/stores/rooms';
import { ackRoomOptimistic } from '@web/stores/readState';
import { dismissNewHeader } from '@web/stores/newHeaderDismissed';
import { confirmDialog } from '@web/stores/confirmDialog';
import { isConnectedTo } from '@web/stores/voice';
import { auth } from '@web/stores/auth';
import { t } from '@web/i18n/t';
import { latestMessageIdForRoom } from '@/data';
import { closeView, currentRoomId, openRoom, setMembersOpen, shell } from '@/shell/state';
import { joinVoiceFromUi, openCallScreen } from '@/features/voice';
import { toast } from '@/ui';
import { backToShell } from './navigation';
import { openMembersSheet } from './presenters';
import { errorMessage } from './util';

/** Where a conversation is shown: the shell's content panel, or a pushed screen (a thread). */
export type RoomMode = 'shell' | 'screen';

/** Start or join the room's call; already in it - show the call. */
export function startOrJoinCall(roomId: string, video: boolean, spaceId: string | null = null): void {
  if (isConnectedTo(roomId)) {
    openCallScreen({ roomId, spaceId });
    return;
  }
  void joinVoiceFromUi(roomId, { video, spaceId });
}

/** The member list: the shell's drawer (or column), or a sheet over a pushed screen. */
export function toggleMembers(roomId: string, spaceId: string | null, mode: RoomMode): void {
  if (mode === 'screen') {
    openMembersSheet(roomId, spaceId);
    return;
  }
  setMembersOpen(!shell.membersOpen());
}

/** Ack the newest known message and hide the NEW header for this visit. */
export function markRoomRead(roomId: string): void {
  const latest = latestMessageIdForRoom(roomId);
  if (!latest) return;
  ackRoomOptimistic(roomId, latest);
  dismissNewHeader(roomId);
}

/** Leave a group PM, after a confirm (the web's list menu leaves without one). */
export async function leaveGroup(roomId: string, name: string): Promise<boolean> {
  const uid = auth.user?.id;
  if (!uid) return false;
  const ok = await confirmDialog({
    title: t('contextMenu.leaveGroup'),
    body: t('mobile.room.leaveGroupBody', { name }),
    confirmLabel: t('contextMenu.leaveGroup'),
    tone: 'danger',
    icon: 'fa-solid fa-right-from-bracket',
  });
  if (!ok) return false;
  try {
    await removeRoomParticipant(roomId, uid);
    if (currentRoomId() === roomId) closeView();
    removeRoom(roomId);
    backToShell();
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}

/** Remove someone from a group PM (creator only), after a confirm; refreshes the room. */
export async function removeFromGroup(roomId: string, userId: string, name: string): Promise<void> {
  const ok = await confirmDialog({
    title: t('room.members.removeNamed', { name }),
    body: t('mobile.room.removeMemberBody', { name }),
    confirmLabel: t('common.remove'),
    tone: 'danger',
    icon: 'fa-solid fa-user-minus',
  });
  if (!ok) return;
  try {
    await removeRoomParticipant(roomId, userId);
    addOrUpdateRoom(await getRoom(roomId));
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

/** A thread's channel: in the shell, or back to it from a pushed thread screen. */
export function openParentChannel(parentId: string, spaceId: string | null, mode: RoomMode): void {
  if (mode === 'screen' && router.canGoBack()) {
    router.back();
    if (currentRoomId() !== parentId) openRoom(parentId, spaceId);
    return;
  }
  openRoom(parentId, spaceId);
  backToShell();
}
