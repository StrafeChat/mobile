/**
 * Mobile replacement for web/src/i18n/index.ts: the same exports minus the two Solid
 * components it re-exports (AuthLanguageSwitcher, DocumentLangSync) and the Solid hook
 * useReactiveTranslate, none of which can load here. Stores import `../i18n` for `t()`;
 * this keeps that working.
 */
export { bindI18nReactivity, currentLanguage, formatDate, formatNumber, isRtl, setLanguage, t } from '@web/i18n/t';
export type { TranslateOptions } from '@web/i18n/t';
export {
  I18N_STORAGE_KEY,
  LOCALES,
  RTL_LOCALES,
  SUPPORTED_LOCALES,
  applyDocumentLangDir,
  getInitialLanguage,
  matchSupportedLocale,
  type LocaleCode,
} from '@web/i18n/config';

