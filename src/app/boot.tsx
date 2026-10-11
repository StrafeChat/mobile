/**
 * The splash screen while the app starts, and the way out of a failed start.
 * The root layout moves on from here as soon as the boot state settles.
 */
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { useBootState } from '@/platform/boot';
import { reloadApp } from '@/platform/reload';
import { Button, Spinner, Text } from '@/ui';
import { useTheme } from '@/theme';

export default function Boot() {
  const theme = useTheme();
  const { state, error } = useBootState();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, backgroundColor: theme.colors.background }}>
      {state === 'error' ? (
        <>
          <Text variant="heading">{t('mobile.boot.startFailed')}</Text>
          {error ? (
            <Text tone="muted" style={{ textAlign: 'center' }}>
              {error}
            </Text>
          ) : null}
          <Button title={t('mobile.boot.retry')} onPress={() => void reloadApp('strafe: retry start')} />
        </>
      ) : (
        <Spinner />
      )}
    </View>
  );
}
