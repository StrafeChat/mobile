/**
 * The Unicode emoji catalogue (emojibase, ~700 KB of JSON) for `:shortcode:` completion,
 * serialization and the picker. The web loads it when the composer mounts so the first ":smi"
 * already completes; here it loads once the screen is idle (after the room's opening frames),
 * then stays in memory for the session like the web's module-level cache.
 */
import { useEffect, useState } from 'react';
import { emojiCatalogIfLoaded, loadEmojiCatalog, type EmojiCatalog } from '@web/lib/emoji/data';

export function useEmojiCatalog(enabled = true): EmojiCatalog | null {
  const [catalog, setCatalog] = useState<EmojiCatalog | null>(() => emojiCatalogIfLoaded());
  useEffect(() => {
    if (catalog || !enabled) return undefined;
    let alive = true;
    const load = () => {
      loadEmojiCatalog()
        .then((c) => {
          if (alive) setCatalog(c);
        })
        .catch(() => undefined);
    };
    // Parse the JSON once the screen is idle, not in the middle of the room's opening frames.
    const idle = typeof requestIdleCallback === 'function' ? requestIdleCallback(load, { timeout: 1500 }) : null;
    const timer = idle === null ? setTimeout(load, 300) : null;
    return () => {
      alive = false;
      if (idle !== null) cancelIdleCallback(idle);
      if (timer !== null) clearTimeout(timer);
    };
  }, [catalog, enabled]);
  return catalog;
}
