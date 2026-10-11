/**
 * Mobile replacement for web/src/api/messages.ts: every export is the web's, except
 * `uploadAttachment`.
 *
 * The web uploads a Blob through XMLHttpRequest + FormData for its progress events. React
 * Native's XHR and FormData do the same job, but a file part is a `{uri, name, type}`
 * descriptor that the native networking layer streams from disk - there is no Blob to append.
 * So the mobile upload takes a LocalFile (what the composer queues, and what the attachment
 * encryptor returns as its ciphertext) and is otherwise the web's request: same endpoint,
 * fields, auth header, progress fraction, cancellation and ApiError on failure.
 *
 * Also `searchMessages`: the web asks the server first even in an end-to-end encrypted room,
 * which answers `searchable: false` - but only after it has been told the search terms. Here a
 * room known to be encrypted gets that answer locally, so its terms never leave the device
 * (lib/messageSearch then searches the decrypted history, exactly as before).
 *
 * Two mobile additions: an encrypted upload's ciphertext temp file is deleted once the
 * request settles, and on success the sender's plaintext is filed in the decrypted cache (see
 * src/platform/media/uploadSeeds.ts). Hermes has no DOMException, so cancellation rejects
 * with an Error named 'AbortError' - the web's own abort shape, which is all callers test.
 */
import { ApiError, getApiUrl } from '@web/api/client';
import type { Attachment, SearchMessagesParams, SearchMessagesResult, UploadAttachmentOptions } from '@web-original/api/messages';
import { searchMessages as searchMessagesOnServer } from '@web-original/api/messages';
import { rooms } from '@web/stores/rooms';
import { spaces } from '@web/stores/spaces';
import { seedDecryptedAttachment } from '../../../media/attachmentCache';
import { deleteFileQuietly } from '../../../media/files';
import type { LocalFile } from '../../../media/types';
import { takeUploadSeed } from '../../../media/uploadSeeds';

export * from '@web-original/api/messages';

/** End-to-end encrypted, as far as the stores know (PM/group copies and space channel lists). */
function knownEncrypted(roomId: string): boolean {
  if (rooms.rooms.find((r) => r.id === roomId)?.e2ee_enabled === true) return true;
  for (const list of Object.values(spaces.spaceRoomsBySpaceId)) {
    const room = list.find((r) => r.id === roomId);
    if (room) return room.e2ee_enabled === true;
  }
  return false;
}

export function searchMessages(roomId: string, params: SearchMessagesParams): Promise<SearchMessagesResult> {
  if (knownEncrypted(roomId)) return Promise.resolve({ searchable: false, messages: [] });
  return searchMessagesOnServer(roomId, params);
}

function abortError(): Error {
  const DOMExceptionCtor = (globalThis as { DOMException?: new (message: string, name: string) => Error }).DOMException;
  if (typeof DOMExceptionCtor === 'function') return new DOMExceptionCtor('Upload cancelled', 'AbortError');
  const err = new Error('Upload cancelled');
  err.name = 'AbortError';
  return err;
}

/** The server's error body, read defensively: it is data, and may not even be JSON. */
function parseErrorBody(text: string): Record<string, unknown> | null {
  try {
    const body = JSON.parse(text) as unknown;
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Upload one file into a room ahead of sending the message that references it.
 *
 * Plaintext rooms send the file under its own name and type; encrypted uploads
 * (`opts.encrypted`) send the ciphertext as 'blob' / application/octet-stream with
 * `encrypted=1`, exactly as the web does, so the server learns nothing about the file.
 */
export function uploadAttachment(roomId: string, file: LocalFile, opts: UploadAttachmentOptions = {}): Promise<Attachment> {
  const settle = (): void => {
    if (file.deleteAfterUpload) deleteFileQuietly(file.uri);
  };
  const seed = opts.encrypted ? takeUploadSeed(file) : null;

  const request = new Promise<Attachment>((resolve, reject) => {
    if (opts.signal?.aborted) {
      reject(abortError());
      return;
    }
    const form = new FormData();
    const name = opts.encrypted ? 'blob' : (opts.filename ?? file.name) || 'file';
    const type = opts.encrypted ? 'application/octet-stream' : file.type || 'application/octet-stream';
    // React Native's FormData file part; the native layer reads the bytes from `uri`.
    form.append('file', { uri: file.uri, name, type } as unknown as Blob);
    if (opts.width && opts.height) {
      form.append('width', String(opts.width));
      form.append('height', String(opts.height));
    }
    if (opts.encrypted) form.append('encrypted', '1');

    const xhr = new XMLHttpRequest();
    const onAbortSignal = () => xhr.abort();
    const done = () => opts.signal?.removeEventListener('abort', onAbortSignal);

    xhr.open('POST', `${getApiUrl()}/rooms/${roomId}/attachments`);
    const token = localStorage.getItem('session_token');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) opts.onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      done();
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Attachment);
        } catch {
          reject(new ApiError('Invalid upload response', xhr.status));
        }
        return;
      }
      const body = parseErrorBody(xhr.responseText);
      const message = typeof body?.error === 'string' ? body.error : `HTTP ${xhr.status}`;
      const description = typeof body?.error_description === 'string' ? body.error_description : undefined;
      const code = typeof body?.code === 'string' ? body.code : undefined;
      reject(new ApiError(message, xhr.status, description, code, body ?? undefined));
    };
    xhr.onerror = () => {
      done();
      reject(new ApiError('Network error during upload', 0));
    };
    xhr.onabort = () => {
      done();
      reject(abortError());
    };
    opts.signal?.addEventListener('abort', onAbortSignal, { once: true });
    xhr.send(form);
  });

  return request.then(
    (attachment) => {
      settle();
      if (seed && attachment?.id && attachment.url) {
        void seedDecryptedAttachment(
          {
            id: attachment.id,
            filename: seed.filename,
            contentType: seed.contentType,
            encryption: seed.material,
          },
          seed.plaintextUri,
        ).catch(() => undefined);
      }
      return attachment;
    },
    (err: unknown) => {
      settle();
      throw err;
    },
  );
}
