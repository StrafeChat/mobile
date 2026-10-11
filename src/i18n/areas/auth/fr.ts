/**
 * Mobile strings for the auth area (fr), read as t('mobile.auth.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  sessionExpiredNotice: "Votre session a expiré. Reconnectez-vous.",

  // Welcome / instance
  welcomeTitle: "Bienvenue sur Strafe",
  welcomeBody: "Discutez avec vos amis et vos communautés sur l’instance de votre choix. Saisissez son adresse pour commencer.",
  chooseInstanceTitle: "Choisissez votre instance",
  chooseInstanceBody: "L’adresse de l’instance Strafe où se trouve votre compte.",
  change: "Modifier",
  changeInstance: "Choisir une autre instance",

  // Language
  restartTitle: "Redémarrer pour changer la mise en page",
  restartBody: "Strafe doit redémarrer pour passer d’une mise en page de droite à gauche à une mise en page de gauche à droite, ou inversement. La nouvelle langue est déjà active.",
  restartNow: "Redémarrer maintenant",
  restartLater: "Plus tard",

  // Sign in / second factor
  paste: "Coller",

  // Registration
  stepOf: "Étape {{step}} sur {{total}}",
  dobPlaceholder: "Sélectionnez votre date de naissance",
  usernameRules: "De 2 à 32 lettres, chiffres, « _ », « . » ou « - ».",
  usernameInvalid: "Les noms d’utilisateur ne peuvent contenir que de 2 à 32 lettres, chiffres, « _ », « . » ou « - ».",
  handlePreview: "Les personnes d’autres instances peuvent vous ajouter avec {{handle}}.",
  registered: "Votre compte est prêt. Connectez-vous pour continuer.",
  haveLink: "J’ai le lien de l’e-mail",

  // Email links
  linkLabel: "Lien de l’e-mail",
  linkPlaceholder: "https://…",
  linkHint: "Ouvrez l’e-mail, copiez le lien et collez-le ici.",
  linkInvalid: "Cela ne ressemble pas au lien de l’e-mail. Copiez le lien en entier et réessayez.",
  linkNoInstance: "Choisissez d’abord votre instance, puis rouvrez le lien.",
  linkOtherInstance: "Ce lien concerne {{host}}. Déconnectez-vous pour l’utiliser, ou ouvrez-le dans votre navigateur.",
  verifyLinkTitle: "Vérifiez votre e-mail",
  verifyLinkBody: "Collez le lien de l’e-mail de vérification pour confirmer votre adresse.",
  verifyAction: "Vérifier",
  tryAnotherLink: "Essayer un autre lien",
  resetLinkBody: "Collez le lien de l’e-mail de réinitialisation pour choisir un nouveau mot de passe.",

  // Accounts on this device
  savedAccountsHint: "Touchez-en un pour continuer, ou connectez-vous à un autre compte ci-dessus.",
  switcherHint: "Comptes sur cet appareil. Changer de compte redémarre l’application.",
  switchTo: "Passer à ce compte",
  activeAccount: "Compte actuel",
  signOutConfirm: "Vous serez déconnecté de ce compte sur cet appareil. Les autres comptes restent connectés.",
};
