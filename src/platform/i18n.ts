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
import auth_en from '@/i18n/areas/auth/en';
import auth_es from '@/i18n/areas/auth/es';
import auth_ptBR from '@/i18n/areas/auth/pt-BR';
import auth_fr from '@/i18n/areas/auth/fr';
import auth_de from '@/i18n/areas/auth/de';
import auth_ar from '@/i18n/areas/auth/ar';
import nav_en from '@/i18n/areas/nav/en';
import nav_es from '@/i18n/areas/nav/es';
import nav_ptBR from '@/i18n/areas/nav/pt-BR';
import nav_fr from '@/i18n/areas/nav/fr';
import nav_de from '@/i18n/areas/nav/de';
import nav_ar from '@/i18n/areas/nav/ar';
import chat_en from '@/i18n/areas/chat/en';
import chat_es from '@/i18n/areas/chat/es';
import chat_ptBR from '@/i18n/areas/chat/pt-BR';
import chat_fr from '@/i18n/areas/chat/fr';
import chat_de from '@/i18n/areas/chat/de';
import chat_ar from '@/i18n/areas/chat/ar';
import composer_en from '@/i18n/areas/composer/en';
import composer_es from '@/i18n/areas/composer/es';
import composer_ptBR from '@/i18n/areas/composer/pt-BR';
import composer_fr from '@/i18n/areas/composer/fr';
import composer_de from '@/i18n/areas/composer/de';
import composer_ar from '@/i18n/areas/composer/ar';
import room_en from '@/i18n/areas/room/en';
import room_es from '@/i18n/areas/room/es';
import room_ptBR from '@/i18n/areas/room/pt-BR';
import room_fr from '@/i18n/areas/room/fr';
import room_de from '@/i18n/areas/room/de';
import room_ar from '@/i18n/areas/room/ar';
import settings_en from '@/i18n/areas/settings/en';
import settings_es from '@/i18n/areas/settings/es';
import settings_ptBR from '@/i18n/areas/settings/pt-BR';
import settings_fr from '@/i18n/areas/settings/fr';
import settings_de from '@/i18n/areas/settings/de';
import settings_ar from '@/i18n/areas/settings/ar';
import voice_en from '@/i18n/areas/voice/en';
import voice_es from '@/i18n/areas/voice/es';
import voice_ptBR from '@/i18n/areas/voice/pt-BR';
import voice_fr from '@/i18n/areas/voice/fr';
import voice_de from '@/i18n/areas/voice/de';
import voice_ar from '@/i18n/areas/voice/ar';
import { RTL_LOCALES, getInitialLanguage } from '@web/i18n/config';
import { bindI18nReactivity } from '@web/i18n/t';

type Tree = { [key: string]: string | Tree };

/**
 * The web's strings plus the mobile-only ones. A deep merge: the web locales already have a
 * `mobile` block (its mobile layout's tab bar and You panel), and the app's own `mobile.*`
 * keys must add to it, not replace it.
 */
function merge(base: Tree, extra: Tree): Tree {
  const out: Tree = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    const b = out[k];
    out[k] = typeof v === 'object' && typeof b === 'object' ? merge(b, v) : v;
  }
  return out;
}

const AREAS: Record<string, Record<string, Tree>> = {
  'en': { auth: auth_en as Tree, nav: nav_en as Tree, chat: chat_en as Tree, composer: composer_en as Tree, room: room_en as Tree, settings: settings_en as Tree, voice: voice_en as Tree },
  'es': { auth: auth_es as Tree, nav: nav_es as Tree, chat: chat_es as Tree, composer: composer_es as Tree, room: room_es as Tree, settings: settings_es as Tree, voice: voice_es as Tree },
  'pt-BR': { auth: auth_ptBR as Tree, nav: nav_ptBR as Tree, chat: chat_ptBR as Tree, composer: composer_ptBR as Tree, room: room_ptBR as Tree, settings: settings_ptBR as Tree, voice: voice_ptBR as Tree },
  'fr': { auth: auth_fr as Tree, nav: nav_fr as Tree, chat: chat_fr as Tree, composer: composer_fr as Tree, room: room_fr as Tree, settings: settings_fr as Tree, voice: voice_fr as Tree },
  'de': { auth: auth_de as Tree, nav: nav_de as Tree, chat: chat_de as Tree, composer: composer_de as Tree, room: room_de as Tree, settings: settings_de as Tree, voice: voice_de as Tree },
  'ar': { auth: auth_ar as Tree, nav: nav_ar as Tree, chat: chat_ar as Tree, composer: composer_ar as Tree, room: room_ar as Tree, settings: settings_ar as Tree, voice: voice_ar as Tree },
};

/** One locale: the web's strings, the shared mobile file, then each feature area's own file. */
function locale(web: unknown, shared: unknown, lang: string): Tree {
  return merge(merge(web as Tree, shared as Tree), { mobile: AREAS[lang] as Tree });
}

const resources = {
  en: { translation: locale(en, mEn, 'en') },
  es: { translation: locale(es, mEs, 'es') },
  'pt-BR': { translation: locale(ptBR, mPtBR, 'pt-BR') },
  fr: { translation: locale(fr, mFr, 'fr') },
  de: { translation: locale(de, mDe, 'de') },
  ar: { translation: locale(ar, mAr, 'ar') },
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
