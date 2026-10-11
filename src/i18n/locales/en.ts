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

    // Push notifications (src/platform/push): the native renderer's strings, then Settings -> Notifications.
    push: {
      appName: "Strafe",
      newMessage: "New message",
      encryptedMessage: "Encrypted message",
      attachment: "Sent an attachment",
      spaceRoom: "#{{room}} · {{space}}",
      threadRoom: "{{thread}} · #{{room}}",
      incomingCall: "Incoming call",
      callFrom: "{{name}} is calling",
      callFromIn: "{{name}} is calling {{room}}",
      markRead: "Mark as read",
      reply: "Reply",
      answer: "Answer",
      decline: "Decline",
      testTitle: "Push notifications work",
      testBody: "This came from your instance, encrypted all the way to this device.",
      channelMessages: "Messages",
      channelMessagesSilent: "Messages (silent)",
      channelCalls: "Incoming calls",
      fallback: "New notification",
      title: "Push notifications",
      toggle: "Notify me while Strafe is closed",
      statusActive: "Active · {{transport}}",
      statusRegistering: "Setting up…",
      statusUnavailable: "This build of the app can't receive push notifications.",
      statusDisabled: "Off. You're notified only while Strafe is running.",
      statusSignedOut: "Sign in to receive push notifications.",
      statusPermission: "Strafe isn't allowed to show notifications. Allow them in the system settings.",
      noTransport: "No push service on this device: this build has no Firebase and no UnifiedPush distributor is installed.",
      noTransportChoose: "Several UnifiedPush distributors are installed. Choose one below.",
      noTransportFcm: "Firebase isn't available in this build or on this device.",
      noTransportMissing: "The UnifiedPush distributor you chose is no longer installed.",
      errorTransport: "{{transport}} didn't register this device ({{error}}).",
      errorGateway: "Couldn't reach the push gateway ({{error}}).",
      errorDistributor: "UnifiedPush didn't register this device ({{error}}).",
      errorInstance: "Your instance refused this device ({{error}}).",
      errorUnsupported: "Your instance doesn't send push notifications.",
      transportFcm: "Firebase Cloud Messaging",
      transportApns: "Apple Push Notification service",
      transportUnifiedPush: "UnifiedPush ({{distributor}})",
      transportDebug: "Development gateway",
      transportTitle: "Push service",
      transportAuto: "Automatic",
      transportAutoHint: "Firebase when available, otherwise your UnifiedPush distributor.",
      transportFcmHint: "Delivered through Google Play services.",
      transportFcmUnavailable: "Not available in this build or on this device.",
      transportDistributorHint: "UnifiedPush: self-hostable, no Google involved.",
      transportDebugHint: "Development builds only: the local gateway keeps pushes for adb to replay.",
      test: "Send a test notification",
      testHint: "Your instance pushes one to this device.",
      testSent: "Test notification sent.",
      testFailed: "The test notification wasn't delivered ({{error}}).",
      testNotRegistered: "Your instance didn't know this device yet. Registering it again.",
      privacyNote: "Notifications are encrypted by your instance for this device; Apple, Google, UnifiedPush and the push gateway only pass on ciphertext. In encrypted conversations a notification says who wrote where, never what.",
    },
  },
};
