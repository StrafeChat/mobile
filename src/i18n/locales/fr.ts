/**
 * Mobile-only strings (fr). Everything the web client already says comes from its own locale
 * files (web/src/i18n/locales); this file holds only what exists on mobile alone, under the
 * `mobile.` prefix. Keep all six files in step (npm run check:i18n).
 */
export default {
  mobile: {
    // Design system (src/ui).
    ui: {
      choose: 'Choisir…',
      dismiss: 'Ignorer',
      showPassword: 'Afficher le mot de passe',
      hidePassword: 'Masquer le mot de passe',
      required: 'obligatoire',
      charactersLeft_one: '{{count}} caractère restant',
      charactersLeft_other: '{{count}} caractères restants',
      showActions: 'Afficher les actions',
      moreOptions: 'Plus d’options',
      opensSubmenu: 'Ouvre plus d’options',
    },

    // Browser-bound web modules swapped on mobile (src/platform/overrides).
    webOverrides: {
      passkeyUnavailable: "Les clés d'accès ne sont pas encore disponibles dans l'application mobile. Utilisez votre application d'authentification ou un code de récupération.",
    },

    // Attachments, media and voice messages (src/platform/media).
    media: {
      unsupportedIos: "Ce clip ne peut pas être lu sur iPhone ou iPad. Partagez-le pour l'ouvrir dans une autre application.",
      loadFailed: "Impossible de charger cette pièce jointe.",
      retry: "Touchez pour réessayer",
      decryptFailed: "Cette pièce jointe n'a pas pu être déchiffrée.",
      tooLarge: "Ce fichier chiffré est trop volumineux pour être ouvert sur cet appareil.",
      save: "Enregistrer sur l'appareil",
      share: "Partager",
      saved: "Enregistré dans Photos.",
      saveDenied: "Autorisez Strafe à ajouter des photos dans les Réglages pour enregistrer ceci.",
      shareUnavailable: "Le partage n'est pas disponible sur cet appareil.",
      cameraDenied: "L'accès à l'appareil photo est désactivé. Activez-le dans les Réglages pour prendre des photos et des vidéos.",
      micDenied: "L'accès au micro est désactivé. Activez-le dans les Réglages pour enregistrer des messages vocaux.",
      pickFailed: "Impossible d'ajouter ce fichier.",
    },

    // Start-up and connection state (src/platform/boot.ts).
    boot: {
      startFailed: "Strafe n'a pas pu démarrer.",
      retry: "Réessayer",
      offlineNotice: "Vous êtes hors ligne. Affichage de ce qui se trouve sur cet appareil.",
    },


    // The end-to-end encryption engine (src/platform/crypto).
    crypto: {
      engineUnavailableTitle: "Le chiffrement n'est pas disponible",
      engineUnavailableBody: "Strafe n'a pas pu démarrer son moteur de chiffrement : les conversations chiffrées ne peuvent être ni lues ni envoyées depuis cet appareil. Redémarrez l'application pour réessayer.",
    },
  },
};
