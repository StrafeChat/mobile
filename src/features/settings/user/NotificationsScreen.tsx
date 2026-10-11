/**
 * Notifications (NotificationsSettingsPage), for a phone: system notifications (the OS
 * permission, with a way to the system settings once it is refused), message preview, the
 * open-conversation rule, push notifications while the app is closed (PushSettings), sound
 * and haptics, what to be notified for in spaces and PMs, and a test notification. Per device, in the web's `strafe_notifications` store, so the shared
 * notification logic reads the same keys.
 *
 * The chime is the system notification sound (see the notificationPrefs override), so the
 * web's volume slider has no counterpart; only "on" matters here.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Linking } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useFocusEffect } from 'expo-router';
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
import { pushStatus } from '@/platform/push/status';
import { useSolid } from '@/bridge/solid';
import { useNotificationPrefs } from '@/data';
import { ListSection, hapticsEnabled, setHapticsEnabled, toast } from '@/ui';
import { SettingItem, SettingToggle, choiceRows } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { PushSettings } from './PushSettings';

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

/**
 * The OS permission as this page needs it. desktopPermission() only knows granted or not, so
 * a permission never asked (or refused once on Android 13+, which may still ask again) reads
 * as 'denied' there - which would disable the switch that asks. Here that is 'default'.
 * Also refreshes the cached answer desktopPermission() gives the shared notification code.
 */
export async function readNotificationPermission(): Promise<DesktopPermission> {
  if (await nativeNotificationsGranted()) return 'granted';
  try {
    const p = await Notifications.getPermissionsAsync();
    return p.canAskAgain ? 'default' : 'denied';
  } catch {
    return 'denied';
  }
}

export function NotificationsScreen() {
  useLocale();
  const prefs = useNotificationPrefs();
  const [permission, setPermission] = useState<DesktopPermission>(() => (desktopPermission() === 'granted' ? 'granted' : 'default'));
  const [haptics, setHaptics] = useState(hapticsEnabled());
  const [tested, setTested] = useState(false);
  // A request this visit was refused: show the way to the system settings even where the OS
  // would still let the app ask (an Android before 13 refuses without a dialog).
  const refused = useRef(false);
  const readSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const reread = useCallback(() => {
    const id = ++readSeq.current;
    void readNotificationPermission().then((p) => {
      if (!mounted.current || id !== readSeq.current) return;
      if (p === 'granted') refused.current = false;
      setPermission(p === 'default' && refused.current ? 'denied' : p);
    });
  }, []);

  // The permission changes behind this page: in the system settings (back to the foreground),
  // from another screen (focus), or from the push section below, whose registration asks for it
  // on arrival (its status moves when that answer comes back).
  useFocusEffect(reread);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reread();
    });
    return () => sub.remove();
  }, [reread]);
  const pushState = useSolid(() => pushStatus().state);
  useEffect(() => {
    reread();
  }, [pushState, reread]);

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
    readSeq.current++;
    const p = await requestDesktopPermission();
    refused.current = p !== 'granted';
    if (mounted.current) setPermission(p);
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
      {/* Push: its status line says whether anything arrives while the app is closed. */}
      <PushSettings />

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
