/**
 * Media & attachments: the web modules that read or write files through Blob, File, object
 * URLs, MediaRecorder or a Blob-bodied XHR, replaced by file-URI implementations with the same
 * exports. Merged into ./manifest.js; see src/platform/media/README.md.
 */
module.exports = {
  WEB_MODULE_OVERRIDES: {
    // AES-256-GCM over file URIs (same byte format), ciphertext to a temp file.
    'lib/attachments/crypto': 'src/platform/overrides/media/attachments/crypto.ts',
    // The composer queue over LocalFiles instead of DOM Files and object URLs.
    'lib/attachments/draft': 'src/platform/overrides/media/attachments/draft.ts',
    // readImageDimensions through the native image loader; the rest re-exported.
    'lib/attachments/format': 'src/platform/overrides/media/attachments/format.ts',
    // readHead / typedClipUrl on files; the sniffers re-exported.
    'lib/media/clipFormat': 'src/platform/overrides/media/clipFormat.ts',
    // expo-audio recording (AAC/M4A) with metering.
    'lib/voiceRecorder': 'src/platform/overrides/media/voiceRecorder.ts',
    // uploadAttachment with React Native FormData file parts; the rest re-exported.
    'api/messages': 'src/platform/overrides/media/api/messages.ts',
  },
  PACKAGE_OVERRIDES: {},
};
