/**
 * Mobile replacement for web/src/lib/attachments/draft.ts - the composer's queue of files to
 * send with the next message.
 *
 * Same API, limits and messages as the web (`createAttachmentDraft()` -> `{items, error,
 * setError, addFiles, remove, take, restore, clear}`, Solid accessors included), so the send
 * path in stores/messages and the composer logic carry over. The differences are the files:
 *
 * - `addFiles` takes picker results (expo-image-picker / expo-document-picker assets, voice
 *   recordings, any LocalFile) instead of DOM Files, and queues LocalFiles - `{uri, name,
 *   type, size}`, the three fields stores/messages reads plus the URI the uploader sends.
 * - `previewUrl` is the file's own `file://` URI; there are no object URLs to create or
 *   revoke. Dimensions come from the picker when it knew them, else from the image's header.
 * - Copies the app made itself (picker cache, recordings: `owned`) are deleted when they are
 *   removed or discarded unsent, the counterpart of the web revoking its preview URLs.
 *
 * `onCleanup(clear)` only registers inside a Solid owner; from React, use
 * src/platform/media/useAttachmentDraft.ts, which clears on unmount.
 */
import { createSignal, getOwner, onCleanup } from 'solid-js';
import { t } from '@web/i18n/t';
import { ATTACHMENTS_PER_MESSAGE, ATTACHMENT_MAX_BYTES, attachmentKind, formatFileSize, readImageDimensions } from './format';
import { deleteFileQuietly, normalizePickedFile } from '../../../media/files';
import type { LocalFile, PickedFileInput } from '../../../media/types';

/** A file queued in the composer, not yet uploaded. */
export interface PendingAttachment {
  localId: string;
  file: LocalFile;
  /** The file's own URI, for image/video/audio previews (and the optimistic message). */
  previewUrl?: string;
  width?: number;
  height?: number;
}

let nextLocalId = 1;

function discard(file: LocalFile): void {
  if (file.owned) deleteFileQuietly(file.uri);
}

/**
 * Per-composer queue of files to send with the next message. Validates size/count up front
 * (so the user hears about a too-large file when they pick it, not after the message fails)
 * and measures images for layout.
 */
export function createAttachmentDraft(opts: { maxFiles?: number; maxBytes?: number } = {}) {
  const maxFiles = opts.maxFiles ?? ATTACHMENTS_PER_MESSAGE;
  const maxBytes = opts.maxBytes ?? ATTACHMENT_MAX_BYTES;
  const [items, setItems] = createSignal<PendingAttachment[]>([]);
  const [error, setError] = createSignal('');

  async function addFiles(files: Iterable<PickedFileInput | LocalFile>): Promise<void> {
    const incoming = [...files].filter((f) => f && typeof f.uri === 'string' && f.uri).map(normalizePickedFile);
    if (incoming.length === 0) return;
    const room = maxFiles - items().length;
    if (room <= 0) {
      setError(t('attachments.tooMany', { count: maxFiles }));
      incoming.forEach(discard);
      return;
    }
    const accepted: PendingAttachment[] = [];
    let problem = '';
    for (const file of incoming) {
      if (accepted.length >= room) {
        problem = t('attachments.tooMany', { count: maxFiles });
        discard(file);
        continue;
      }
      if (file.size > maxBytes) {
        problem = t('attachments.tooLarge', { name: file.name || t('attachments.thatFile'), max: formatFileSize(maxBytes) });
        discard(file);
        continue;
      }
      if (file.size === 0) {
        problem = t('attachments.empty', { name: file.name || t('attachments.thatFile') });
        discard(file);
        continue;
      }
      const item: PendingAttachment = { localId: `att-${Date.now()}-${nextLocalId++}`, file };
      const kind = attachmentKind(file.type, file.name);
      // Audio gets a preview too, so a recorded voice message can be played back from the
      // pending strip before it is sent, and the optimistic message can play it at once.
      if (kind === 'image' || kind === 'video' || kind === 'audio') item.previewUrl = file.uri;
      if (file.width && file.height) {
        item.width = file.width;
        item.height = file.height;
      } else if (kind === 'image') {
        const dims = await readImageDimensions(file.uri);
        if (dims) {
          item.width = dims.width;
          item.height = dims.height;
        }
      }
      accepted.push(item);
    }
    if (accepted.length) setItems((prev) => [...prev, ...accepted]);
    setError(problem);
  }

  function remove(localId: string): void {
    const target = items().find((p) => p.localId === localId);
    setItems((prev) => prev.filter((p) => p.localId !== localId));
    if (target) discard(target.file);
    setError('');
  }

  /** Hand the queued files off (to sendMessage) and reset. The files are NOT deleted here -
   * the upload reads them, and the optimistic and sent message keep showing them. */
  function take(): PendingAttachment[] {
    const list = items();
    setItems([]);
    setError('');
    return list;
  }

  /** Put files back in the queue after a failed send so the user can retry. */
  function restore(list: PendingAttachment[]): void {
    if (list.length === 0) return;
    setItems((prev) => [...list, ...prev.filter((p) => !list.some((l) => l.localId === p.localId))].slice(0, maxFiles));
  }

  /** Empty the queue, discarding what was in it. */
  function clear(): void {
    const list = items();
    setItems([]);
    setError('');
    list.forEach((p) => discard(p.file));
  }

  if (getOwner()) onCleanup(clear);

  return { items, error, setError, addFiles, remove, take, restore, clear };
}

export type AttachmentDraft = ReturnType<typeof createAttachmentDraft>;
