/**
 * The frame every auth screen shares: a quiet top bar (back on the start side, the language
 * switcher on the end side, as the web's fixed AuthLanguageSwitcher), the Strafe turtle, a
 * title and subtitle, and the form - in a keyboard-aware scroll view so the focused field and
 * the submit button stay above the keyboard.
 *
 * Phones get the content straight on the background; tablets (>= 768 dp) get a centred card,
 * so a 12-inch screen does not stretch a sign-in form edge to edge.
 */
import type { ReactNode } from 'react';
import { I18nManager, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Icon, IconButton, Text, WIDE_BREAKPOINT, largeRadius, useReduceMotion, withAlpha } from '@/ui';
import { LanguageButton } from './LanguageButton';

 
const TURTLE = require('../../../../assets/images/splash-icon.png') as number;

/** The Strafe turtle on a soft halo of the theme's primary colour. */
export function AuthBrand({ size = 84 }: { size?: number }) {
  const theme = useTheme();
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center' }} accessibilityRole="image" accessibilityLabel="Strafe">
      <View
        style={{
          width: size * 1.45,
          height: size * 1.45,
          borderRadius: size,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(theme.colors.primary, theme.dark ? 0.14 : 0.12),
        }}
      >
        <Image source={TURTLE} style={{ width: size, height: size }} contentFit="contain" accessible={false} />
      </View>
    </View>
  );
}

export interface AuthScaffoldProps {
  title?: string;
  subtitle?: string;
  /** A back arrow at the start of the top bar. */
  onBack?: () => void;
  backLabel?: string;
  /** Show the turtle above the title (default true). */
  brand?: boolean;
  /** Larger turtle (the welcome screen). */
  heroBrand?: boolean;
  /** Something under the subtitle, before the form (an icon chip on result screens). */
  accessory?: ReactNode;
  /** Centre title and subtitle (result screens). */
  centered?: boolean;
  /** Pinned under the scroll view's content on phones (footer links). */
  footer?: ReactNode;
  children?: ReactNode;
  testID?: string;
}

export function AuthScaffold({
  title,
  subtitle,
  onBack,
  backLabel,
  brand = true,
  heroBrand,
  accessory,
  centered,
  footer,
  children,
  testID,
}: AuthScaffoldProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const reduce = useReduceMotion();
  const wide = width >= WIDE_BREAKPOINT;

  const body = (
    <View style={{ gap: 20 }}>
      {brand ? <AuthBrand size={heroBrand ? (wide ? 128 : 108) : wide ? 84 : 68} /> : null}
      {title || subtitle ? (
        <View style={{ gap: 6, alignItems: centered || brand ? 'center' : 'flex-start' }}>
          {title ? (
            <Text variant="title" accessibilityRole="header" align={centered || brand ? 'center' : undefined} style={{ fontSize: theme.font(heroBrand ? 28 : 24), lineHeight: theme.font(heroBrand ? 34 : 30) }}>
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text tone="muted" align={centered || brand ? 'center' : undefined} style={{ fontSize: theme.font(15), lineHeight: theme.font(21) }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      ) : null}
      {accessory}
      {children}
    </View>
  );

  return (
    <View testID={testID} style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <View
        style={{
          paddingTop: insets.top + 4,
          paddingHorizontal: 8,
          paddingBottom: 4,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        {onBack ? (
          <IconButton
            icon={I18nManager.isRTL ? 'arrow-right' : 'arrow-left'}
            label={backLabel ?? t('common.back')}
            onPress={onBack}
            size="lg"
            tone="subtle"
            testID="auth-back"
          />
        ) : (
          <View style={{ width: 44 }} />
        )}
        <LanguageButton />
      </View>
      <KeyboardAwareScrollView
        bottomOffset={24}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: wide ? 'center' : 'flex-start',
          alignItems: 'center',
          paddingHorizontal: wide ? 32 : 20,
          paddingTop: wide ? 24 : 8,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <Animated.View
          entering={reduce ? undefined : FadeInDown.duration(260)}
          style={[
            { width: '100%', maxWidth: wide ? 460 : 520 },
            wide
              ? {
                  backgroundColor: theme.colors.card,
                  borderRadius: largeRadius(theme.radii.xl),
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  padding: 32,
                }
              : null,
          ]}
        >
          {body}
        </Animated.View>
        {footer ? (
          <Animated.View entering={reduce ? undefined : FadeIn.delay(120)} style={{ width: '100%', maxWidth: wide ? 460 : 520, marginTop: 20 }}>
            {footer}
          </Animated.View>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}

/** A round icon chip for result screens (envelope, check), as the web's cards show. */
export function AuthIconChip({ icon, tone = 'primary' }: { icon: string; tone?: 'primary' | 'danger' }) {
  const theme = useTheme();
  const color = tone === 'danger' ? theme.colors.destructive : theme.colors.primary;
  return (
    <View style={{ alignItems: 'center' }}>
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: withAlpha(color, 0.15),
        }}
      >
        <Icon name={icon} size={26} color={color} />
      </View>
    </View>
  );
}

