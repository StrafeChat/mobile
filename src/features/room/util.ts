/**
 * Small helpers shared by the room area's screens and sheets.
 */
import * as Clipboard from 'expo-clipboard';
import { isApiError } from '@web/api/ApiError';
import { translateCaughtApiError } from '@web/lib/formatApiError';
import { t } from '@web/i18n/t';
import type { RoomKind } from '@/data';
import { haptics, toast } from '@/ui';

/**
 * What to tell the user about a failure: the server's own reason, translated, when it gave
 * one; otherwise `fallbackKey` (a dropped connection or a crash says nothing a person can act
 * on).
 */
export function errorMessage(err: unknown, fallbackKey = 'errors.unknown'): string {
  if (isApiError(err)) {
    const lines = translateCaughtApiError(err, t);
    if (lines.length) return lines.join(' ');
  }
  return t(fallbackKey);
}

/** Copy to the clipboard with the usual confirmation. */
export async function copyText(text: string, confirmation = t('common.copied')): Promise<void> {
  try {
    await Clipboard.setStringAsync(text);
    haptics.success();
    toast.success(confirmation);
  } catch {
    toast.error(t('errors.unknown'));
  }
}

/** The glyph a room is drawn with, by kind (the web header's headerIcon, plus voice). */
export function roomKindIcon(kind: RoomKind | undefined, opts: { privateThread?: boolean } = {}): string {
  switch (kind) {
    case 'notes':
      return 'note-sticky';
    case 'group':
      return 'user-group';
    case 'pm':
      return 'message';
    case 'voice':
      return 'volume-high';
    case 'thread':
      return opts.privateThread ? 'lock' : 'comments';
    case 'section':
      return 'folder';
    default:
      return 'hashtag';
  }
}

/** The PM / group / notes kinds - rooms that live in stores/rooms rather than a space. */
export function isPrivateKind(kind: RoomKind | undefined): boolean {
  return kind === 'pm' || kind === 'group' || kind === 'notes';
}
