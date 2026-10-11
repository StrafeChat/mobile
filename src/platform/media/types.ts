/**
 * The file shapes the mobile attachment pipeline passes around where the web passes DOM
 * `File`/`Blob` objects.
 *
 * React Native has no `File` and cannot build a `Blob` from bytes, but its `FormData` takes a
 * `{uri, name, type}` part and uploads the file at `uri` natively. `LocalFile` is that part
 * plus the size, so it is at once what the composer queues, what the encryptor reads, and
 * what the uploader sends. stores/messages reads exactly `name`, `type` and `size` off a
 * queued file - the same three fields it reads off a DOM File - so the shared send path runs
 * unchanged with these.
 */

export interface LocalFile {
  /** `file://` for anything the app copied or produced; `content://` only for unowned Android picks. */
  uri: string;
  /** Display/upload name, including the extension. */
  name: string;
  /** MIME type (parameterless where the app chose it). */
  type: string;
  /** Bytes. */
  size: number;
  /** Pixel dimensions, when the source already knew them (image picker, camera). */
  width?: number;
  height?: number;
  /**
   * The app made this copy (picker/camera cache, voice recording) rather than borrowing the
   * user's original, so it may delete it once it is discarded unsent.
   */
  owned?: boolean;
  /** A ciphertext temp file: the uploader deletes it once the upload settles. */
  deleteAfterUpload?: boolean;
}

/**
 * Anything a picker hands back, accepted as-is by `createAttachmentDraft().addFiles`:
 * an expo-image-picker asset (`fileName`, `fileSize`, `mimeType`, `type: 'image' | 'video'`),
 * an expo-document-picker asset (`name`, `size`, `mimeType`), or a `LocalFile`.
 *
 * Note `type`: on a LocalFile it is a MIME type, on an image-picker asset it is the word
 * 'image' or 'video'. Only a value containing a slash is read as a MIME type.
 */
export interface PickedFileInput {
  uri: string;
  name?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  type?: string | null;
  size?: number | null;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  owned?: boolean;
}
