/**
 * Mobile strings for the auth area (en), read as t('mobile.auth.<key>'). All six locale files of
 * an area define the same keys (npm run check:i18n); Arabic plurals use _zero/_one/_two/
 * _few/_many/_other where the others use _one/_other.
 */
export default {
  sessionExpiredNotice: "Your session expired. Sign in again.",

  // Welcome / instance
  welcomeTitle: "Welcome to Strafe",
  welcomeBody: "Chat with friends and communities on the instance of your choice. Enter its address to begin.",
  chooseInstanceTitle: "Choose your instance",
  chooseInstanceBody: "The address of the Strafe instance your account lives on.",
  change: "Change",
  changeInstance: "Choose a different instance",

  // Language
  restartTitle: "Restart to switch layout",
  restartBody: "Strafe needs to restart to switch between right-to-left and left-to-right layout. The new language is already in use.",
  restartNow: "Restart now",
  restartLater: "Later",

  // Sign in / second factor
  paste: "Paste",

  // Registration
  stepOf: "Step {{step}} of {{total}}",
  dobPlaceholder: "Select your date of birth",
  usernameRules: "2–32 letters, numbers, “_”, “.” or “-”.",
  usernameInvalid: "Usernames can only use 2–32 letters, numbers, “_”, “.” or “-”.",
  handlePreview: "People on other instances can add you as {{handle}}.",
  registered: "Your account is ready. Sign in to continue.",
  haveLink: "I have the link from the email",

  // Email links
  linkLabel: "Link from the email",
  linkPlaceholder: "https://…",
  linkHint: "Open the email, copy the link, and paste it here.",
  linkInvalid: "That doesn't look like the link from the email. Copy the whole link and try again.",
  linkNoInstance: "Choose your instance first, then open the link again.",
  linkOtherInstance: "This link is for {{host}}. Sign out to use it, or open it in your browser.",
  verifyLinkTitle: "Verify your email",
  verifyLinkBody: "Paste the link from the verification email to confirm your address.",
  verifyAction: "Verify",
  tryAnotherLink: "Try another link",
  resetLinkBody: "Paste the link from the password reset email to choose a new password.",

  // Accounts on this device
  savedAccountsHint: "Tap one to continue, or sign in to another account above.",
  switcherHint: "Accounts on this device. Switching restarts the app.",
  switchTo: "Switch to this account",
  activeAccount: "Current account",
  signOutConfirm: "You will be signed out of this account on this device. Other accounts stay signed in.",
};
