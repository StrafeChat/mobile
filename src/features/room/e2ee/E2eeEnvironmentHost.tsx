/**
 * "Encryption cannot work on this device" (the web's E2eeEnvironmentModal), from the web's
 * stores/recoveryPrompt:
 *
 * - e2eeEnvironmentError: no Web Crypto. On a phone the crypto shims and the engine's
 *   WebView make this practically unreachable; if it ever shows, it explains and closes. The
 *   error's own text is the web's advice for a browser tab opened over a LAN address (HTTPS,
 *   mkcert, adb reverse - in English), which means nothing to someone holding a phone, so the
 *   dialog says what is true here instead.
 * - e2eeStoreError: this device's encryption store cannot be opened (E2eeStoreUnusableError
 *   - the engine's storage was cleared or damaged, or its passphrase is gone from the
 *   keystore). The reset gives the device a fresh identity: resetLocalE2eeStore (the mobile
 *   override revokes the old device and wipes the engine's storage), then the app restarts
 *   and provisions a new device, and the backup flow offers to restore history.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { recoveryPrompt, setRecoveryPrompt } from '@web/stores/recoveryPrompt';
import { auth } from '@web/stores/auth';
import { resetLocalE2eeStore } from '@web/lib/e2ee/machine';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { reloadApp } from '@/platform/reload';
import { useTheme } from '@/theme';
import { Dialog, Text, withAlpha } from '@/ui';

export function E2eeEnvironmentHost() {
  const theme = useTheme();
  const environment = useSolid(() => recoveryPrompt.e2eeEnvironmentError);
  const store = useSolid(() => recoveryPrompt.e2eeStoreError);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');

  function dismissStore() {
    if (resetting) return;
    setResetError('');
    setRecoveryPrompt('e2eeStoreError', null);
  }

  async function reset() {
    const userId = auth.user?.id;
    if (!userId || resetting) return;
    setResetError('');
    setResetting(true);
    try {
      await resetLocalE2eeStore(userId);
      // A fresh start: the engine, the gateway and every store belong to one device identity.
      await reloadApp('strafe: encryption store reset');
    } catch (e) {
      console.warn('[e2ee] store reset failed', e);
      setResetError(t('e2ee.storeResetFailed', { error: e instanceof Error ? e.message : String(e) }));
      setResetting(false);
    }
  }

  return (
    <>
      <Dialog
        open={!!environment}
        onClose={() => setRecoveryPrompt('e2eeEnvironmentError', null)}
        title={t('mobile.crypto.engineUnavailableTitle')}
        description={environment ? t('mobile.crypto.engineUnavailableBody') : undefined}
        icon="lock-open"
        tone="warning"
        actions={[{ label: t('common.gotIt'), onPress: () => setRecoveryPrompt('e2eeEnvironmentError', null) }]}
      />
      <Dialog
        open={!!store}
        onClose={dismissStore}
        dismissible={!resetting}
        title={t('e2ee.storeTitle')}
        description={t('e2ee.storeBody')}
        icon="database"
        tone="warning"
        actions={[
          { label: t('e2ee.storeLater'), onPress: dismissStore, variant: 'outline', disabled: resetting },
          { label: t('e2ee.storeReset'), onPress: () => void reset(), loading: resetting },
        ]}
      >
        <View style={{ gap: 10 }}>
          <Text tone="muted">{t('e2ee.storeConsequence')}</Text>
          {store ? (
            <View style={{ padding: 8, borderRadius: theme.radii.sm, backgroundColor: withAlpha(theme.colors.muted, 0.4) }}>
              <Text variant="mono" tone="muted" selectable style={{ fontSize: theme.font(11), lineHeight: theme.font(15), writingDirection: 'ltr' }}>
                {`${store.store}: ${store.detail}`}
              </Text>
            </View>
          ) : null}
          {resetError ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="assertive">
              {resetError}
            </Text>
          ) : null}
        </View>
      </Dialog>
    </>
  );
}
