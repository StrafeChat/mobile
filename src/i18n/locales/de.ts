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

    // Sign-in and accounts (src/features/auth).
    auth: {
      sessionExpiredNotice: "Deine Sitzung ist abgelaufen. Melde dich erneut an.",
    },

    // The end-to-end encryption engine (src/platform/crypto).
    crypto: {
      engineUnavailableTitle: "Verschlüsselung ist nicht verfügbar",
      engineUnavailableBody: "Strafe konnte seine Verschlüsselung nicht starten, daher können verschlüsselte Unterhaltungen auf diesem Gerät weder gelesen noch gesendet werden. Starte die App neu, um es erneut zu versuchen.",
    },
  },
};
