/**
 * Whether this device's native player can play a clip, decided before handing it over.
 *
 * ## The iOS gap
 *
 * expo-audio and expo-video play through AVFoundation on iOS and ExoPlayer on Android.
 * ExoPlayer reads WebM, Matroska and Ogg (Opus, Vorbis) as well as MP4/M4A, MP3, AAC, WAV and
 * FLAC. AVFoundation reads the MP4 family, MP3, AAC, WAV/AIFF/CAF and FLAC - and **no WebM,
 * Matroska or Ogg container at all**, whatever codec is inside.
 *
 * That matters because of what the web sends: Chrome, Edge and Firefox record voice messages
 * as Opus in WebM (older Firefox: Ogg), and screen captures and many uploads are WebM video.
 * On iOS those are not playable, and no option on the player changes it. Rather than leave a
 * player spinning or failing with a generic error, the source resolver reports such a clip as
 * `status: 'unsupported'` (reason `'ios-container'`) with a local or remote URI still
 * attached, so the UI shows a clear "can't be played on iOS" state and offers download /
 * share to another app (VLC and the like play them). Recordings made by this app are AAC in
 * M4A, which every client plays.
 *
 * Fixing it for real needs one of: transcoding on the server (no media pipeline exists
 * there today), a bundled decoder (e.g. react-native-audio-api with an Opus/WebM demuxer), or
 * the web recorder preferring MP4/AAC where the browser offers it. None is in place.
 *
 * The decision prefers what the bytes say (a sniffed container) over the name and declared
 * type, because a Firefox clip can be named `.webm` while holding Ogg and either is unplayable,
 * while a clip *named* `.webm` whose bytes are MP4 plays fine.
 */
import { Platform } from 'react-native';
import { attachmentKind, type AttachmentKind } from '@web-original/lib/attachments/format';
import type { ClipFormat } from '@web-original/lib/media/clipFormat';
import { extensionOf } from './files';

export type PlaybackBlocker = 'ios-container';

/** Container extensions AVFoundation cannot open. */
const IOS_UNPLAYABLE_EXTENSIONS = new Set(['webm', 'weba', 'mkv', 'mka', 'ogg', 'oga', 'ogv', 'opus', 'spx', 'flv', 'avi', 'wmv', 'wma']);

/** The same, as (parameterless) MIME types. */
const IOS_UNPLAYABLE_TYPES = new Set([
  'audio/webm',
  'video/webm',
  'audio/ogg',
  'video/ogg',
  'application/ogg',
  'audio/opus',
  'audio/x-matroska',
  'video/x-matroska',
  'video/x-flv',
  'video/x-msvideo',
  'video/x-ms-wmv',
  'audio/x-ms-wma',
]);

/** Extensions that name a media container (so a name can outrank a declared type). */
const MEDIA_EXTENSIONS = new Set([
  ...IOS_UNPLAYABLE_EXTENSIONS,
  'mp4',
  'm4a',
  'm4v',
  'm4b',
  'mov',
  'mp3',
  'aac',
  'wav',
  'aiff',
  'aif',
  'caf',
  'flac',
  '3gp',
]);

/**
 * Why `platform` cannot play this clip, or null when it can (or when it is not audio/video).
 * `sniffed` is the container read from the file's own bytes, when known.
 */
export function playbackBlocker(
  contentType: string | undefined,
  filename: string | undefined,
  sniffed?: ClipFormat | null,
  platform: string = Platform.OS,
): PlaybackBlocker | null {
  if (platform !== 'ios') return null;
  const kind: AttachmentKind = attachmentKind(contentType, filename);
  if (kind !== 'audio' && kind !== 'video') return null;
  if (sniffed) return IOS_UNPLAYABLE_EXTENSIONS.has(sniffed.ext) ? 'ios-container' : null;
  const ext = extensionOf(filename);
  if (MEDIA_EXTENSIONS.has(ext)) return IOS_UNPLAYABLE_EXTENSIONS.has(ext) ? 'ios-container' : null;
  const type = (contentType ?? '').split(';')[0]!.trim().toLowerCase();
  return IOS_UNPLAYABLE_TYPES.has(type) ? 'ios-container' : null;
}

/** Shorthand: can this device's player open the clip at all. */
export function canPlayOnThisDevice(contentType: string | undefined, filename: string | undefined, sniffed?: ClipFormat | null): boolean {
  return playbackBlocker(contentType, filename, sniffed) === null;
}
