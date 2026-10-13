# Media & attachments on mobile

The web client's attachment pipeline - queue, encrypt, upload, decrypt, display, voice
messages - runs on mobile with its logic unchanged. What changes is the I/O: React Native has
no `File`, cannot build a `Blob` from bytes, has no object URLs, `MediaRecorder` or Web Audio.
So the web modules that touch those are overridden (`../overrides/media.manifest.js`) with
file-URI versions that keep their exports, and this folder holds what the native UI needs on
top.

## The file shape

Everywhere the web passes a DOM `File`, mobile passes a `LocalFile` (`types.ts`):
`{uri, name, type, size}` - React Native's `FormData` file part plus a size - with optional
`width`/`height` and an `owned` flag for copies the app made (deleted if discarded unsent).
`stores/messages.sendMessage` reads only `name`/`type`/`size` off a queued file, as off a DOM
File, so the shared send path is untouched. Its parameter is still typed with the web's
`PendingAttachment`; `asWebPendingAttachments()` is the documented cast.

## Sending

1. `pickFromLibrary` / `takePhoto` / `recordVideo` / `pickDocuments` (`pickers.ts`), or
   `startVoiceRecording()` -> `handle.stop()` -> `clip.file`. Every image-picker pick (camera
   or library, both platforms) has its location metadata removed in place first
   (`stripLocation.ts`: the EXIF GPS directory, XMP that mentions GPS, MP4 `©xyz`/`loci`, and
   the items of QuickTime keyed metadata whose key names a location, such as an iPhone
   recording's `com.apple.quicktime.location.ISO6709`). Nothing moves and nothing is
   re-encoded; a file that cannot be checked fails the pick and its copies are deleted. An iOS
   photo is normally re-encoded without its metadata, so there is nothing left to find; an iOS
   video keeps its own. Only JPEG and MP4/QuickTime are parsed: other formats (PNG, WebP,
   HEIC...) pass as they are.
2. `draft.addFiles(files)` (`useAttachmentDraft()` in React): size/count validation with the
   web's messages, preview URI, image dimensions.
3. `sendMessage(roomId, text, replyTo, asWebPendingAttachments(draft.take()))`. In an E2EE
   room the messages store calls `encryptAttachment` (AES-256-GCM, the web's byte format:
   random 32-byte key, 12-byte IV, no AAD, `ciphertext || tag`, key/IV in the Megolm body) and
   uploads the ciphertext temp file as `blob` with `encrypted=1`; otherwise it uploads the file
   itself. Upload progress lands on the optimistic message as on the web.

GCM is single-shot through WebCrypto, so a file is in memory twice at its peak. The cap is
`ATTACHMENT_CRYPTO_MAX_BYTES` = 32 MiB (the attachment limit is 25 MiB).

## Showing

`useAttachmentSource(attachment)` (`mediaSource.ts`) resolves an `AttachmentView` to a URI:
local preview while sending, decrypted cache file for E2EE (downloaded and decrypted on first
use, `attachmentCache.ts`: `<cache>/strafe-media/decrypted`, LRU, 256 MiB, wiped at sign-out),
a re-typed local copy for plaintext audio, the CDN URL otherwise. States: `loading` (with
download progress), `ready`, `unsupported`, `error` (with `retry`).

## iOS cannot play WebM or Ogg

AVFoundation (behind expo-audio and expo-video on iOS) opens no WebM, Matroska or Ogg
container. Browsers record voice messages as Opus in WebM (Firefox: sometimes Ogg), and many
uploaded videos are WebM, so on iOS those resolve as `status: 'unsupported'`,
`reason: 'ios-container'` - decided from the file's own bytes when it is local, from its name
and type otherwise. The UI shows that state plainly and offers `shareAttachment` /
`saveAttachmentToDevice` so it can be opened elsewhere. Android (ExoPlayer) plays them.
Recordings made by this app are AAC in M4A and play everywhere. A real fix needs server-side
transcoding, a bundled decoder, or the web recorder preferring MP4 where the browser can.

## Playback

`playExclusive(player)` / `useExclusivePlayback(player, playing)` (`playback.ts`) put expo-audio
and expo-video players under the web's `stores/mediaPlayback`, so starting one pauses the
other; `preferredVolume` / `rememberVolume` come from that store directly.

The audio session (`audioSession.ts`): expo-audio's `setAudioModeAsync` does not merge, so the
media layer applies one of two complete modes - playback (heard with the ringer on silent) and
recording - and never while a call owns the session (`setAudioSessionGuard`, registered by
the voice layer).

## Housekeeping

`installMediaLifecycle()` once at boot: sweeps per-session temp files at start-up and wipes
everything (decrypted files included) at sign-out or when a different account signs in.
