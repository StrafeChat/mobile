/**
 * Devices & Encryption (DevicesSettingsPage): this device's safety number, the encrypted key
 * backup (set up / replace / restore, through the shared e2eeBackup flows whose prompts the
 * app's recovery and password hosts show), the pre-upgrade PIN backup import, and the
 * account's E2EE devices with revoke. These are encryption devices, not login sessions.
 *
 * A backup set up on another device is "untrusted" here until the recovery code opens it
 * (this device uploads nothing to it meanwhile), and the row says so - or, after a Restore
 * whose code opened only the retained previous version, says that instead.
 */
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import * as Device from 'expo-device';
import { formatDate, t } from '@web/i18n/t';
import { getBackupVersion, listOwnDevices, revokeDevice, type DeviceInfo } from '@web/api/devices';
import { E2eeStoreUnusableError, getCurrentDeviceId, getMachine } from '@web/lib/e2ee/machine';
import { getBackupStatus, getOwnFingerprint, hasLegacyPinBackup, type BackupStatus } from '@web/lib/e2ee';
import { createBackupWithPrompt, importLegacyWithPrompt, regenerateBackupWithPrompt, restoreWithPrompt } from '@web/stores/e2eeBackup';
import { setRecoveryPrompt } from '@web/stores/recoveryPrompt';
import { confirmDialog } from '@web/stores/confirmDialog';
import { auth } from '@web/stores/auth';
import { Button, ListSection, MONO_FONT, Spinner, Text } from '@/ui';
import { useTheme } from '@/theme';
import { Note, SettingItem, StatusPill } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { useCopy } from '../hooks/useCopy';

function registeredAt(iso: string): string {
  return formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) || iso;
}

export function DevicesScreen() {
  useLocale();
  const theme = useTheme();
  const { copy, copied } = useCopy();
  const [fingerprint, setFingerprint] = useState('');
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [revokingId, setRevokingId] = useState('');
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [storeError, setStoreError] = useState<E2eeStoreUnusableError | null>(null);
  // A Restore whose code did not open the current backup may have opened the retained
  // previous one instead (lib/e2ee restoreKeyBackup). The current version then still counts
  // as untrusted, and the row should say what happened rather than ask for the code again.
  // Holds when the current version was created, which is when the one just opened was
  // replaced; cleared by every backup action so it can never describe a stale state.
  const [restoredPreviousAt, setRestoredPreviousAt] = useState<string | null>(null);
  const thisDeviceId = getCurrentDeviceId();

  const refresh = useCallback(async (asPull = false) => {
    const userId = auth.user?.id;
    if (asPull) setRefreshing(true);
    else setLoading(true);
    setError('');
    setRestoredPreviousAt(null);
    try {
      const [list, hasLegacy] = await Promise.all([listOwnDevices(), hasLegacyPinBackup().catch(() => false)]);
      setDevices(list);
      setLegacy(hasLegacy);
      if (userId) {
        const machine = await getMachine(userId);
        setFingerprint(await getOwnFingerprint(machine));
        setBackup(await getBackupStatus(userId).catch(() => null));
        setStoreError(null);
      }
    } catch (e) {
      console.error('[e2ee] failed to load devices', e);
      if (e instanceof E2eeStoreUnusableError) setStoreError(e);
      else setError(t('settings.devices.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runBackupAction(action: (userId: string) => Promise<unknown>) {
    const userId = auth.user?.id;
    if (!userId) return;
    setBackupError('');
    setBackupBusy(true);
    setRestoredPreviousAt(null);
    try {
      await action(userId);
      setBackup(await getBackupStatus(userId).catch(() => null));
      setLegacy(await hasLegacyPinBackup().catch(() => false));
    } catch (e) {
      console.error('[e2ee] backup action failed', e);
      setBackupError(t('settings.devices.backupFailed'));
    } finally {
      setBackupBusy(false);
    }
  }

  async function restore(userId: string) {
    if ((await restoreWithPrompt(userId)) === null) return;
    const info = await getBackupVersion().catch(() => null);
    setRestoredPreviousAt(info?.created_at ?? null);
  }

  async function revoke(device: DeviceInfo) {
    if (device.device_id === thisDeviceId) return;
    const ok = await confirmDialog({
      title: t('settings.devices.revokeTitle'),
      body: t('settings.devices.revokeConfirm'),
      confirmLabel: t('settings.devices.revoke'),
      tone: 'danger',
      icon: 'fa-solid fa-display',
    });
    if (!ok) return;
    setRevokingId(device.device_id);
    try {
      await revokeDevice(device.device_id);
      setDevices((prev) => prev.filter((d) => d.device_id !== device.device_id));
    } catch (e) {
      console.error('[e2ee] failed to revoke device', e);
      setError(t('settings.devices.revokeFailed'));
    } finally {
      setRevokingId('');
    }
  }

  const backupSummary = backup
    ? backup.exists
      ? t('settings.devices.backupOn')
      : t('settings.devices.backupMissing')
    : loading
      ? t('settings.devices.backupChecking')
      : t('settings.devices.backupUnknown');
  const backupCounts =
    backup?.exists
      ? `${t('settings.devices.backupSaved', { n: backup.backedUp })}${backup.pending > 0 ? ` · ${t('settings.devices.backupPending', { n: backup.pending })}` : ''}`
      : '';
  // The server's backup was set up elsewhere and this device has no proof of whose key it is;
  // it uploads nothing until the recovery code confirms it.
  const untrustedNote = backup?.untrusted
    ? restoredPreviousAt
      ? t('settings.devices.backupPreviousRestored', { date: formatDate(restoredPreviousAt, { dateStyle: 'medium' }) || restoredPreviousAt })
      : t('settings.devices.backupUntrusted')
    : '';
  const backupNotes = [backup?.outOfSync ? t('settings.devices.backupOutOfSync') : '', untrustedNote].filter(Boolean).join('\n');
  const model = [Device.manufacturer, Device.modelName].filter(Boolean).join(' ');

  // This device first, then the rest by registration, newest first.
  const ordered = [...devices].sort((a, b) =>
    a.device_id === thisDeviceId ? -1 : b.device_id === thisDeviceId ? 1 : (b.created_at ?? '').localeCompare(a.created_at ?? ''),
  );

  return (
    <SettingsScreen title={t('settings.sections.devices.title')} error={error} refreshing={refreshing} onRefresh={() => void refresh(true)} testID="settings-devices">
      <ListSection title={t('settings.devices.codeTitle')} footer={t('settings.devices.safetyHint')}>
        <SettingItem
          icon="fingerprint"
          title={t('settings.devices.safetyNumber')}
          error={storeError ? t('settings.devices.storeUnusable') : undefined}
          trailing={
            storeError ? (
              <Button
                title={t('e2ee.storeReset')}
                size="sm"
                variant="outline"
                onPress={() => setRecoveryPrompt('e2eeStoreError', { store: storeError.storeName, detail: storeError.detail })}
              />
            ) : (
              <Button
                title={copied('fp') ? t('common.copied') : t('common.copy')}
                icon={copied('fp') ? 'check' : 'copy'}
                size="sm"
                variant="outline"
                disabled={!fingerprint}
                onPress={() => void copy('fp', fingerprint)}
              />
            )
          }
        />
        {!storeError ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
            <Text
              selectable
              tone="muted"
              style={{ fontFamily: MONO_FONT, writingDirection: 'ltr', fontSize: theme.font(13), letterSpacing: 0.5 }}
              accessibilityLabel={fingerprint ? fingerprint.split(' ').join(', ') : undefined}
            >
              {fingerprint || (loading ? t('common.loading') : '—')}
            </Text>
          </View>
        ) : null}
      </ListSection>

      <ListSection title={t('settings.devices.backupTitle')}>
        <SettingItem
          icon="key"
          title={t('settings.devices.backupName')}
          description={[backupSummary, backupCounts].filter(Boolean).join('\n')}
          error={backupError || backupNotes || undefined}
          busy={backupBusy}
        />
        {backup?.exists ? (
          <SettingItem
            icon="cloud-arrow-down"
            title={t('settings.devices.backupRestore')}
            disabled={backupBusy}
            onPress={() => void runBackupAction(restore)}
            testID="devices-backup-restore"
          />
        ) : null}
        <SettingItem
          icon={backup?.exists ? 'arrows-rotate' : 'plus'}
          title={backup?.exists ? t('settings.devices.backupReplace') : t('settings.devices.backupSetup')}
          disabled={backupBusy}
          onPress={() => void runBackupAction(backup?.exists ? regenerateBackupWithPrompt : createBackupWithPrompt)}
          testID="devices-backup-setup"
        />
        {legacy ? (
          <SettingItem
            icon="clock-rotate-left"
            title={t('settings.devices.legacyTitle')}
            description={t('settings.devices.legacyBody')}
            disabled={backupBusy}
            trailing={<Button title={t('settings.devices.legacyImport')} size="sm" variant="outline" disabled={backupBusy} onPress={() => void runBackupAction((id) => importLegacyWithPrompt(id))} />}
          />
        ) : null}
      </ListSection>

      <ListSection title={t('settings.devices.devicesTitle')}>
        {loading && devices.length === 0 ? (
          <View style={{ padding: 20 }}>
            <Spinner />
          </View>
        ) : ordered.length === 0 ? (
          <SettingItem title={t('settings.devices.none')} />
        ) : (
          ordered.map((d) => {
            const mine = d.device_id === thisDeviceId;
            return (
              <SettingItem
                key={d.device_id}
                icon={mine ? 'mobile-screen' : 'display'}
                title={t('settings.devices.deviceLabel', { id: d.device_id })}
                titleAccessory={mine ? <StatusPill label={t('settings.devices.thisDevice')} tone="primary" /> : null}
                description={[
                  mine && model ? model : '',
                  t('settings.devices.statusLine', {
                    status: d.has_keys ? t('settings.devices.active') : t('settings.devices.notSetUp'),
                    date: registeredAt(d.created_at),
                  }),
                ]
                  .filter(Boolean)
                  .join('\n')}
                trailing={
                  mine ? null : (
                    <Button
                      title={t('settings.devices.revoke')}
                      size="sm"
                      variant="outline"
                      loading={revokingId === d.device_id}
                      onPress={() => void revoke(d)}
                    />
                  )
                }
              />
            );
          })
        )}
      </ListSection>
      <Note>{t('mobile.settings.devicesNote')}</Note>
    </SettingsScreen>
  );
}
