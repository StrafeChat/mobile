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

    // Push notifications (src/platform/push): the native renderer's strings, then Settings -> Notifications.
    push: {
      appName: "Strafe",
      newMessage: "Nouveau message",
      encryptedMessage: "Message chiffré",
      attachment: "A envoyé une pièce jointe",
      spaceRoom: "#{{room}} · {{space}}",
      threadRoom: "{{thread}} · #{{room}}",
      incomingCall: "Appel entrant",
      callFrom: "{{name}} vous appelle",
      callFromIn: "{{name}} appelle dans {{room}}",
      markRead: "Marquer comme lu",
      reply: "Répondre",
      answer: "Répondre",
      decline: "Refuser",
      testTitle: "Les notifications push fonctionnent",
      testBody: "Ceci vient de votre instance, chiffré jusqu’à cet appareil.",
      channelMessages: "Messages",
      channelMessagesSilent: "Messages (silencieux)",
      channelCalls: "Appels entrants",
      fallback: "Nouvelle notification",
      title: "Notifications push",
      toggle: "Me notifier quand Strafe est fermé",
      statusActive: "Actives · {{transport}}",
      statusRegistering: "Configuration…",
      statusUnavailable: "Cette version de l’app ne peut pas recevoir de notifications push.",
      statusDisabled: "Désactivées. Vous n’êtes notifié que lorsque Strafe est ouvert.",
      statusSignedOut: "Connectez-vous pour recevoir des notifications push.",
      statusPermission: "Strafe n’est pas autorisé à afficher des notifications. Autorisez-les dans les réglages du système.",
      noTransport: "Aucun service push sur cet appareil : cette version n’inclut pas Firebase et aucun distributeur UnifiedPush n’est installé.",
      noTransportChoose: "Plusieurs distributeurs UnifiedPush sont installés. Choisissez-en un ci-dessous.",
      noTransportFcm: "Firebase n’est pas disponible dans cette version ou sur cet appareil.",
      noTransportMissing: "Le distributeur UnifiedPush choisi n’est plus installé.",
      errorTransport: "{{transport}} n’a pas enregistré cet appareil ({{error}}).",
      errorGateway: "Impossible de joindre la passerelle push ({{error}}).",
      errorDistributor: "UnifiedPush n’a pas enregistré cet appareil ({{error}}).",
      errorInstance: "Votre instance a refusé cet appareil ({{error}}).",
      errorUnsupported: "Votre instance n’envoie pas de notifications push.",
      transportFcm: "Firebase Cloud Messaging",
      transportApns: "Apple Push Notification service",
      transportUnifiedPush: "UnifiedPush ({{distributor}})",
      transportDebug: "Passerelle de développement",
      transportTitle: "Service push",
      transportAuto: "Automatique",
      transportAutoHint: "Firebase s’il est disponible, sinon votre distributeur UnifiedPush.",
      transportFcmHint: "Distribuées via les services Google Play.",
      transportFcmUnavailable: "Indisponible dans cette version ou sur cet appareil.",
      transportDistributorHint: "UnifiedPush : auto-hébergeable, sans Google.",
      transportDebugHint: "Versions de développement uniquement : la passerelle locale garde les push pour qu’adb les rejoue.",
      test: "Envoyer une notification de test",
      testHint: "Votre instance en envoie une à cet appareil.",
      testSent: "Notification de test envoyée.",
      testFailed: "La notification de test n’a pas été distribuée ({{error}}).",
      testNotRegistered: "Votre instance ne connaissait pas encore cet appareil. Nouvel enregistrement en cours.",
      privacyNote: "Votre instance chiffre les notifications pour cet appareil ; Apple, Google, UnifiedPush et la passerelle push ne transmettent que du texte chiffré. Dans les conversations chiffrées, une notification indique qui a écrit et où, jamais quoi.",
    },
  },
};
