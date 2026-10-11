/**
 * Accessibility (AccessibilitySettingsPage): reduce motion and following the system's
 * reduced-motion switch, colour saturation, underlined links - plus, as the web's page offers
 * through its shared stores, text size and compact messages, and the app's haptic feedback.
 *
 * "Follow system" is applied by the settings wiring (navigation.ts) from AccessibilityInfo:
 * the web mirrors a CSS media query that does not exist in the app.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { appearance, setFontScale, setReduceMotion, type FontScale } from '@web/stores/appearance';
import { accessibility, setAccessibility } from '@web/stores/accessibility';
import { setMessageCompact } from '@web/stores/settings';
import { useSolid } from '@/bridge/solid';
import { useSettings } from '@/data';
import { ListSection, SegmentedControl, hapticsEnabled, setHapticsEnabled, useOsReduceMotion } from '@/ui';
import { LiveSlider } from '../components/LiveSlider';
import { Note, SettingItem, SettingToggle } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';

export function AccessibilityScreen() {
  useLocale();
  const os = useOsReduceMotion();
  const settings = useSettings();
  const s = useSolid(() => ({
    reduceMotion: appearance.reduceMotion,
    fontScale: appearance.fontScale,
    follow: accessibility.followSystemMotion,
    saturation: accessibility.saturation,
    underline: accessibility.underlineLinks,
  }));
  const [haptics, setHaptics] = useState(hapticsEnabled());

  return (
    <SettingsScreen title={t('settings.sections.accessibility.title')} testID="settings-accessibility">
      <ListSection title={t('settings.accessibility.motionTitle')} footer={s.follow ? t('settings.accessibility.alsoAppearance') : undefined}>
        <SettingToggle
          icon="person-running"
          title={t('settings.accessibility.reduceMotion')}
          description={t('settings.accessibility.reduceMotionHint')}
          value={s.reduceMotion}
          disabled={s.follow}
          onValueChange={setReduceMotion}
          testID="a11y-reduce-motion"
        />
        <SettingToggle
          icon="mobile-screen"
          title={t('settings.accessibility.followSystem')}
          description={os ? t('settings.accessibility.followSystemOnHint') : t('settings.accessibility.followSystemOffHint')}
          value={s.follow}
          onValueChange={(on) => {
            setAccessibility({ followSystemMotion: on });
            if (on && appearance.reduceMotion !== os) setReduceMotion(os);
          }}
          testID="a11y-follow-system"
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
        />
      </ListSection>

      <ListSection title={t('settings.accessibility.colorTitle')} footer={t('settings.accessibility.saturationHint')}>
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <LiveSlider
            label={t('settings.accessibility.saturation')}
            min={0}
            max={100}
            value={s.saturation}
            format={(v) => `${v}%`}
            onCommit={(v) => setAccessibility({ saturation: v })}
            testID="a11y-saturation"
          />
        </View>
      </ListSection>

      <ListSection title={t('settings.accessibility.textTitle')}>
        <SettingItem icon="text-height" title={t('settings.accessibility.textSize')} description={t('settings.accessibility.textSizeHint')} />
        <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
          <SegmentedControl<FontScale>
            value={s.fontScale}
            onChange={setFontScale}
            accessibilityLabel={t('settings.accessibility.textSize')}
            items={[
              { id: 'sm', label: t('settings.accessibility.sizeSmall') },
              { id: 'md', label: t('settings.accessibility.sizeDefault') },
              { id: 'lg', label: t('settings.accessibility.sizeLarge') },
            ]}
          />
        </View>
        <SettingToggle
          icon="link"
          title={t('settings.accessibility.underlineLinks')}
          description={t('settings.accessibility.underlineLinksHint')}
          value={s.underline}
          onValueChange={(on) => setAccessibility({ underlineLinks: on })}
          testID="a11y-underline"
        />
        <SettingToggle
          icon="compress"
          title={t('settings.accessibility.compact')}
          description={t('settings.accessibility.compactHint')}
          value={!!settings.messageCompact}
          onValueChange={setMessageCompact}
        />
      </ListSection>
      <Note>{t('mobile.settings.systemTextSizeNote')}</Note>
    </SettingsScreen>
  );
}
