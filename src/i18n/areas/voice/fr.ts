/**
 * Mobile strings for the voice area (fr), read as t('mobile.voice.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  minimize: "Réduire l'appel",
  openCall: "Ouvrir l'appel",
  openCallHint: "Ouvre l'écran de l'appel",
  openChat: 'Ouvrir la conversation',
  speaking: 'Parle',
  tileHint: 'Met cette personne en avant. Appui long pour plus d’options.',
  flipCamera: 'Changer de caméra',
  audioOutput: 'Sortie audio',
  route: {
    auto: 'Automatique',
    autoHint: 'Bluetooth, puis écouteurs, puis haut-parleur',
    earpiece: 'Téléphone',
    headset: 'Écouteurs',
    bluetooth: 'Bluetooth',
  },
  holdToTalk: 'Maintenir pour parler',
  holdToTalkHint: 'Le mode appuyer pour parler est activé. Maintenez le bouton pendant que vous parlez.',
  talking: 'Vous parlez…',
  sharingScreen: 'Vous partagez votre écran',
  noiseOn: 'Activée, traitée sur cet appareil',
  enableAudio: "Le son de l'appel est en pause.",
  enablePlayback: "Le son et la vidéo de l'appel sont en pause.",
  enableAction: 'Reprendre',
  switchTitle: "Changer d'appel ?",
  switchBody: 'Vous êtes connecté à {{room}}. Rejoindre ici vous en déconnecte.',
  switchConfirm: 'Changer',
  disconnectTitle: 'Déconnecter {{name}} ?',
  disconnectBody: 'Cette personne sera retirée de ce salon vocal. Elle pourra revenir ensuite.',
  actionFailed: "Ça n'a pas fonctionné. Réessayez.",
  viewProfile: 'Voir le profil',
  callInProgress: 'Appel en cours',
  inThisCall: 'Vous êtes dans cet appel',
  micOffJoin: "L'accès au micro est désactivé, personne ne vous entendra. Activez-le dans les Réglages pour parler.",
  cameraOffJoin: "L'accès à la caméra est désactivé, vous rejoindrez sans vidéo. Activez-le dans les Réglages pour partager votre vidéo.",
  errors: {
    e2eeUnsupported:
      'Cet appareil ne peut pas chiffrer les appels, il ne peut donc pas rejoindre. Les appels sont chiffrés de bout en bout et ne sont jamais envoyés en clair.',
    micDenied: "L'accès au micro a été refusé. Activez-le dans les Réglages pour parler.",
    cameraDenied: "L'accès à la caméra a été refusé. Activez-le dans les Réglages pour partager votre vidéo.",
  },
};
