/**
 * Where the message list sends people: another room, a thread, a space, an invite, a PM, a
 * link. The web does these with its router (`navigate('/spaces/:id/rooms/:id')`); here the
 * conversation lives in the swipe shell and the rest are stack routes, so each target has its
 * own way there.
 *
 * A list can be on screen inside a stack route (a thread, the media viewer's caller...), so
 * moving the shell also pops back to it.
 */
import { router } from 'expo-router';
import { Linking, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { t } from '@web/i18n/t';
import { createPM } from '@web/api/rooms';
import { translateCaughtApiError } from '@web/lib/formatApiError';
import { addOrUpdateRoom } from '@web/stores/rooms';
import { jumpToMessage, loadMessages, messages } from '@web/stores/messages';
import { isExternalLink, requestOpenExternalLink } from '@web/stores/externalLink';
import { parseRoomLinkPath, resolveRoomLink, roomLinkFromUrl, type RoomLink } from '@web/lib/roomLinks';
import { openNav, openRoom, setSelectedSpaceId } from '@/shell/state';
import { showActionSheet, toast } from '@/ui';

const ROOM_TYPE_THREAD = 6;

/** A caught API error in the reader's language (the web's translation), or the generic line. */
export function errorText(err: unknown): string {
  return translateCaughtApiError(err, t).join(' ') || t('errors.unknown');
}

/** Back to the shell (the root of the main stack) when a route is on top of it. */
function backToShell(): void {
  try {
    if (router.canDismiss()) router.dismissAll();
  } catch {
    /* no navigator mounted (tests) */
  }
}

/** Open a room in the shell's conversation panel. `spaceId` null = a PM or group. */
export function navigateToRoom(roomId: string, spaceId: string | null): void {
  openRoom(roomId, spaceId);
  backToShell();
}

/**
 * A thread is a room of its own, shown as a stack screen (the room area's route). Pass its
 * space when known: the screen then needs no lookup (an archived thread is not in the live
 * channel lists, so without it the screen cannot tell which space's roles and members apply).
 */
export function openThread(threadId: string, spaceId?: string | null): void {
  const params: Record<string, string> = { threadId };
  if (spaceId) params.spaceId = spaceId;
  router.push({ pathname: '/thread/[threadId]', params } as never);
}

/** Show a space's room list (after joining it from an invite card, or "Go to space"). */
export function openSpace(spaceId: string): void {
  setSelectedSpaceId(spaceId);
  openNav();
  backToShell();
}

/** The full invite page (nav area's route) - the card's way out when its preview failed. */
export function openInvitePage(code: string): void {
  router.push({ pathname: '/invite/[code]', params: { code } } as never);
}

/** "Message" from a profile or an author menu: open (or create) the PM, then show it. */
export function messageUser(userId: string): void {
  createPM(userId)
    .then((room) => {
      addOrUpdateRoom(room);
      navigateToRoom(room.id, null);
    })
    .catch((err: unknown) => {
      console.warn('[chat] could not open PM', err);
      toast.error(errorText(err));
    });
}

/**
 * Where an in-app link points, by path on this instance: a room or a message in it (the web's
 * `/spaces/:s/rooms/:r[/:m]`, `/rooms/:r[/:m]`, lib/roomLinks), or an invite. Null for anything
 * else (it opens in the browser).
 */
export type InternalTarget =
  | ({ kind: 'room' } & RoomLink)
  | { kind: 'invite'; code: string };

export function internalTarget(href: string): InternalTarget | null {
  let path: string;
  try {
    path = new URL(href).pathname;
  } catch {
    return null;
  }
  const room = parseRoomLinkPath(path);
  if (room) return { kind: 'room', ...room };
  const invite = /^\/invite\/([^/]+)\/?$/.exec(path);
  if (invite) {
    try {
      return { kind: 'invite', code: decodeURIComponent(invite[1]!) };
    } catch {
      return { kind: 'invite', code: invite[1]! };
    }
  }
  return null;
}

/**
 * Open a room link in the app, as the web does (lib/openRoomLink): the room in the shell, a
 * thread on its own screen, then the message through the store's jump (scrolled to when
 * loaded, a window loaded around it when not). A room that does not exist or that this account
 * may not see says so in a toast. Resolves true when the room opened.
 */
export async function openRoomLink(link: RoomLink): Promise<boolean> {
  const target = await resolveRoomLink(link);
  if (!target) {
    toast.error(t('messages.roomLink.unavailableBody'));
    return false;
  }
  const { roomId, spaceId, messageId } = target;
  if (target.type === ROOM_TYPE_THREAD && spaceId) {
    backToShell();
    openThread(roomId, spaceId);
  } else {
    navigateToRoom(roomId, spaceId);
  }
  if (!messageId) return true;
  try {
    await jumpToMessage(roomId, messageId);
  } catch {
    // The window around it could not be loaded; show the room as it would open anyway.
    if (messages.byRoom[roomId] === undefined) loadMessages(roomId).catch(() => undefined);
    toast.error(t('messages.roomLink.messageMissingBody'));
    return true;
  }
  if (!messages.byRoom[roomId]?.some((m) => m.id === messageId)) toast(t('messages.roomLink.messageMissingTitle'));
  return true;
}

/**
 * Follow a link from a message. A link to a room or message here - or on another instance, for
 * a room mirrored here - opens in the app; other external links go through the web's guard (a
 * trusted domain opens straight away, anything else asks first - the room area renders that
 * confirmation); invites open the invite screen; anything else on this instance, the browser.
 */
export function openMessageLink(href: string): void {
  const room = roomLinkFromUrl(href);
  if (room) {
    void openRoomLink(room);
    return;
  }
  if (isExternalLink(href)) {
    requestOpenExternalLink(href);
    return;
  }
  const target = internalTarget(href);
  if (target?.kind === 'room') {
    void openRoomLink(target);
    return;
  }
  if (target?.kind === 'invite') {
    openInvitePage(target.code);
    return;
  }
  void Linking.openURL(href).catch(() => undefined);
}

/** Long-press on a link: open, copy, share. */
export function showLinkActions(href: string): void {
  void showActionSheet(
    [
      { key: 'open', label: t('mobile.chat.link.open'), icon: 'arrow-up-right-from-square', onSelect: () => openMessageLink(href) },
      {
        key: 'copy',
        label: t('mobile.chat.link.copy'),
        icon: 'link',
        onSelect: async () => {
          await Clipboard.setStringAsync(href);
          toast(t('common.copied'));
        },
      },
      { key: 'share', label: t('mobile.media.share'), icon: 'share-nodes', onSelect: () => Share.share({ message: href, url: href }) },
    ],
    { title: href },
  );
}
