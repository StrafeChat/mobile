/**
 * "This room is gone for this account" (left, removed from a group PM, deleted): boot hears it
 * from the gateway and announces it here; features that keep per-room state (the composer's
 * draft and queued files) listen. A registry instead of an import keeps boot free of feature
 * modules and their native dependencies.
 */
type Listener = (roomId: string) => void;

const listeners = new Set<Listener>();

export function onRoomGone(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function announceRoomGone(roomId: string): void {
  for (const l of listeners) {
    try {
      l(roomId);
    } catch (err) {
      console.warn('[rooms] room-gone listener failed', err);
    }
  }
}
