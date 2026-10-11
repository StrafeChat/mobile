/**
 * The language switcher of the auth screens (the web's AuthLanguageSwitcher): the current
 * language's flag and name; a tap opens the six languages in a sheet, each in its own name
 * with the English name under it, the current one checked.
 *
 * Choosing calls the shared setLanguage() (i18next + the stored choice). React Native lays
 * out right-to-left only from launch, so moving into or out of Arabic offers a restart; the
 * text itself changes at once either way.
 */
import { I18nManager } from 'react-native';
import { LOCALES, RTL_LOCALES } from '@web/i18n/config';
import { currentLanguage, setLanguage, t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { reloadApp } from '@/platform/reload';
import { useTheme } from '@/theme';
import { Icon, Text, Touchable, haptics, hitSlopFor, showActionSheet, showDialog } from '@/ui';

/** Whether switching to `code` changes the layout direction the app was started with. */
export function needsDirectionRestart(code: string, startedRtl: boolean = I18nManager.isRTL): boolean {
  return RTL_LOCALES.has(code) !== startedRtl;
}

export async function changeLanguage(code: string): Promise<void> {
  if (code === currentLanguage()) return;
  const restart = needsDirectionRestart(code);
  await setLanguage(code);
  if (!restart) return;
  const now = await showDialog<boolean>({
    title: t('mobile.auth.restartTitle'),
    body: t('mobile.auth.restartBody'),
    icon: 'language',
    actions: [
      { label: t('mobile.auth.restartLater'), value: false, variant: 'ghost' },
      { label: t('mobile.auth.restartNow'), value: true, variant: 'primary' },
    ],
  });
  if (now) await reloadApp('strafe: layout direction changed');
}

export function openLanguagePicker(): void {
  haptics.selection();
  const current = currentLanguage();
  void showActionSheet(
    LOCALES.map((l) => ({
      key: l.code,
      label: l.label,
      description: l.englishLabel !== l.label ? l.englishLabel : undefined,
      leading: <Text style={{ fontSize: 22 }}>{l.flag}</Text>,
      selected: l.code === current,
      testID: `language-${l.code}`,
      onSelect: () => changeLanguage(l.code),
    })),
    { title: t('auth.language') },
  );
}

export function LanguageButton() {
  const theme = useTheme();
  const code = useSolid(() => currentLanguage());
  const locale = LOCALES.find((l) => l.code === code) ?? LOCALES[0];
  return (
    <Touchable
      onPress={openLanguagePicker}
      feedback="opacity"
      hitSlop={hitSlopFor(0, 36)}
      accessibilityRole="button"
      accessibilityLabel={`${t('auth.language')}: ${locale.label}`}
      testID="auth-language"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        minHeight: 36,
        paddingHorizontal: 12,
        borderRadius: theme.radii.full,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.card,
      }}
    >
      <Text style={{ fontSize: 16 }} accessible={false}>
        {locale.flag}
      </Text>
      <Text variant="label" numberOfLines={1} maxFontSizeMultiplier={1.4}>
        {locale.label}
      </Text>
      <Icon name="chevron-down" size={10} tone="muted" />
    </Touchable>
  );
}
