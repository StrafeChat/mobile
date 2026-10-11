/**
 * Mobile-only strings (en). Everything the web client already says comes from its own locale
 * files (web/src/i18n/locales); this file holds only what exists on mobile alone, under the
 * `mobile.` prefix. Keep all six files in step (npm run check:i18n).
 */
export default {
  mobile: {
    // Design system (src/ui).
    ui: {
      choose: 'Choose…',
      dismiss: 'Dismiss',
      showPassword: 'Show password',
      hidePassword: 'Hide password',
      required: 'required',
      charactersLeft_one: '{{count}} character left',
      charactersLeft_other: '{{count}} characters left',
      showActions: 'Show actions',
      moreOptions: 'More options',
      opensSubmenu: 'Opens more options',
    },

    // Browser-bound web modules swapped on mobile (src/platform/overrides).
    webOverrides: {
      passkeyUnavailable: 'Passkeys are not available in the mobile app yet. Use your authenticator app or a recovery code.',
    },

    // Attachments, media and voice messages (src/platform/media).
    media: {
      unsupportedIos: "This clip can't be played on iPhone or iPad. Share it to open it in another app.",
      loadFailed: "Couldn't load this attachment.",
      retry: "Tap to retry",
      decryptFailed: "This attachment couldn't be decrypted.",
      tooLarge: "This encrypted file is too large to open on this device.",
      save: "Save to device",
      share: "Share",
      saved: "Saved to Photos.",
      saveDenied: "Allow Strafe to add photos in Settings to save this.",
      shareUnavailable: "Sharing isn't available on this device.",
      cameraDenied: "Camera access is off. Turn it on in Settings to take photos and videos.",
      micDenied: "Microphone access is off. Turn it on in Settings to record voice messages.",
      pickFailed: "Couldn't add that file.",
    },

    // Start-up and connection state (src/platform/boot.ts).
    boot: {
      startFailed: "Strafe couldn't start.",
      retry: "Try again",
      offlineNotice: "You're offline. Showing what's on this device.",
    },


    // The end-to-end encryption engine (src/platform/crypto).
    crypto: {
      engineUnavailableTitle: "Encryption isn't available",
      engineUnavailableBody: "Strafe couldn't start its encryption engine, so encrypted conversations can't be read or sent from this device. Restart the app to try again.",
    },
  },
};
