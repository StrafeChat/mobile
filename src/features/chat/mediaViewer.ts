/**
 * Opening the full-screen media viewer. The viewer is the web's stores/mediaViewer (open,
 * items, index - unchanged); on mobile it is drawn by the `/media` route, so opening it also
 * pushes that screen, and the screen closing clears the store.
 *
 * Code that opens the viewer through the web store directly (any shared code calling
 * openMediaViewer) is caught by <MediaViewerHost/>, which pushes the screen when the store
 * opens while it isn't showing.
 */
import { useEffect } from 'react';
import { router } from 'expo-router';
import { openMediaViewer, mediaViewer, type MediaViewerItem } from '@web/stores/mediaViewer';
import { useSolid } from '@/bridge/solid';

let screenMounted = false;
/** A push is on its way (the screen mounts a frame or two later). */
let pushedAt = 0;
const PUSH_GRACE_MS = 1500;

/** The /media screen reports itself, so the host does not push it twice. */
export function setMediaScreenMounted(mounted: boolean): void {
  screenMounted = mounted;
  pushedAt = 0;
}

function pushScreen(): void {
  if (screenMounted || Date.now() - pushedAt < PUSH_GRACE_MS) return;
  pushedAt = Date.now();
  try {
    router.push('/media' as never);
  } catch (err) {
    console.warn('[chat] could not open the media viewer', err);
  }
}

/** Open the viewer on `items[index]` (one message's images, a preview image, an image link). */
export function openMedia(items: MediaViewerItem[], index = 0, sourceLabel?: string): void {
  const usable = items.filter((i) => !!i.url);
  if (usable.length === 0) return;
  openMediaViewer(usable, index, sourceLabel);
  pushScreen();
}

/** Root-mounted: shows the viewer screen whenever the store opens (from any caller). */
export function MediaViewerHost(): null {
  const open = useSolid(() => mediaViewer.open);
  useEffect(() => {
    if (open) pushScreen();
  }, [open]);
  return null;
}
