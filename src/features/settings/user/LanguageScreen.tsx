/**
 * Language (LanguageSettingsPage): the six UI languages, applied at once and remembered on
 * this device. React Native lays out right-to-left only from launch, so switching to or from
 * Arabic offers a restart to flip the layout direction.
 *
 * Mobile extra: "Use device language" picks the supported language closest to the phone's.
 */
import { I18nManager, View } from 'react-native';
import { getLocales } from 'expo-localization';
import { LOCALES, RTL_LOCALES, matchSupportedLocale } from '@web/i18n/config';
import { currentLanguage, setLanguage, t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { reloadApp } from '@/platform/reload';
import { ListSection, Text, showDialog } from '@/ui';
import { SettingItem, choiceRows } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';

/** Whether showing `code` needs the other layout direction than the app launched with. */
export function needsDirectionRestart(code: string, launchedRtl: boolean = I18nManager.isRTL): boolean {
  return RTL_LOCALES.has(code) !== launchedRtl;
}

/** The supported language closest to the device's preferred ones. */
export function deviceLanguage(): string | null {
  try {
    for (const l of getLocales()) {
      const match = matchSupportedLocale(l.languageTag);
      if (match) return match;
    }
  } catch {
    /* no locale info */
  }
  return null;
}

async function choose(code: string): Promise<void> {
  if (code === currentLanguage()) return;
  await setLanguage(code);
  if (!needsDirectionRestart(code)) return;
  const restart = await showDialog({
    title: t('mobile.settings.restartTitle'),
    body: t('mobile.settings.restartBody'),
    icon: 'rotate',
    actions: [
      { label: t('mobile.settings.restartLater'), value: false, variant: 'secondary' },
      { label: t('mobile.settings.restartNow'), value: true, variant: 'primary' },
    ],
  });
  if (restart) await reloadApp('strafe: layout direction changed');
}

export function LanguageScreen() {
  useLocale();
  const active = useSolid(() => currentLanguage());
  const device = deviceLanguage();
  const deviceLabel = device ? LOCALES.find((l) => l.code === device)?.label : undefined;

  return (
    <SettingsScreen title={t('settings.sections.language.title')} testID="settings-language">
      <Text variant="caption" style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        {t('settings.language.pickHint')}
      </Text>
      {device && deviceLabel && device !== active ? (
        <ListSection>
          <SettingItem icon="mobile-screen" title={t('mobile.settings.useDeviceLanguage')} value={deviceLabel} onPress={() => void choose(device)} />
        </ListSection>
      ) : null}
      <ListSection title={t('settings.language.pickTitle')}>
        {choiceRows<string>({
          value: active,
          onChange: (code) => void choose(code),
          testIDPrefix: 'language',
          options: LOCALES.map((l) => ({
            value: l.code,
            title: l.label,
            description: l.englishLabel !== l.label ? l.englishLabel : undefined,
            leading: (
              <View style={{ width: 32, alignItems: 'center' }}>
                <Text style={{ fontSize: 22 }} accessibilityElementsHidden importantForAccessibility="no">
                  {l.flag}
                </Text>
              </View>
            ),
          })),
        })}
      </ListSection>
      <ListSection title={t('settings.language.aboutTitle')}>
        <View style={{ padding: 16, gap: 8 }}>
          <Text variant="caption">{t('settings.language.perDevice')}</Text>
          <Text variant="caption">{t('mobile.settings.rtlNote')}</Text>
          <Text variant="caption">{t('settings.language.contentNote')}</Text>
        </View>
      </ListSection>
    </SettingsScreen>
  );
}
