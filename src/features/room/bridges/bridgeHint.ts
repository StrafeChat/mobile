/**
 * The composer hint of a bridged room (spec 5.9, the web's RoomBridgeHint): shown over the
 * composer until the person has posted there once, or closed it. A room is never bridged
 * silently. Remembered per room *and* set of running bridges, so a new bridge in the same room
 * shows it again - the web's rule and its storage key (the app's localStorage is the shim's,
 * per account).
 */
import { createSignal } from 'solid-js';
import { activeRoomBridges } from '@web/stores/bridges';

const STORAGE_KEY = 'strafe_bridge_hints_seen';
const MAX_KEPT = 200;

function loadSeen(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const v = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const [seen, setSeen] = createSignal<string[]>(loadSeen());

/** The key of a room's hint: the room and its running bridges, or null when none runs. */
export function bridgeHintKey(spaceId: string | null | undefined, roomId: string | null | undefined): string | null {
  if (!roomId) return null;
  const ids = activeRoomBridges(spaceId ?? undefined, roomId)
    .map((b) => b.id)
    .sort();
  return ids.length ? `${roomId}:${ids.join(',')}` : null;
}

function remember(key: string): void {
  if (seen().includes(key)) return;
  const next = [...seen().filter((k) => k !== key), key].slice(-MAX_KEPT);
  setSeen(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* not persisted: the hint shows again next time */
  }
}

/** Whether the hint shows in this room now (reactive). */
export function bridgeHintVisible(spaceId: string | null | undefined, roomId: string | null | undefined): boolean {
  const key = bridgeHintKey(spaceId, roomId);
  return !!key && !seen().includes(key);
}

/** The person posted here, or closed the hint: it has done its job. */
export function markBridgeHintSeen(spaceId: string | null | undefined, roomId: string | null | undefined): void {
  const key = bridgeHintKey(spaceId, roomId);
  if (key) remember(key);
}

/** Tests: forget what was seen. */
export function resetBridgeHintsForTests(): void {
  setSeen([]);
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing stored */
  }
}
