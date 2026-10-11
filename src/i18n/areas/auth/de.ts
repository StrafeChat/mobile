/**
 * Mobile strings for the auth area (de), read as t('mobile.auth.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  sessionExpiredNotice: "Deine Sitzung ist abgelaufen. Melde dich erneut an.",

  // Welcome / instance
  welcomeTitle: "Willkommen bei Strafe",
  welcomeBody: "Chatte mit Freunden und Communities auf der Instanz deiner Wahl. Gib ihre Adresse ein, um loszulegen.",
  chooseInstanceTitle: "Wähle deine Instanz",
  chooseInstanceBody: "Die Adresse der Strafe-Instanz, auf der dein Konto liegt.",
  change: "Ändern",
  changeInstance: "Andere Instanz wählen",

  // Language
  restartTitle: "Neu starten, um das Layout zu wechseln",
  restartBody: "Strafe muss neu starten, um zwischen Rechts-nach-links- und Links-nach-rechts-Layout zu wechseln. Die neue Sprache ist bereits aktiv.",
  restartNow: "Jetzt neu starten",
  restartLater: "Später",

  // Sign in / second factor
  paste: "Einfügen",

  // Registration
  stepOf: "Schritt {{step}} von {{total}}",
  dobPlaceholder: "Geburtsdatum auswählen",
  usernameRules: "2–32 Buchstaben, Ziffern, „_“, „.“ oder „-“.",
  usernameInvalid: "Benutzernamen dürfen nur 2–32 Buchstaben, Ziffern, „_“, „.“ oder „-“ enthalten.",
  handlePreview: "Leute auf anderen Instanzen können dich als {{handle}} hinzufügen.",
  registered: "Dein Konto ist bereit. Melde dich an, um fortzufahren.",
  haveLink: "Ich habe den Link aus der E-Mail",

  // Email links
  linkLabel: "Link aus der E-Mail",
  linkPlaceholder: "https://…",
  linkHint: "Öffne die E-Mail, kopiere den Link und füge ihn hier ein.",
  linkInvalid: "Das sieht nicht nach dem Link aus der E-Mail aus. Kopiere den ganzen Link und versuche es noch einmal.",
  linkNoInstance: "Wähle zuerst deine Instanz und öffne den Link dann erneut.",
  linkOtherInstance: "Dieser Link gehört zu {{host}}. Melde dich ab, um ihn zu verwenden, oder öffne ihn im Browser.",
  verifyLinkTitle: "E-Mail-Adresse bestätigen",
  verifyLinkBody: "Füge den Link aus der Bestätigungs-E-Mail ein, um deine Adresse zu bestätigen.",
  verifyAction: "Bestätigen",
  tryAnotherLink: "Anderen Link versuchen",
  resetLinkBody: "Füge den Link aus der E-Mail zum Zurücksetzen ein, um ein neues Passwort zu wählen.",

  // Accounts on this device
  savedAccountsHint: "Tippe auf ein Konto, um fortzufahren, oder melde dich oben mit einem anderen an.",
  switcherHint: "Konten auf diesem Gerät. Beim Wechseln startet die App neu.",
  switchTo: "Zu diesem Konto wechseln",
  activeAccount: "Aktuelles Konto",
  signOutConfirm: "Du wirst auf diesem Gerät von diesem Konto abgemeldet. Andere Konten bleiben angemeldet.",
};
