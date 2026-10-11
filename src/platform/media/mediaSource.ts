/**
 * From a message attachment to something an image view or player can open.
 *
 * The mobile counterpart of the web's useDisplayUrl / usePlayableUrl (MessageAttachments.tsx):
 *
 * - a file being sent (or just sent from this device) shows from its local `previewUrl`;
 * - an E2EE attachment is downloaded, decrypted and cached (./attachmentCache.ts) and shows
 *   from that `file://` URI - the ciphertext URL is never handed to a view;
 * - plaintext audio (up to 8 MiB) is saved once under its real container's extension (the
 *   clipFormat override's typedClip), as the web re-types clips, falling back to the URL if
 *   that fails; larger audio streams from its URL;
 * - plaintext images, video and files show from their CDN URL.
 *
 * Audio and video then go through the platform check (./playability.ts): on iOS a WebM or Ogg
 * clip resolves as `status: 'unsupported'`, reason 'ios-container', still carrying its URI
 * so the UI can offer download/share (./export.ts) next to a clear "can't be played on iOS".
 */
import { useEffect, useRef, useState } from 'react';
import { attachmentKind, isVoiceMessage, type AttachmentKind } from '@web-original/lib/attachments/format';
import type { AttachmentView } from '@web-original/lib/attachments/types';
import { sniffClipFormat, type ClipFormat } from '@web-original/lib/media/clipFormat';
import { typedClip } from '../overrides/media/clipFormat';
import {
  AttachmentFetchError,
  getDecryptedAttachment,
  peekDecryptedAttachment,
  type AttachmentFetchErrorReason,
} from './attachmentCache';
import { absoluteUrl, readHeadBytes } from './files';
import { playbackBlocker, type PlaybackBlocker } from './playability';

export interface MediaSourceInfo {
  /** What to load: a `file://` URI or, for plaintext media, the CDN URL. */
  uri: string;
  kind: AttachmentKind;
  /** A recorded voice message (show the compact voice player). */
  voice: boolean;
  /** `uri` is a file on this device (decrypted, re-typed, or the sender's own copy). */
  local: boolean;
  /** The attachment is end-to-end encrypted. */
  encrypted: boolean;
  /** The audio/video container its bytes hold, when known. */
  format: ClipFormat | null;
}

export type ResolvedMediaSource =
  | (MediaSourceInfo & { status: 'ready' })
  | (MediaSourceInfo & { status: 'unsupported'; reason: PlaybackBlocker });

export type MediaSourceErrorReason = AttachmentFetchErrorReason;

/** What `useAttachmentSource` returns. */
export type MediaSourceState =
  | { status: 'loading'; /** 0..1 download progress of an encrypted attachment, when known. */ progress: number | null }
  | ResolvedMediaSource
  | { status: 'error'; reason: MediaSourceErrorReason; retry: () => void };

type SourceAttachment = Pick<AttachmentView, 'id' | 'url' | 'filename' | 'contentType' | 'size' | 'encryption' | 'previewUrl'>;

function classify(att: SourceAttachment): { kind: AttachmentKind; voice: boolean } {
  const voice = isVoiceMessage(att.contentType, att.filename);
  // A voice clip is audio whatever its extension suggests (a type-less `.webm` reads as video).
  return { kind: voice ? 'audio' : attachmentKind(att.contentType, att.filename), voice };
}

function finish(att: SourceAttachment, info: Omit<MediaSourceInfo, 'kind' | 'voice' | 'encrypted'>): ResolvedMediaSource {
  const { kind, voice } = classify(att);
  const full: MediaSourceInfo = { ...info, kind, voice, encrypted: !!att.encryption };
  const blocker = playbackBlocker(att.contentType, att.filename, info.format);
  return blocker ? { ...full, status: 'unsupported', reason: blocker } : { ...full, status: 'ready' };
}

/**
 * Plaintext audio up to this size is fetched whole and re-typed from its bytes (voice messages
 * are a few hundred KB); anything larger streams from its URL, judged by name and type.
 */
const RETYPE_MAX_BYTES = 8 * 1024 * 1024;

function wantsRetype(att: SourceAttachment): boolean {
  return classify(att).kind === 'audio' && att.size <= RETYPE_MAX_BYTES;
}

function isMedia(att: SourceAttachment): boolean {
  const { kind } = classify(att);
  return kind === 'audio' || kind === 'video';
}

function fromPreview(att: SourceAttachment): ResolvedMediaSource {
  const uri = att.previewUrl!;
  const format = isMedia(att) ? sniffClipFormat(readHeadBytes(uri, 16)) : null;
  return finish(att, { uri, local: true, format });
}

/**
 * The source, if it can be known without waiting: a local preview, an already-decrypted
 * attachment, or a plaintext image/video/file. Null when a download or decrypt is needed.
 */
export function attachmentSourceSync(att: SourceAttachment): ResolvedMediaSource | null {
  if (att.previewUrl) return fromPreview(att);
  if (att.encryption) {
    const cached = peekDecryptedAttachment(att);
    return cached ? finish(att, { uri: cached.uri, local: true, format: cached.format }) : null;
  }
  if (wantsRetype(att)) return null;
  return finish(att, { uri: absoluteUrl(att.url), local: false, format: null });
}

/**
 * Resolve an attachment to a displayable source, downloading and decrypting as needed.
 * Rejects with AttachmentFetchError for an encrypted attachment that cannot be fetched or
 * fails to decrypt; never for plaintext media (the URL is the fallback).
 */
export async function resolveAttachmentSource(
  att: SourceAttachment,
  opts: { onProgress?: (fraction: number) => void } = {},
): Promise<ResolvedMediaSource> {
  if (att.previewUrl) return fromPreview(att);
  if (att.encryption) {
    const d = await getDecryptedAttachment(att, opts);
    return finish(att, { uri: d.uri, local: true, format: d.format });
  }
  if (wantsRetype(att)) {
    const clip = await typedClip(att.url, att.contentType, att.filename);
    if (clip) return finish(att, { uri: clip.uri, local: true, format: clip.sniffed ? clip.format : null });
  }
  return finish(att, { uri: absoluteUrl(att.url), local: false, format: null });
}

function reasonOf(err: unknown): MediaSourceErrorReason {
  return err instanceof AttachmentFetchError ? err.reason : 'storage';
}

function sourceKey(att: SourceAttachment | null | undefined): string {
  if (!att) return '';
  return [att.id, att.url, att.previewUrl ?? '', att.encryption?.iv ?? '', att.encryption?.key ?? ''].join('|');
}

const LOADING: MediaSourceState = { status: 'loading', progress: null };

function initialState(att: SourceAttachment | null | undefined): MediaSourceState {
  return (att && attachmentSourceSync(att)) || LOADING;
}

/**
 * React hook: the source for one attachment, as it resolves. Pass the attachment snapshot
 * (useSolid gives one); the hook re-resolves only when its identity (id, URL, preview, key)
 * changes. An 'error' state carries `retry()`.
 */
export function useAttachmentSource(att: SourceAttachment | null | undefined): MediaSourceState {
  const key = sourceKey(att);
  const attRef = useRef(att);
  attRef.current = att;
  const [attempt, setAttempt] = useState(0);
  const [entry, setEntry] = useState<{ key: string; state: MediaSourceState }>(() => ({ key, state: initialState(att) }));

  useEffect(() => {
    const current = attRef.current;
    if (!current) {
      setEntry({ key, state: LOADING });
      return undefined;
    }
    const sync = attachmentSourceSync(current);
    if (sync) {
      setEntry({ key, state: sync });
      return undefined;
    }
    let live = true;
    let shownStep = -1;
    setEntry({ key, state: LOADING });
    resolveAttachmentSource(current, {
      onProgress: (fraction) => {
        // 2% steps: the native progress events are far more frequent than a bar can show.
        const step = Math.floor(fraction * 50);
        if (!live || step === shownStep) return;
        shownStep = step;
        setEntry((prev) => (prev.key === key && prev.state.status === 'loading' ? { key, state: { status: 'loading', progress: step / 50 } } : prev));
      },
    }).then(
      (resolved) => live && setEntry({ key, state: resolved }),
      (err: unknown) =>
        live && setEntry({ key, state: { status: 'error', reason: reasonOf(err), retry: () => setAttempt((n) => n + 1) } }),
    );
    return () => {
      live = false;
    };
  }, [key, attempt]);

  // Between a change of attachment and the effect above, answer for the new one.
  return entry.key === key ? entry.state : initialState(att);
}
