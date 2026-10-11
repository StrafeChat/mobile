/**
 * The media layer's public surface for the UI: attachments (queue, pick, record, display,
 * save, share) and media playback.
 *
 * Import from here (`@/platform/media`) rather than `@web/lib/attachments/*`: Metro swaps
 * those web modules for the mobile overrides at runtime, but TypeScript still types the
 * `@web/...` paths as the web files (DOM File, Blob), so only these exports carry the mobile
 * types. They are the same module instances the shared stores use.
 */
export type { LocalFile, PickedFileInput } from './types';

// The composer's queue (attachments/draft override) and its React hook.
export { createAttachmentDraft, type AttachmentDraft, type PendingAttachment } from '../overrides/media/attachments/draft';
export { useAttachmentDraft, asWebPendingAttachments } from './useAttachmentDraft';

// Picking files.
export { pickFromLibrary, takePhoto, recordVideo, pickDocuments, recoverPendingPick, type PickResult } from './pickers';

// Voice messages (lib/voiceRecorder override).
export {
  startVoiceRecording,
  isVoiceRecordingSupported,
  meteringToLevel,
  VoiceRecorderError,
  VOICE_MESSAGE_MAX_MS,
  VOICE_MESSAGE_MIN_MS,
  type VoiceRecorderErrorReason,
  type VoiceRecorderHandle,
  type VoiceRecording,
} from '../overrides/media/voiceRecorder';

// Showing an attachment.
export {
  useAttachmentSource,
  resolveAttachmentSource,
  attachmentSourceSync,
  type MediaSourceInfo,
  type MediaSourceState,
  type MediaSourceErrorReason,
  type ResolvedMediaSource,
} from './mediaSource';
export { playbackBlocker, canPlayOnThisDevice, type PlaybackBlocker } from './playability';
export {
  getDecryptedAttachment,
  peekDecryptedAttachment,
  seedDecryptedAttachment,
  clearAttachmentCache,
  configureAttachmentCache,
  attachmentCacheUsage,
  AttachmentFetchError,
  DEFAULT_ATTACHMENT_CACHE_BYTES,
  type AttachmentFetchErrorReason,
  type DecryptedAttachment,
} from './attachmentCache';
export { readImageDimensions } from '../overrides/media/attachments/format';

// Getting an attachment out of the app.
export { saveAttachmentToDevice, shareAttachment, type ExportResult } from './export';

// One player at a time (stores/mediaPlayback) for expo-audio / expo-video players.
export { claimPlayer, releasePlayer, playExclusive, useExclusivePlayback, type PlayerLike } from './playback';

// The audio-session mode for message media; the voice layer registers its call guard here.
export { setAudioSessionGuard, applyMessageAudioMode } from './audioSession';

// Crypto limits the UI may want to explain.
export { ATTACHMENT_CRYPTO_MAX_BYTES, AttachmentCryptoError } from '../overrides/media/attachments/crypto';

// Boot-time housekeeping and the sign-out wipe.
export { installMediaLifecycle, clearMediaCaches } from './lifecycle';
