import { useEffect } from 'react';
import { Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { auth } from '@web/stores/auth';
import { activeTheme } from '@web/stores/appearance';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';

/** Boot probe: proves the shared web stores load and react on Hermes. Replaced by the router gate. */
export default function Index() {
  const theme = useTheme();
  const signedIn = useSolid(() => !!auth.token);
  const themeName = useSolid(() => activeTheme().name);
  useEffect(() => {
    SplashScreen.hideAsync().catch(() => undefined);
  }, []);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <Text style={{ color: theme.colors.foreground, fontSize: theme.font(20) }}>Strafe</Text>
      <Text style={{ color: theme.colors.mutedForeground }}>theme: {themeName}</Text>
      <Text style={{ color: theme.colors.mutedForeground }}>signed in: {String(signedIn)}</Text>
      <Text style={{ color: theme.colors.mutedForeground }}>{t('auth.login.title')}</Text>
    </View>
  );
}
