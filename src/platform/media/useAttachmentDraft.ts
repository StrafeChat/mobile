/**
 * The composer's attachment queue for a React component: the draft (the attachments/draft
 * override, a Solid object) created once per mount, its queue and error read through the
 * bridge, and the queue discarded on unmount - where the web's Solid composer relies on
 * `onCleanup`.
 *
 * Call actions on `draft` directly (`draft.addFiles(picked.files)`, `draft.remove(id)`,
 * `draft.take()` when sending); render from `items` and `error`, which are snapshots.
 */
import { useEffect, useState } from 'react';
import type { PendingAttachment as WebPendingAttachment } from '@web-original/lib/attachments/draft';
import { useSolid } from '@/bridge/solid';
import { createAttachmentDraft, type AttachmentDraft, type PendingAttachment } from '../overrides/media/attachments/draft';

export function useAttachmentDraft(opts: { maxFiles?: number; maxBytes?: number } = {}): {
  draft: AttachmentDraft;
  items: readonly PendingAttachment[];
  error: string;
} {
  const [draft] = useState(() => createAttachmentDraft(opts));
  useEffect(() => () => draft.clear(), [draft]);
  const items = useSolid(() => draft.items(), [draft]);
  const error = useSolid(() => draft.error(), [draft]);
  return { draft, items, error };
}

/**
 * The queue as stores/messages' `sendMessage` is typed (DOM File). At runtime the app's
 * messages store reads only name/type/size off each file and passes it to the mobile
 * encryptor and uploader, which take exactly these LocalFiles - the type is the web's, the
 * object is right.
 */
export function asWebPendingAttachments(list: readonly PendingAttachment[]): WebPendingAttachment[] {
  return list as unknown as WebPendingAttachment[];
}
