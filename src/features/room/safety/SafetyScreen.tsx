/**
 * Safety numbers - "Verify encryption" with someone (the web's SafetyNumberModal) as a pushed
 * screen: this device's code, and every device of theirs with its code and a Verified mark
 * you set after comparing the two over another channel (in person, a call).
 *
 * The codes come from lib/e2ee/safety, unchanged, running against the engine in the crypto
 * host - so they read exactly as on the web and on the desktop app, which is the point of
 * comparing them. Trust is local to this device's store (no cross-signing), as on the web.
 */
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMachine } from '@web/lib/e2ee/machine';
import {
  clearDeviceVerification,
  getOwnFingerprint,
  getPeerDevices,
  markDeviceVerified,
  type DeviceSafetyInfo,
} from '@web/lib/e2ee/safety';
import { t } from '@web/i18n/t';
import { useMyId } from '@/data';
import { useTheme } from '@/theme';
import { Button, Header, Icon, Spinner, Text, Touchable, toast, withAlpha } from '@/ui';
import { goBack } from '../navigation';
import { copyText } from '../util';
import { ReadableWidth } from '../shared/ReadableWidth';

function CodeBox({ code, label }: { code: string; label: string }) {
  const theme = useTheme();
  return (
    <Touchable
      onPress={() => code && void copyText(code)}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${code}`}
      accessibilityHint={t('common.copy')}
      feedback="opacity"
      style={{
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: withAlpha(theme.colors.muted, 0.4),
      }}
    >
      <Text variant="mono" selectable style={{ letterSpacing: 1, writingDirection: 'ltr' }}>
        {code || '—'}
      </Text>
    </Touchable>
  );
}

export function SafetyScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ userId: string; name?: string }>();
  const peerId = String(params.userId ?? '');
  const name = typeof params.name === 'string' && params.name ? params.name : t('common.unknown');
  const me = useMyId();
  const [own, setOwn] = useState('');
  const [devices, setDevices] = useState<DeviceSafetyInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [busyDevice, setBusyDevice] = useState('');

  const refresh = useCallback(async () => {
    if (!me || !peerId) return;
    setError('');
    try {
      const machine = await getMachine(me);
      const [mine, theirs] = await Promise.all([getOwnFingerprint(machine), getPeerDevices(machine, peerId)]);
      setOwn(mine);
      setDevices(theirs);
    } catch (e) {
      console.warn('[e2ee] failed to load safety numbers', e);
      setError(t('safety.loadFailed'));
    }
  }, [me, peerId]);

  useEffect(() => {
    setLoading(true);
    void refresh().finally(() => setLoading(false));
  }, [refresh]);

  async function toggle(device: DeviceSafetyInfo) {
    if (!me) return;
    setBusyDevice(device.deviceId);
    try {
      const machine = await getMachine(me);
      if (device.verified) await clearDeviceVerification(machine, peerId, device.deviceId);
      else await markDeviceVerified(machine, peerId, device.deviceId);
      await refresh();
    } catch (e) {
      console.warn('[e2ee] failed to update device trust', e);
      toast.error(t('errors.unknown'));
    } finally {
      setBusyDevice('');
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header title={t('safety.title')} onBack={goBack} leadingIcon="shield-halved" />
      <ReadableWidth>
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 24 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void refresh().finally(() => setRefreshing(false));
              }}
              tintColor={theme.colors.primary}
              colors={[theme.colors.primary]}
            />
          }
        >
          <Text tone="muted">{t('safety.body', { name })}</Text>
          {loading ? <Spinner label={t('common.loading')} /> : null}
          {error ? (
            <Text tone="danger" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          {!loading && !error ? (
            <>
              <View style={{ gap: 6 }}>
                <Text variant="overline">{t('safety.yourCode')}</Text>
                <CodeBox code={own} label={t('safety.yourCode')} />
              </View>
              <View style={{ gap: 8 }}>
                <Text variant="overline">{t('safety.theirDevices', { name })}</Text>
                {devices.length === 0 ? <Text tone="muted">{t('settings.devices.none')}</Text> : null}
                {devices.map((d) => (
                  <View
                    key={d.deviceId}
                    style={{
                      gap: 8,
                      padding: 12,
                      borderRadius: theme.radii.lg,
                      borderWidth: 1,
                      borderColor: theme.colors.border,
                      backgroundColor: withAlpha(theme.colors.muted, 0.2),
                    }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <Text variant="caption" weight="medium" style={{ writingDirection: 'ltr', flexShrink: 1 }}>
                        {t('settings.devices.deviceLabel', { id: d.deviceId })}
                      </Text>
                      {d.verified ? (
                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 4,
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: 999,
                            backgroundColor: withAlpha(theme.colors.primary, 0.15),
                          }}
                        >
                          <Icon name="circle-check" size={11} tone="primary" />
                          <Text variant="caption" tone="primary" weight="semibold">
                            {t('safety.verified')}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                    <CodeBox code={d.fingerprint} label={t('settings.devices.deviceLabel', { id: d.deviceId })} />
                    <Button
                      title={d.verified ? t('safety.clearVerification') : t('safety.markVerified')}
                      variant={d.verified ? 'outline' : 'primary'}
                      size="sm"
                      loading={busyDevice === d.deviceId}
                      disabled={!!busyDevice && busyDevice !== d.deviceId}
                      onPress={() => void toggle(d)}
                    />
                  </View>
                ))}
              </View>
            </>
          ) : null}
        </ScrollView>
      </ReadableWidth>
    </View>
  );
}
