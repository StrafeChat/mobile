/**
 * Translations: the web client's i18next setup and its six locale files, unchanged.
 *
 * The web wires i18next up in src/index.tsx through a Solid provider; here it is initialised
 * directly, synchronously (the resources are bundled), before anything renders - the shared
 * stores call `t()` at module load for default names and the like.
 */
import i18next from 'i18next';
import { I18nManager } from 'react-native';
import en from '@web/i18n/locales/en';
import es from '@web/i18n/locales/es';
import ptBR from '@web/i18n/locales/pt-BR';
import fr from '@web/i18n/locales/fr';
import de from '@web/i18n/locales/de';
import ar from '@web/i18n/locales/ar';
import mEn from '@/i18n/locales/en';
import mEs from '@/i18n/locales/es';
import mPtBR from '@/i18n/locales/pt-BR';
import mFr from '@/i18n/locales/fr';
import mDe from '@/i18n/locales/de';
import mAr from '@/i18n/locales/ar';
import { RTL_LOCALES, getInitialLanguage } from '@web/i18n/config';
import { bindI18nReactivity } from '@web/i18n/t';

// The web's strings plus the mobile-only ones (all under `mobile.`, so nothing collides).
const resources = {
  en: { translation: { ...en, ...mEn } },
  es: { translation: { ...es, ...mEs } },
  'pt-BR': { translation: { ...ptBR, ...mPtBR } },
  fr: { translation: { ...fr, ...mFr } },
  de: { translation: { ...de, ...mDe } },
  ar: { translation: { ...ar, ...mAr } },
};

const initialLng = getInitialLanguage();
bindI18nReactivity();

void i18next.init({
  resources,
  lng: initialLng,
  fallbackLng: 'en',
  supportedLngs: Object.keys(resources),
  interpolation: { escapeValue: false },
  initAsync: false,
  returnNull: false,
});

/**
 * React Native lays out right-to-left only from launch, so a change of direction (switching
 * to or from Arabic) is applied here and takes effect after the app restarts; the language
 * settings page offers that restart.
 */
export function syncLayoutDirection(lng: string): boolean {
  const rtl = RTL_LOCALES.has(lng);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  return true;
}

syncLayoutDirection(initialLng);

i18next.on('languageChanged', (lng) => {
  syncLayoutDirection(lng);
});

export { i18next };
