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
import { isExternalLink, requestOpenExternalLink } from '@web/stores/externalLink';
import { openNav, openRoom, setSelectedSpaceId } from '@/shell/state';
import { showActionSheet, toast } from '@/ui';

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
 * Where an in-app link points, by path on this instance: a room, a space room, or an invite.
 * Null for anything else (it opens in the browser).
 */
export type InternalTarget =
  | { kind: 'room'; roomId: string; spaceId: string | null }
  | { kind: 'invite'; code: string };

export function internalTarget(href: string): InternalTarget | null {
  let path: string;
  try {
    path = new URL(href).pathname;
  } catch {
    return null;
  }
  const room = /^\/rooms\/(\d+)\/?$/.exec(path);
  if (room) return { kind: 'room', roomId: room[1]!, spaceId: null };
  const spaceRoom = /^\/spaces\/(\d+)\/rooms\/(\d+)\/?$/.exec(path);
  if (spaceRoom) return { kind: 'room', roomId: spaceRoom[2]!, spaceId: spaceRoom[1]! };
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
 * Follow a link from a message. External links go through the web's guard (a trusted domain
 * opens straight away, anything else asks first - the room area renders that confirmation);
 * links to this instance open in the app where we can, else in the browser.
 */
export function openMessageLink(href: string): void {
  if (isExternalLink(href)) {
    requestOpenExternalLink(href);
    return;
  }
  const target = internalTarget(href);
  if (target?.kind === 'room') {
    navigateToRoom(target.roomId, target.spaceId);
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
