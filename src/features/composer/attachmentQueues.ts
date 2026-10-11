/**
 * The files waiting to go with each room's next message - one attachment queue (the media
 * layer's createAttachmentDraft, the web's API) per room, kept for the session like the text
 * draft in state.ts, so picking a photo, glancing at another conversation and coming back
 * does not lose it. (The web keeps one queue per composer and drops it on a room switch.)
 *
 * Queued files are the app's own cache copies; a queue that is discarded deletes them, and the
 * media layer's start-up sweep removes anything left behind by a crash.
 */
import { createAttachmentDraft, type AttachmentDraft } from '@/platform/media';

const queues = new Map<string, AttachmentDraft>();

export function attachmentQueueFor(roomId: string): AttachmentDraft {
  let q = queues.get(roomId);
  if (!q) {
    q = createAttachmentDraft();
    queues.set(roomId, q);
  }
  return q;
}

/** Throw a room's queued files away (the room went away, or the composer was reset). */
export function discardAttachmentQueue(roomId: string): void {
  const q = queues.get(roomId);
  if (!q) return;
  q.clear();
  queues.delete(roomId);
}
