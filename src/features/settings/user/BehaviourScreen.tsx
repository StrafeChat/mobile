/**
 * Behaviour - the web's "System & Keybinds" page without the keybinds, which have no meaning
 * on a touch screen: reopening the last conversation when the app starts, spellcheck /
 * autocorrect in the composer (the composer reads `settings.spellcheck`), and the mobile-only
 * swipe-to-reply gesture (off by default: a leftward swipe opens the member list).
 */
import { t } from '@web/i18n/t';
import { setRestoreLastVisited, setSpellcheck } from '@web/stores/settings';
import { useSolid } from '@/bridge/solid';
import { useSettings } from '@/data';
import { setSwipeToReplyEnabled, swipeToReplyEnabled } from '@/features/chat/preferences';
import { ListSection } from '@/ui';
import { Note, SettingToggle } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';

export function BehaviourScreen() {
  useLocale();
  const settings = useSettings();
  const swipeReply = useSolid(() => swipeToReplyEnabled());
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
        <SettingToggle
          icon="reply"
          title={t('mobile.settings.swipeReply')}
          description={t('mobile.settings.swipeReplyHint')}
          value={swipeReply}
          onValueChange={setSwipeToReplyEnabled}
          testID="behaviour-swipe-reply"
        />
      </ListSection>
      <Note>{t('mobile.settings.keybindsWebOnly')}</Note>
    </SettingsScreen>
  );
}
