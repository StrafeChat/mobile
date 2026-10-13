/**
 * Message row geometry and media sizing.
 *
 * The web caps inline media at 400 x 300 (images), 400 x 320 (link media) and its video
 * player box; on a phone the cap is also the room left of the avatar gutter, so a picture
 * never overflows the row. On a tablet the web's caps apply as they are.
 */
import { useWindowDimensions } from 'react-native';
import { fitWithin } from '@web-original/lib/attachments/format';
import { useSolid } from '@/bridge/solid';
import { shell } from '@/shell/state';
import { useHorizontalSafePadding, WIDE_BREAKPOINT } from '@/ui';

/** Horizontal padding of a message row. */
export const ROW_PAD_X = 16;
/** The avatar column (cozy mode) and the gap after it. */
export const AVATAR_PX = 40;
export const AVATAR_GAP = 12;
/** The rails column on a wide screen (SwipeShell's wide layout). */
const WIDE_NAV_PX = 340;
const WIDE_MEMBERS_PX = 280;

export const IMAGE_MAX = { width: 400, height: 300 };
export const LINK_MEDIA_MAX = { width: 400, height: 320 };
const VIDEO_MAX_W = 400;
const VIDEO_MAX_H = 300;
const VIDEO_MAX_H_PORTRAIT = 420;
const VIDEO_MIN_W = 232;

/**
 * Width available to a message's content column. `sideInsets` is the landscape safe-area
 * padding every screen now carries; it narrows the column but not the decision to lay the
 * rails beside it, which SwipeShell makes from the window's width.
 */
export function contentWidth(windowWidth: number, compact: boolean, membersColumn: boolean, sideInsets = 0): number {
  let w = windowWidth - sideInsets;
  if (windowWidth >= WIDE_BREAKPOINT) {
    w -= WIDE_NAV_PX;
    if (membersColumn) w -= WIDE_MEMBERS_PX;
  }
  w -= ROW_PAD_X * 2;
  if (!compact) w -= AVATAR_PX + AVATAR_GAP;
  return Math.max(160, w);
}

/** Media cap for this screen: the web's `max` within the content column. */
export function useMediaMaxWidth(max = 400, compact = false): number {
  const { width } = useWindowDimensions();
  const { paddingLeft, paddingRight } = useHorizontalSafePadding();
  const members = useSolid(() => shell.membersOpen() && shell.membersAvailable());
  return Math.min(max, contentWidth(width, compact, members, paddingLeft + paddingRight));
}

/** Fit (w, h) in a box, never upscaling; the web's fitWithin with a width cap applied. */
export function fitBox(w: number | undefined, h: number | undefined, maxW: number, maxH: number): { width: number; height: number } | null {
  if (!w || !h || w <= 0 || h <= 0) return null;
  return fitWithin(w, h, maxW, maxH);
}

/** The web's videoPlayerBox, narrowed to `maxWidth`. */
export function videoBox(width: number | undefined, height: number | undefined, maxWidth: number): { width: number; height: number } {
  const cap = Math.min(VIDEO_MAX_W, maxWidth);
  const w = width ?? 0;
  const h = height ?? 0;
  if (w <= 0 || h <= 0) return { width: cap, height: Math.round((cap * 9) / 16) };
  const fit = fitWithin(w, h, cap, h > w ? VIDEO_MAX_H_PORTRAIT : VIDEO_MAX_H);
  const minW = Math.min(VIDEO_MIN_W, cap);
  if (fit.width >= minW) return fit;
  // Too narrow for the controls: widen the frame and letterbox the clip inside it.
  return { width: minW, height: fit.height };
}
