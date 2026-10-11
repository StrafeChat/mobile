/**
 * Moving around from a conversation: the screens the room area pushes (pins, search, the
 * thread browser, a thread, a full profile, safety numbers, group details) and the way back
 * into the conversation they were opened from.
 *
 * Routes are typed (experiments.typedRoutes) and the generated table only knows the screens
 * that existed when it was last generated, so every path goes through `as never` here, in one
 * place - the same escape src/platform/wiring.ts and the nav area use.
 */
import { router } from 'expo-router';
import { createPM } from '@web/api/rooms';
import { addOrUpdateRoom } from '@web/stores/rooms';
import { jumpToMessage } from '@web/stores/messages';
import { t } from '@web/i18n/t';
import { currentRoomId, openRoom } from '@/shell/state';
import { toast } from '@/ui';

/** `/path?key=value&...`, leaving out empty values. */
export function routeWithParams(path: string, params: Record<string, string | null | undefined> = {}): string {
  const query = Object.entries(params)
    .filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].length > 0)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return query ? `${path}?${query}` : path;
}

function push(path: string, params?: Record<string, string | null | undefined>): void {
  router.push(routeWithParams(path, params) as never);
}

/** Leave a pushed screen: back when there is somewhere to go back to, else the shell. */
export function goBack(): void {
  if (router.canGoBack()) router.back();
  else router.replace('/' as never);
}

/** Return to the shell (the (main) stack's first screen) from any pushed screen. */
export function backToShell(): void {
  if (router.canDismiss()) router.dismissAll();
}

export function openPinsScreen(roomId: string, spaceId?: string | null): void {
  push(`/pins/${encodeURIComponent(roomId)}`, { spaceId });
}

export function openSearchScreen(roomId: string, spaceId?: string | null): void {
  push(`/search/${encodeURIComponent(roomId)}`, { spaceId });
}

/** The thread browser of a space text channel. */
export function openThreadsScreen(roomId: string, spaceId: string): void {
  push(`/threads/${encodeURIComponent(roomId)}`, { spaceId });
}

/** A thread, pushed over the conversation (Discord's thread screen). */
export function openThreadScreen(threadId: string, spaceId: string): void {
  push(`/thread/${encodeURIComponent(threadId)}`, { spaceId });
}

/** The full profile. `roomId` / `spaceId` say where the person was seen (roles, join date). */
export function openProfileScreen(userId: string, ctx: { roomId?: string | null; spaceId?: string | null } = {}): void {
  push(`/profile/${encodeURIComponent(userId)}`, { roomId: ctx.roomId, spaceId: ctx.spaceId });
}

/** Safety numbers (verify encryption) with someone. */
export function openSafetyScreen(userId: string, displayName: string): void {
  push(`/safety/${encodeURIComponent(userId)}`, { name: displayName });
}

/** A group PM's details: name, encryption, members, leave. */
export function openGroupScreen(roomId: string): void {
  push(`/group/${encodeURIComponent(roomId)}`);
}

/** Open (creating if needed) a 1:1 PM with someone and show it in the shell. */
export async function messageUser(userId: string): Promise<void> {
  try {
    const room = await createPM(userId);
    addOrUpdateRoom(room);
    openRoom(room.id, null);
    backToShell();
  } catch {
    toast.error(t('mobile.room.messageFailed'));
  }
}

/**
 * Take the reader to a message from a pushed screen (a pin, a search hit). When the message
 * is in the conversation the screen was opened from, going back is enough; anything else (a
 * hit in another channel of the space) is opened in the shell first. The jump itself is the
 * store's: it loads a window around the message when it is not loaded, and the list scrolls to
 * it once its row exists.
 */
export function goToMessage(target: { roomId: string; messageId: string; spaceId?: string | null; originRoomId?: string | null }): void {
  const { roomId, messageId, spaceId } = target;
  if (target.originRoomId && target.originRoomId === roomId && router.canGoBack()) {
    router.back();
  } else {
    if (currentRoomId() !== roomId) openRoom(roomId, spaceId ?? null);
    backToShell();
  }
  void jumpToMessage(roomId, messageId).catch((err: unknown) => console.warn('[room] jump failed', err));
}
