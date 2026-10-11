/**
 * Notifications (NotificationsSettingsPage), for a phone: system notifications (the OS
 * permission, with a way to the system settings once it is refused), message preview, the
 * open-conversation rule, sound and haptics, what to be notified for in spaces and PMs, and
 * a test notification. Per device, in the web's `strafe_notifications` store, so the shared
 * notification logic reads the same keys.
 *
 * The chime is the system notification sound (see the notificationPrefs override), so the
 * web's volume slider has no counterpart; only "on" matters here.
 */
import { useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import { t } from '@web/i18n/t';
import {
  desktopPermission,
  notificationPrefs,
  playNotificationSound,
  requestDesktopPermission,
  setNotificationPrefs,
  showDesktopNotification,
  type DesktopPermission,
  type SpaceNotifyMode,
} from '@web/stores/notificationPrefs';
import { nativeNotificationsGranted } from '@/platform/overrides/desktop/native';
import { useNotificationPrefs } from '@/data';
import { ListSection, hapticsEnabled, setHapticsEnabled, toast } from '@/ui';
import { Note, SettingItem, SettingToggle, choiceRows } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';

export function permissionHint(p: DesktopPermission): string {
  switch (p) {
    case 'granted':
      return t('mobile.settings.notifPermGranted');
    case 'denied':
      return t('mobile.settings.notifPermDenied');
    case 'unsupported':
      return t('mobile.settings.notifPermUnsupported');
    default:
      return t('mobile.settings.notifPermDefault');
  }
}

export function NotificationsScreen() {
  useLocale();
  const prefs = useNotificationPrefs();
  const [permission, setPermission] = useState<DesktopPermission>(desktopPermission());
  const [haptics, setHaptics] = useState(hapticsEnabled());
  const [tested, setTested] = useState(false);

  // Coming back from the system settings: read the permission again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void nativeNotificationsGranted().then(() => setPermission(desktopPermission()));
    });
    void nativeNotificationsGranted().then(() => setPermission(desktopPermission()));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!tested) return;
    const id = setTimeout(() => setTested(false), 1500);
    return () => clearTimeout(id);
  }, [tested]);

  async function toggleSystem(on: boolean) {
    if (!on) {
      setNotificationPrefs({ desktop: false });
      return;
    }
    const p = await requestDesktopPermission();
    setPermission(p);
    setNotificationPrefs({ desktop: p === 'granted' });
  }

  function test() {
    if (notificationPrefs.sounds) playNotificationSound();
    if (notificationPrefs.desktop) {
      const shown = showDesktopNotification({ title: t('settings.notifications.testTitle'), body: t('settings.notifications.testBody'), tag: 'strafe-test' });
      if (!shown) toast.warning(permissionHint(desktopPermission()));
    }
    setTested(true);
  }

  const systemOn = prefs.desktop && permission === 'granted';
  const canTest = prefs.sounds || prefs.desktop;

  return (
    <SettingsScreen title={t('settings.sections.notifications.title')} testID="settings-notifications">
      <ListSection title={t('mobile.settings.notifSystemTitle')}>
        <SettingToggle
          icon="bell"
          title={t('mobile.settings.notifSystem')}
          description={permissionHint(permission)}
          value={systemOn}
          disabled={permission === 'denied' || permission === 'unsupported'}
          onValueChange={(on) => void toggleSystem(on)}
          testID="notif-system"
        />
        {permission === 'denied' ? (
          <SettingItem icon="gear" title={t('mobile.settings.openSystemSettings')} chevron onPress={() => void Linking.openSettings().catch(() => undefined)} />
        ) : null}
        <SettingToggle
          icon="eye"
          title={t('settings.notifications.preview')}
          description={t('settings.notifications.previewHint')}
          value={prefs.preview}
          onValueChange={(on) => setNotificationPrefs({ preview: on })}
          testID="notif-preview"
        />
        <SettingToggle
          icon="window-maximize"
          title={t('settings.notifications.whileFocused')}
          description={t('mobile.settings.notifWhileOpenHint')}
          value={prefs.whileFocused}
          onValueChange={(on) => setNotificationPrefs({ whileFocused: on })}
        />
      </ListSection>
      <Note>{t('mobile.settings.notifNoPush')}</Note>

      <ListSection title={t('mobile.settings.notifSoundsTitle')}>
        <SettingToggle
          icon="volume-high"
          title={t('settings.notifications.sounds')}
          description={t('mobile.settings.notifSoundHint')}
          value={prefs.sounds}
          onValueChange={(on) => setNotificationPrefs({ sounds: on, ...(on && !(notificationPrefs.volume > 0) ? { volume: 0.6 } : {}) })}
          testID="notif-sounds"
        />
        <SettingToggle
          icon="hand-pointer"
          title={t('mobile.settings.haptics')}
          description={t('mobile.settings.hapticsHint')}
          value={haptics}
          onValueChange={(on) => {
            setHapticsEnabled(on);
            setHaptics(on);
          }}
          testID="notif-haptics"
        />
      </ListSection>

      <ListSection title={`${t('settings.notifications.whenTitle')} · ${t('settings.notifications.spaces')}`}>
        {choiceRows<SpaceNotifyMode>({
          value: prefs.spaceMode,
          onChange: (v) => setNotificationPrefs({ spaceMode: v }),
          testIDPrefix: 'notif-space',
          options: [
            { value: 'all', icon: 'comments', title: t('settings.notifications.modeAll'), description: t('settings.notifications.modeAllHint') },
            { value: 'mentions', icon: 'at', title: t('settings.notifications.modeMentions'), description: t('settings.notifications.modeMentionsHint') },
            { value: 'none', icon: 'bell-slash', title: t('settings.notifications.modeNone'), description: t('settings.notifications.modeNoneHint') },
          ],
        })}
      </ListSection>
      <ListSection title={`${t('settings.notifications.whenTitle')} · ${t('mobile.settings.notifPms')}`} footer={t('settings.notifications.spaceDefaultHint')}>
        {choiceRows<'all' | 'none'>({
          value: prefs.pmMode,
          onChange: (v) => setNotificationPrefs({ pmMode: v === 'none' ? 'none' : 'all' }),
          testIDPrefix: 'notif-pm',
          options: [
            { value: 'all', icon: 'comments', title: t('settings.notifications.modeAll'), description: t('settings.notifications.pmAllHint') },
            { value: 'none', icon: 'bell-slash', title: t('settings.notifications.modeNone'), description: t('settings.notifications.modeNoneHint') },
          ],
        })}
      </ListSection>

      <ListSection title={t('settings.notifications.testTitle')} footer={canTest ? undefined : t('mobile.settings.notifTestDisabled')}>
        <SettingItem
          icon={tested ? 'check' : 'play'}
          title={t('settings.notifications.test')}
          disabled={!canTest}
          onPress={test}
          testID="notif-test"
        />
      </ListSection>
    </SettingsScreen>
  );
}
