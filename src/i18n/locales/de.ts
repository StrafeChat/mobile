/**
 * Mobile-only strings (de). Everything the web client already says comes from its own locale
 * files (web/src/i18n/locales); this file holds only what exists on mobile alone, under the
 * `mobile.` prefix. Keep all six files in step (npm run check:i18n).
 */
export default {
  mobile: {
    // Design system (src/ui).
    ui: {
      choose: 'Auswählen…',
      dismiss: 'Schließen',
      showPassword: 'Passwort anzeigen',
      hidePassword: 'Passwort verbergen',
      required: 'erforderlich',
      charactersLeft_one: 'Noch {{count}} Zeichen',
      charactersLeft_other: 'Noch {{count}} Zeichen',
      showActions: 'Aktionen anzeigen',
      moreOptions: 'Weitere Optionen',
      opensSubmenu: 'Öffnet weitere Optionen',
    },

    // Browser-bound web modules swapped on mobile (src/platform/overrides).
    webOverrides: {
      passkeyUnavailable: 'Passkeys sind in der mobilen App noch nicht verfügbar. Nutze deine Authenticator-App oder einen Wiederherstellungscode.',
    },

    // Attachments, media and voice messages (src/platform/media).
    media: {
      unsupportedIos: "Dieser Clip kann auf iPhone und iPad nicht abgespielt werden. Teile ihn, um ihn in einer anderen App zu öffnen.",
      loadFailed: "Dieser Anhang konnte nicht geladen werden.",
      retry: "Zum Wiederholen tippen",
      decryptFailed: "Dieser Anhang konnte nicht entschlüsselt werden.",
      tooLarge: "Diese verschlüsselte Datei ist zu groß, um sie auf diesem Gerät zu öffnen.",
      save: "Auf dem Gerät speichern",
      share: "Teilen",
      saved: "In Fotos gespeichert.",
      saveDenied: "Erlaube Strafe in den Einstellungen, Fotos hinzuzufügen, um dies zu speichern.",
      shareUnavailable: "Teilen ist auf diesem Gerät nicht verfügbar.",
      cameraDenied: "Der Kamerazugriff ist aus. Schalte ihn in den Einstellungen ein, um Fotos und Videos aufzunehmen.",
      micDenied: "Der Mikrofonzugriff ist aus. Schalte ihn in den Einstellungen ein, um Sprachnachrichten aufzunehmen.",
      pickFailed: "Diese Datei konnte nicht hinzugefügt werden.",
    },

    // Start-up and connection state (src/platform/boot.ts).
    boot: {
      startFailed: "Strafe konnte nicht starten.",
      retry: "Erneut versuchen",
      offlineNotice: "Du bist offline. Angezeigt wird, was auf diesem Gerät ist.",
    },


    // The end-to-end encryption engine (src/platform/crypto).
    crypto: {
      engineUnavailableTitle: "Verschlüsselung ist nicht verfügbar",
      engineUnavailableBody: "Strafe konnte seine Verschlüsselung nicht starten, daher können verschlüsselte Unterhaltungen auf diesem Gerät weder gelesen noch gesendet werden. Starte die App neu, um es erneut zu versuchen.",
    },

    // Push notifications (src/platform/push): the native renderer's strings, then Settings -> Notifications.
    push: {
      appName: "Strafe",
      newMessage: "Neue Nachricht",
      encryptedMessage: "Verschlüsselte Nachricht",
      attachment: "Hat einen Anhang gesendet",
      spaceRoom: "#{{room}} · {{space}}",
      threadRoom: "{{thread}} · #{{room}}",
      incomingCall: "Eingehender Anruf",
      callFrom: "{{name}} ruft an",
      callFromIn: "{{name}} ruft in {{room}} an",
      markRead: "Als gelesen markieren",
      reply: "Antworten",
      answer: "Annehmen",
      decline: "Ablehnen",
      testTitle: "Push-Benachrichtigungen funktionieren",
      testBody: "Das kam von deiner Instanz, verschlüsselt bis auf dieses Gerät.",
      channelMessages: "Nachrichten",
      channelMessagesSilent: "Nachrichten (lautlos)",
      channelCalls: "Eingehende Anrufe",
      fallback: "Neue Benachrichtigung",
      title: "Push-Benachrichtigungen",
      toggle: "Benachrichtigen, wenn Strafe geschlossen ist",
      statusActive: "Aktiv · {{transport}}",
      statusRegistering: "Wird eingerichtet…",
      statusUnavailable: "Diese Version der App kann keine Push-Benachrichtigungen empfangen.",
      statusDisabled: "Aus. Du wirst nur benachrichtigt, während Strafe läuft.",
      statusSignedOut: "Melde dich an, um Push-Benachrichtigungen zu erhalten.",
      statusPermission: "Strafe darf keine Benachrichtigungen anzeigen. Erlaube sie in den Systemeinstellungen.",
      noTransport: "Kein Push-Dienst auf diesem Gerät: Diese Version hat kein Firebase und es ist kein UnifiedPush-Distributor installiert.",
      noTransportChoose: "Mehrere UnifiedPush-Distributoren sind installiert. Wähle unten einen aus.",
      noTransportFcm: "Firebase ist in dieser Version oder auf diesem Gerät nicht verfügbar.",
      noTransportMissing: "Der gewählte UnifiedPush-Distributor ist nicht mehr installiert.",
      errorTransport: "{{transport}} hat dieses Gerät nicht registriert ({{error}}).",
      errorGateway: "Das Push-Gateway war nicht erreichbar ({{error}}).",
      errorDistributor: "UnifiedPush hat dieses Gerät nicht registriert ({{error}}).",
      errorInstance: "Deine Instanz hat dieses Gerät abgelehnt ({{error}}).",
      errorUnsupported: "Deine Instanz sendet keine Push-Benachrichtigungen.",
      transportFcm: "Firebase Cloud Messaging",
      transportApns: "Apple Push Notification service",
      transportUnifiedPush: "UnifiedPush ({{distributor}})",
      transportDebug: "Entwicklungs-Gateway",
      transportTitle: "Push-Dienst",
      transportAuto: "Automatisch",
      transportAutoHint: "Firebase, wenn verfügbar, sonst dein UnifiedPush-Distributor.",
      transportFcmHint: "Zustellung über die Google Play-Dienste.",
      transportFcmUnavailable: "In dieser Version oder auf diesem Gerät nicht verfügbar.",
      transportDistributorHint: "UnifiedPush: selbst hostbar, ohne Google.",
      transportDebugHint: "Nur Entwicklungs-Builds: Das lokale Gateway hebt Pushes auf, die adb abspielt.",
      test: "Testbenachrichtigung senden",
      testHint: "Deine Instanz schickt eine an dieses Gerät.",
      testSent: "Testbenachrichtigung gesendet.",
      testFailed: "Die Testbenachrichtigung wurde nicht zugestellt ({{error}}).",
      testNotRegistered: "Deine Instanz kannte dieses Gerät noch nicht. Es wird neu registriert.",
      privacyNote: "Deine Instanz verschlüsselt Benachrichtigungen für dieses Gerät; Apple, Google, UnifiedPush und das Push-Gateway reichen nur Chiffretext weiter. In verschlüsselten Unterhaltungen sagt eine Benachrichtigung, wer wo geschrieben hat, nie was.",
    },
  },
};
