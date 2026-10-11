/**
 * Behaviour - the web's "System & Keybinds" page without the keybinds, which have no meaning
 * on a touch screen: reopening the last conversation when the app starts, and spellcheck /
 * autocorrect in the composer (the composer reads `settings.spellcheck`).
 */
import { t } from '@web/i18n/t';
import { setRestoreLastVisited, setSpellcheck } from '@web/stores/settings';
import { useSettings } from '@/data';
import { ListSection } from '@/ui';
import { Note, SettingToggle } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';

export function BehaviourScreen() {
  useLocale();
  const settings = useSettings();
  return (
    <SettingsScreen title={t('mobile.settings.behaviourTitle')} testID="settings-behaviour">
      <ListSection>
        <SettingToggle
          icon="clock-rotate-left"
          title={t('mobile.settings.restoreLast')}
          description={t('settings.keybinds.restoreLastHint')}
          value={settings.restoreLastVisited}
          onValueChange={setRestoreLastVisited}
          testID="behaviour-restore"
        />
        <SettingToggle
          icon="spell-check"
          title={t('settings.keybinds.spellcheck')}
          description={t('mobile.settings.spellcheckHint')}
          value={settings.spellcheck}
          onValueChange={setSpellcheck}
          testID="behaviour-spellcheck"
        />
      </ListSection>
      <Note>{t('mobile.settings.keybindsWebOnly')}</Note>
    </SettingsScreen>
  );
}
