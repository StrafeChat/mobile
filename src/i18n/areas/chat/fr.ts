/**
 * Textes mobiles de la zone de discussion (fr), lus via t('mobile.chat.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  listLabel: 'Messages',
  messageHint: 'Appui long pour les actions, balayez vers la gauche pour répondre',
  openProfile: 'Ouvre son profil',
  jumpToUnread: 'Aller au premier message non lu',
  emojiUnavailable: 'Cet emoji n\'est plus disponible',
  videoUnplayable: 'Cette vidéo ne peut pas être lue sur cet appareil.',
  audioUnplayable: 'Ce fichier ne peut pas être lu sur cet appareil. Partagez-le pour l\'ouvrir dans une autre app.',
  fileOpenHint: 'Ouvre le menu de partage pour ouvrir ou enregistrer le fichier',
  link: {
    open: 'Ouvrir le lien',
    copy: 'Copier le lien',
  },
  reactions: {
    title: 'Réactions',
    none: 'Personne à afficher.',
  },
};
