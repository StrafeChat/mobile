/**
 * The auth area: choosing an instance, signing in (with the second factor), creating an
 * account (with the instance's captcha), email verification, password reset, the session
 * notices, the language switcher, and the account switcher for the You panel.
 *
 * Routes: src/app/(auth)/{instance,sign-in,register,verify-email,forgot-password,
 * reset-password}.tsx render the screens below.
 */
export { InstanceScreen } from './screens/InstanceScreen';
export { SignInScreen } from './screens/SignInScreen';
export { RegisterScreen } from './screens/RegisterScreen';
export { VerifyEmailScreen } from './screens/VerifyEmailScreen';
export { ForgotPasswordScreen } from './screens/ForgotPasswordScreen';
export { ResetPasswordScreen } from './screens/ResetPasswordScreen';

export {
  AccountSwitcherSheet,
  openAccountSwitcher,
  closeAccountSwitcher,
  showAccountSwitcherActionSheet,
  SavedAccountsList,
  useSavedAccounts,
  confirmSignOut,
  confirmRemoveAccount,
  type AccountRowView,
  type AccountSwitcherSheetProps,
} from './accounts';
export { AuthHosts } from './AuthHosts';
export { LanguageButton, openLanguagePicker, changeLanguage } from './components/LanguageButton';
export { CaptchaWebView, type CaptchaWebViewProps } from './captcha/CaptchaWebView';
export { parseAuthLink, type AuthLink, type AuthLinkKind } from './logic/authLinks';
export { AUTH_PATHS, useLaunchAuthLink } from './nav';
