/**
 * Root of the app: providers, the hosts every screen relies on, and the boot gate.
 *
 * Order of the tree matters:
 * - GestureHandlerRootView first (gestures anywhere), then the keyboard and safe-area
 *   providers, then UiProvider (bottom-sheet provider + the action-sheet, dialog, confirm and
 *   toast hosts), then the navigator.
 * - <CryptoHost/> mounts as early as possible: the E2EE engine takes a second or two to boot
 *   and every encrypted send, decrypt and key operation waits for it.
 * - The boot gate: the app starts on /boot (splash, or a retry after a start-up error) and
 *   moves to the sign-in screens or the app as the boot state settles (src/platform/boot.ts).
 *   A later change (signed out, session expired) moves again; every account change restarts
 *   the JS, so this only ever runs forward.
 */
import { useEffect } from 'react';
import { Stack, router, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useTheme } from '@/theme';
import { UiProvider } from '@/ui';
import { CryptoHost } from '@/platform/crypto';
import { startApp, useBootState } from '@/platform/boot';
import { installAppWiring } from '@/platform/wiring';
import { AuthHosts } from '@/features/auth';
import { installSettingsWiring } from '@/features/settings';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export const unstable_settings = { initialRouteName: 'boot' };

export default function RootLayout() {
  const theme = useTheme();
  const { state } = useBootState();

  useEffect(() => installAppWiring(), []);
  useEffect(() => installSettingsWiring(), []);
  useEffect(() => {
    void startApp();
  }, []);
  // Read as plain strings: the typed-routes tuple (generated under .expo/, absent in CI) would
  // otherwise decide whether segments[1] even exists.
  const segments: readonly string[] = useSegments();
  const group = segments[0];
  // Email verification and password reset links work signed in too (verifying a new address,
  // resetting from a mail link): opened while ready, they stay put.
  const authLinkScreen = group === '(auth)' && (segments[1] === 'verify-email' || segments[1] === 'reset-password');
  useEffect(() => {
    if (state !== 'booting') SplashScreen.hideAsync().catch(() => undefined);
    if (state === 'ready' && group !== '(main)' && !authLinkScreen) router.replace('/');
    else if (state === 'signed-out' && group !== '(auth)') router.replace('/sign-in');
    else if ((state === 'booting' || state === 'error') && group !== 'boot') router.replace('/boot');
  }, [state, group, authLinkScreen]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <KeyboardProvider>
        <SafeAreaProvider>
          <UiProvider>
            <StatusBar style={theme.dark ? 'light' : 'dark'} />
            <CryptoHost />
            <AuthHosts />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: theme.colors.background },
                animation: theme.reduceMotion ? 'none' : 'default',
              }}
            >
              <Stack.Screen name="boot" options={{ animation: 'none' }} />
              <Stack.Screen name="(auth)" options={{ animation: 'fade' }} />
              <Stack.Screen name="(main)" options={{ animation: 'fade' }} />
            </Stack>
          </UiProvider>
        </SafeAreaProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}
