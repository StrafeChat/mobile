/**
 * Mobile strings for the room area (fr), read as t('mobile.room.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  continueInBackground: 'Continuer en arrière-plan',
  findPeople: 'Trouver des personnes',
  friends: 'Amis',
  groupDetails: 'Détails du groupe',
  has: {
    link: 'Liens',
    image: 'Images',
    video: 'Vidéos',
    audio: 'Audio',
    file: 'Fichiers',
  },
  importingBackup: 'Importation de votre ancienne sauvegarde…',
  jumpHint: 'Ouvre la conversation à ce message',
  jumpToMessage: 'Aller au message',
  keysPendingTitle: 'Certains messages sont encore verrouillés',
  keysPendingBody:
    'Ils attendent leurs clés de chiffrement. Ils se déverrouillent d’eux-mêmes quand un autre de vos appareils partage les clés, ou quand vous restaurez votre sauvegarde avec le code de récupération.',
  leaveGroupBody: 'Vous ne recevrez plus les messages de {{name}}. Quelqu’un du groupe devra vous rajouter.',
  messageFailed: 'Impossible d’ouvrir la conversation.',
  mutualSpaces_one: '{{count}} espace en commun',
  mutualSpaces_other: '{{count}} espaces en commun',
  noMembersMatch: 'Personne ne correspond à ce nom.',
  nothingOpenTitle: 'Aucune conversation ouverte',
  nothingOpenBody: 'Choisissez un salon ou un message privé pour commencer à discuter.',
  notifications: 'Notifications',
  openCall: 'Ouvrir l’appel',
  openRooms: 'Afficher les salons',
  removeFriendBody: '{{name}} sera retiré de vos amis.',
  removeMemberBody: '{{name}} ne recevra plus les nouveaux messages de ce groupe.',
  requestSent: 'Demande envoyée',
  restoringMessages: 'Restauration de vos messages…',
  roomSettings: 'Paramètres du salon',
  safetyRowHint: 'Comparez les codes de sécurité pour vous assurer que personne d’autre n’écoute.',
  saveCode: 'Enregistrer',
  saved: 'Enregistré',
  searchIn: 'Rechercher dans {{name}}',
  showArchived: 'Affiche les fils archivés',
  undo: 'Annuler',
  unpinned: 'Message désépinglé',
};
