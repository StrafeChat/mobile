/**
 * ToastHost: renders the current `toast()` - a floating pill near the top of the screen, the
 * same frosted pill as the web's connection and update banners. Top, not bottom: the bottom
 * belongs to the composer, the tab bar and the keyboard, which a toast would cover.
 *
 * Tap to dismiss; an action button runs and dismisses. Screen readers hear the message as it
 * appears (an announcement, so focus stays where the user was). Mounted once by `<UiHosts/>`,
 * after the sheet provider so a toast shows above an open sheet.
 */
import { useEffect } from 'react';
import { AccessibilityInfo, Pressable, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@web/i18n/t';
import { useTheme, type Theme } from '@/theme';
import { withAlpha } from './color';
import { useExternalStore } from './externalStore';
import { Icon } from './Icon';
import { useReduceMotion } from './motion';
import { physicalSides } from './safeArea';
import { Text } from './Text';
import { dismissToast, toastStore, type ToastTone } from './toast';

function toneIcon(tone: ToastTone): string | undefined {
  switch (tone) {
    case 'success':
      return 'circle-check';
    case 'error':
      return 'circle-exclamation';
    case 'warning':
      return 'triangle-exclamation';
    case 'info':
      return 'circle-info';
    default:
      return undefined;
  }
}

function toneColour(theme: Theme, tone: ToastTone): string {
  switch (tone) {
    case 'success':
      return theme.colors.success;
    case 'error':
      return theme.colors.destructive;
    case 'warning':
      return theme.colors.warning;
    case 'info':
    case 'default':
      return theme.colors.primary;
  }
}

export function ToastHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const sides = physicalSides(insets);
  const reduce = useReduceMotion();
  const cur = useExternalStore(toastStore);

  useEffect(() => {
    if (!cur) return;
    AccessibilityInfo.announceForAccessibility?.(cur.message);
    if (cur.duration <= 0) return;
    const id = cur.id;
    const timer = setTimeout(() => dismissToast(id), cur.duration);
    return () => clearTimeout(timer);
    // version: an in-place update restarts the timer.
  }, [cur?.id, cur?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!cur) return null;
  const accent = toneColour(theme, cur.tone);
  const icon = cur.icon ?? toneIcon(cur.tone);

  return (
    // Clear of the cutout and a side navigation bar in landscape too: the host sits over every
    // screen, outside their safe-area padding.
    <View
      testID="toast-host"
      pointerEvents="box-none"
      style={{ position: 'absolute', top: 0, left: 0, right: 0, paddingTop: insets.top + 8, alignItems: 'center', paddingLeft: sides.left + 12, paddingRight: sides.right + 12 }}
    >
      <Animated.View
        key={cur.id}
        entering={reduce ? undefined : FadeInUp.duration(180)}
        exiting={reduce ? undefined : FadeOutUp.duration(160)}
        style={{ maxWidth: 560 }}
      >
        <Pressable
          testID="toast"
          onPress={() => dismissToast(cur.id)}
          accessibilityRole="alert"
          accessibilityLabel={cur.message}
          accessibilityHint={t('mobile.ui.dismiss')}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            minHeight: 44,
            paddingVertical: 8,
            paddingStart: 14,
            paddingEnd: cur.action ? 6 : 16,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: cur.tone === 'default' ? theme.colors.border : withAlpha(accent, 0.4),
            backgroundColor: withAlpha(theme.colors.card, 0.97),
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 6 },
            elevation: 8,
          }}
        >
          {icon ? <Icon name={icon} size={15} color={accent} /> : null}
          <Text variant="label" style={{ flexShrink: 1 }} numberOfLines={3}>
            {cur.message}
          </Text>
          {cur.action ? (
            <Pressable
              onPress={() => {
                cur.action?.onPress();
                dismissToast(cur.id);
              }}
              accessibilityRole="button"
              accessibilityLabel={cur.action.label}
              hitSlop={8}
              style={({ pressed }) => ({
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: pressed ? theme.colors.primaryHover : theme.colors.primary,
              })}
            >
              <Text variant="caption" weight="semibold" tone="onPrimary">
                {cur.action.label}
              </Text>
            </Pressable>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}
