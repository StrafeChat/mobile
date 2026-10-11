/**
 * Mobile replacement for web/src/lib/media/clipFormat.ts.
 *
 * The pure parts (`sniffClipFormat`, `bareMediaType`, `clipFormatFromName`) are the web's,
 * re-exported. The two functions that used Blobs are rebuilt on files:
 *
 * - `readHead` reads a file's first bytes through a file handle instead of `Blob.slice`.
 * - `typedClipUrl` solves the web's problem the app's way. On the web, a clip whose served
 *   Content-Type disagrees with its bytes is refetched and re-typed as an object URL. Native
 *   players (AVPlayer above all) decide what a local file is from its extension, so here the
 *   clip is downloaded once and saved under the extension of the container its magic number
 *   names; the returned `file://` URI plays wherever that container can. It also tells the
 *   caller what the container really is, which is how the iOS "can't play WebM/Ogg" case is
 *   detected from the bytes rather than guessed from a name (see src/platform/media/playability.ts).
 */
import { File } from 'expo-file-system';
import { clipFormatFromName, sniffClipFormat, type ClipFormat } from '@web-original/lib/media/clipFormat';
import { absoluteUrl, deleteFileQuietly, mediaDirectory, randomName, readHeadBytes } from '../../media/files';

export * from '@web-original/lib/media/clipFormat';

/** The first 16 bytes of a local file (enough for every magic number sniffClipFormat knows). */
export async function readHead(file: { uri: string } | string): Promise<Uint8Array> {
  return readHeadBytes(typeof file === 'string' ? file : file.uri, 16);
}

export interface TypedClip {
  /** `file://` URI named with the real container's extension. */
  uri: string;
  format: ClipFormat;
  /** Whether `format` came from the bytes (true) or only from the name/type (false). */
  sniffed: boolean;
}

/** Session cache, per remote URL, like the web's; bounded, and evicted files are deleted. */
const typedClips = new Map<string, Promise<TypedClip | null>>();
const MAX_CLIPS = 40;

/**
 * Download `url` once and save it under its real container's extension. Resolves null when it
 * cannot be fetched (callers fall back to the remote URL - a failed fetch is no reason to
 * withhold the file).
 */
export function typedClip(url: string, contentType: string | undefined, filename?: string): Promise<TypedClip | null> {
  let p = typedClips.get(url);
  if (p) {
    // Refresh recency: a Map iterates in insertion order, so re-inserting makes it newest.
    typedClips.delete(url);
    typedClips.set(url, p);
    return p;
  }
  p = (async (): Promise<TypedClip | null> => {
    const incoming = new File(mediaDirectory('incoming'), `${randomName()}.bin`);
    try {
      await File.downloadFileAsync(absoluteUrl(url), incoming, { idempotent: true });
      const sniffedFormat = sniffClipFormat(readHeadBytes(incoming.uri, 16));
      const format = sniffedFormat ?? clipFormatFromName(contentType, filename);
      const dest = new File(mediaDirectory('clips'), `${randomName()}.${format.ext}`);
      incoming.moveSync(dest);
      return { uri: dest.uri, format, sniffed: sniffedFormat !== null };
    } catch {
      deleteFileQuietly(incoming.uri);
      return null;
    }
  })();
  p.then((clip) => {
    // A failure must not stick: the next attempt should try again.
    if (!clip && typedClips.get(url) === p) typedClips.delete(url);
  });
  while (typedClips.size >= MAX_CLIPS) {
    const oldest = typedClips.keys().next().value;
    if (oldest === undefined) break;
    const evicted = typedClips.get(oldest);
    typedClips.delete(oldest);
    void evicted?.then((clip) => clip && deleteFileQuietly(clip.uri));
  }
  typedClips.set(url, p);
  return p;
}

/** The web's signature: just the URI (null when the clip could not be fetched). */
export async function typedClipUrl(url: string, contentType: string | undefined, filename?: string): Promise<string | null> {
  return (await typedClip(url, contentType, filename))?.uri ?? null;
}

/** Forget every re-typed clip (sign-out); the files go with the clips directory. */
export function clearTypedClips(): void {
  typedClips.clear();
}
