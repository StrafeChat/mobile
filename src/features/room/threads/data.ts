/**
 * Threads as the room area reads them from stores/spaces: a channel's active threads in the
 * browser's order, and one thread's record - from the store, or fetched once when the live
 * list does not hold it (archived, a deep link).
 */
import type { SpaceRoom } from '@web/api/spaces';
import { getThread } from '@web/api/threads';
import { spaces, spaceRoomFromPayload } from '@web/stores/spaces';
import { snapshot } from '@/bridge/solid';
import { ROOM_TYPE_THREAD, deepEqual, sameArray, useDerived } from '@/data';

/** The browser's order: joined threads first, then by last activity, newest first. */
export function sortThreads<T extends Pick<SpaceRoom, 'created_at' | 'thread'>>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const ja = a.thread?.joined ? 1 : 0;
    const jb = b.thread?.joined ? 1 : 0;
    if (ja !== jb) return jb - ja;
    return (b.thread?.last_active_at ?? b.created_at).localeCompare(a.thread?.last_active_at ?? a.created_at);
  });
}

/** A channel's active (not archived) threads, from the store. */
export function channelThreadIds(spaceId: string, roomId: string): string[] {
  const list = (spaces.spaceRoomsBySpaceId[spaceId] ?? []).filter(
    (r) => r.type === ROOM_TYPE_THREAD && r.parent_id === roomId && !r.thread?.archived,
  );
  return sortThreads(list).map((r) => r.id);
}

export function useChannelThreadIds(spaceId: string, roomId: string): string[] {
  return useDerived(`room:channelThreads:${spaceId}:${roomId}`, () => channelThreadIds(spaceId, roomId), sameArray);
}

/** One thread's record from the store (plain copy), or undefined. */
export function useStoredThread(spaceId: string | null | undefined, threadId: string): SpaceRoom | undefined {
  return useDerived(
    `room:thread:${spaceId ?? ''}:${threadId}`,
    () => {
      if (!spaceId) return undefined;
      const r = spaces.spaceRoomsBySpaceId[spaceId]?.find((x) => x.id === threadId);
      return r ? snapshot(r) : undefined;
    },
    deepEqual,
  );
}

export interface FetchedThread {
  room: SpaceRoom;
  /** The server's record, for upsertSpaceRoomFromPayload. */
  raw: Record<string, unknown>;
}

const fetchedThreads = new Map<string, Promise<FetchedThread | null>>();

/** GET /rooms/:id/thread once per thread (an archived or otherwise unlisted one). */
export function fetchThreadOnce(threadId: string): Promise<FetchedThread | null> {
  let p = fetchedThreads.get(threadId);
  if (!p) {
    p = getThread(threadId)
      .then((raw) => {
        const room = spaceRoomFromPayload(raw);
        return room ? { room, raw } : null;
      })
      .catch(() => {
        fetchedThreads.delete(threadId);
        return null;
      });
    fetchedThreads.set(threadId, p);
  }
  return p;
}

