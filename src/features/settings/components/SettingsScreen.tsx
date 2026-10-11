/**
 * The frame every settings screen shares: the app bar with a back arrow, a keyboard-aware
 * scroll body (forms stay above the keyboard), an optional page error banner, pull to refresh
 * for pages that list server data, and an optional footer pinned above the keyboard (the
 * role editor's unsaved-changes bar).
 *
 * On a tablet the content is a centred column instead of a line of text across a 12-inch
 * screen - the iPad Settings proportion.
 */
import type { ReactNode } from 'react';
import { RefreshControl, StyleSheet, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { Banner, Header, WIDE_BREAKPOINT, type HeaderAction } from '@/ui';
import { leaveSettingsScreen } from '../navigation';

/** Widest the settings column gets. */
export const SETTINGS_MAX_WIDTH = 720;

/** The centred-column style for content inside a settings screen (lists use it on their wrapper). */
export function useContentColumn(): ViewStyle | null {
  const { width } = useWindowDimensions();
  return width >= WIDE_BREAKPOINT ? { width: '100%', maxWidth: SETTINGS_MAX_WIDTH, alignSelf: 'center' } : null;
}

export interface SettingsScreenProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  actions?: HeaderAction[];
  right?: ReactNode;
  /** A red banner at the top of the page (the web's shared settings error line). */
  error?: string | null;
  onDismissError?: () => void;
  /** Pull to refresh. */
  refreshing?: boolean;
  onRefresh?: () => void;
  /** Pinned under the content, above the keyboard. */
  footer?: ReactNode;
  /** false: the body is a list that scrolls itself (FlashList pages). */
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  children?: ReactNode;
  testID?: string;
}

export function SettingsScreen({
  title,
  subtitle,
  onBack,
  actions,
  right,
  error,
  onDismissError,
  refreshing,
  onRefresh,
  footer,
  scroll = true,
  contentStyle,
  children,
  testID,
}: SettingsScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const column = useContentColumn();
  const banner = error ? (
    <Banner tone="error" message={error} onDismiss={onDismissError} style={{ marginHorizontal: 12, marginBottom: 12 }} />
  ) : null;

  return (
    <View testID={testID} style={[styles.root, { backgroundColor: theme.colors.background }]}>
      <Header title={title} subtitle={subtitle} onBack={onBack ?? leaveSettingsScreen} actions={actions} right={right} />
      {scroll ? (
        <KeyboardAwareScrollView
          bottomOffset={24}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={!!refreshing}
                onRefresh={onRefresh}
                tintColor={theme.colors.mutedForeground}
                colors={[theme.colors.primary]}
                progressBackgroundColor={theme.colors.card}
              />
            ) : undefined
          }
          contentContainerStyle={[{ paddingTop: 12, paddingBottom: insets.bottom + 32 }, column, contentStyle]}
        >
          {banner}
          {children}
        </KeyboardAwareScrollView>
      ) : (
        <View style={[styles.flex, column]}>
          {banner ? <View style={{ paddingTop: 12 }}>{banner}</View> : null}
          {children}
        </View>
      )}
      {footer ? (
        <KeyboardStickyView offset={{ opened: 0, closed: 0 }}>
          <View
            style={{
              paddingHorizontal: 12,
              paddingTop: 10,
              paddingBottom: insets.bottom + 10,
              backgroundColor: theme.colors.card,
              borderTopWidth: StyleSheet.hairlineWidth,
              borderTopColor: theme.colors.border,
            }}
          >
            <View style={column}>{footer}</View>
          </View>
        </KeyboardStickyView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
});
