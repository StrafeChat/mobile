/**
 * Per-device preferences the conversation UI reads: client settings, notification
 * preferences, emoji/GIF choices, and the link-preview cache.
 *
 * Setters are the web stores' own (setMessageCompact, setNotificationPrefs, setEmojiSkinTone...)
 * and persist themselves. Theme, density and font scale come from useTheme (src/theme).
 */
import { useEffect } from 'react';
import { settings, type SettingsData } from '@web/stores/settings';
import { notificationPrefs, type NotificationPrefs } from '@web/stores/notificationPrefs';
import { appearance } from '@web/stores/appearance';
import { linkPreviews, ensureLinkPreview, type LinkPreviewEntry } from '@web/stores/linkPreviews';
import { snapshot } from '@/bridge/solid';
import { deepEqual, useDerived } from './derived';
import { findPmRoom, findSpaceRoom } from './rooms';

/** Compact mode, link previews in E2EE rooms, spellcheck... Re-renders on any change. */
export function useSettings(): SettingsData {
  return useDerived('settings', () => ({ ...settings }), deepEqual);
}

export function useNotificationPrefs(): NotificationPrefs {
  return useDerived('notificationPrefs', () => ({ ...notificationPrefs }), deepEqual);
}

export interface EmojiPrefs {
  /** 'native' renders the system font's emoji; otherwise the instance's image set. */
  provider: (typeof appearance)['emojiProvider'];
  skinTone: number;
  gifProvider: (typeof appearance)['gifProvider'];
}

export function useEmojiPrefs(): EmojiPrefs {
  return useDerived(
    'emojiPrefs',
    () => ({ provider: appearance.emojiProvider, skinTone: appearance.emojiSkinTone, gifProvider: appearance.gifProvider }),
    deepEqual,
  );
}

/**
 * Whether link previews may be fetched in a room (MessageList's rule): always in plain rooms;
 * in end-to-end encrypted ones only when the user opted in, since unfurling sends the link to
 * the server, which otherwise never sees it there.
 *
 * Errs towards privacy where the web leans on a flag being present: a 1:1 PM counts as
 * encrypted whatever its e2ee_enabled says (as its header's lock badge does), a group unless
 * E2EE was turned off, and a room this client does not know yet is never unfurled (as the
 * store's own warm-up does).
 */
export function linkPreviewsAllowed(roomId: string): boolean {
  const pm = findPmRoom(roomId);
  if (pm) return !(pm.type === 1 || pm.e2ee_enabled !== false) || settings.linkPreviewsInEncrypted;
  const channel = findSpaceRoom(roomId)?.room;
  if (!channel) return false;
  return channel.e2ee_enabled !== true || settings.linkPreviewsInEncrypted;
}

export function useLinkPreviewsAllowed(roomId: string): boolean {
  return useDerived(`linkPreviewsAllowed:${roomId}`, () => linkPreviewsAllowed(roomId));
}

/**
 * A URL's preview card state, fetched on first use (once per URL, deduped, cached 24 h).
 * Pass `enabled` = useLinkPreviewsAllowed(roomId) - never unfurl a link from an encrypted room
 * the user did not opt in for.
 */
export function useLinkPreview(url: string | null | undefined, enabled: boolean): LinkPreviewEntry | undefined {
  useEffect(() => {
    if (url && enabled) void ensureLinkPreview(url);
  }, [url, enabled]);
  return useDerived(
    `linkPreview:${url ?? ''}`,
    () => {
      const e = url ? linkPreviews.byUrl[url] : undefined;
      return e ? snapshot(e) : undefined;
    },
    deepEqual,
  );
}
