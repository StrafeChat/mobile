/**
 * Settings -> Notifications -> Push notifications: whether this device is notified while
 * the app is closed, and through what.
 *
 * - the switch (per device) with the status line under it: active and through which
 *   service, or exactly why not - permission, no service on the device, the gateway, the
 *   instance;
 * - Android: which service carries the pushes - Automatic, Firebase, or one of the
 *   UnifiedPush distributors installed (development builds also list the gateway's debug
 *   transport);
 * - a test: the instance pushes a notification to this device and says how it went;
 * - what an observer of the pushes can see (only ciphertext), in one line.
 *
 * State comes from src/platform/push; this screen only reads it and calls into it.
 */
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { activePushAccount } from '@/platform/push/accounts';
import { sendTestPush } from '@/platform/push/api';
import { pushEnabled, setPushEnabled, setTransportPref, transportPref, type TransportPref } from '@/platform/push/config';
import { ensurePushRegistration } from '@/platform/push/registration';
import { pushCapabilities, pushStatus, type PushStatus, type TransportInfo } from '@/platform/push/status';
import { ListSection, toast } from '@/ui';
import { Note, SettingItem, SettingToggle, choiceRows, type ChoiceOption } from '../components/rows';

export function transportLabel(info: TransportInfo): string {
  switch (info.kind) {
    case 'fcm':
      return t('mobile.push.transportFcm');
    case 'apns':
      return t('mobile.push.transportApns');
    case 'debug':
      return t('mobile.push.transportDebug');
    case 'unifiedpush':
      return t('mobile.push.transportUnifiedPush', { distributor: info.distributorName || info.distributorId || '?' });
  }
}

/** The status line under the switch. */
export function pushStatusText(status: PushStatus): string {
  switch (status.state) {
    case 'idle':
    case 'registering':
      return t('mobile.push.statusRegistering');
    case 'unavailable':
      return t('mobile.push.statusUnavailable');
    case 'disabled':
      return t('mobile.push.statusDisabled');
    case 'signed-out':
      return t('mobile.push.statusSignedOut');
    case 'permission':
      return t('mobile.push.statusPermission');
    case 'active':
      return t('mobile.push.statusActive', { transport: transportLabel(status.transport) });
    case 'no-transport':
      switch (status.reason) {
        case 'choose-distributor':
          return t('mobile.push.noTransportChoose');
        case 'fcm-unavailable':
          return t('mobile.push.noTransportFcm');
        case 'distributor-missing':
          return t('mobile.push.noTransportMissing');
        default:
          return t('mobile.push.noTransport');
      }
    case 'error': {
      const error = status.detail || '?';
      switch (status.where) {
        case 'transport':
          return t('mobile.push.errorTransport', { transport: status.transport ? transportLabel(status.transport) : '?', error });
        case 'gateway':
          return t('mobile.push.errorGateway', { error });
        case 'distributor':
          return t('mobile.push.errorDistributor', { error });
        case 'unsupported':
          return t('mobile.push.errorUnsupported');
        default:
          return t('mobile.push.errorInstance', { error });
      }
    }
  }
}

/** States the person should act on (shown as an error rather than a description). */
function isProblem(status: PushStatus): boolean {
  return status.state === 'error' || status.state === 'permission' || status.state === 'no-transport';
}

export function PushSettings() {
  const status = useSolid(() => pushStatus());
  const caps = useSolid(() => pushCapabilities());
  const enabled = useSolid(() => pushEnabled());
  const pref = useSolid(() => transportPref());
  const [testing, setTesting] = useState(false);

  // Fresh on arrival: the person may have come from the system settings.
  useEffect(() => {
    void ensurePushRegistration();
  }, []);

  const unavailable = status.state === 'unavailable';
  const statusLine = pushStatusText(status);
  const problem = enabled && isProblem(status);
  const showTransports = Platform.OS === 'android' && enabled && !unavailable && !!caps;

  async function test() {
    const account = activePushAccount();
    if (!account || testing) return;
    setTesting(true);
    try {
      const result = await sendTestPush(account);
      if (result.delivered) toast.success(t('mobile.push.testSent'), { icon: 'bell' });
      else if ('missing' in result) {
        toast.warning(t('mobile.push.testNotRegistered'));
        void ensurePushRegistration({ force: true });
      } else {
        toast.error(t('mobile.push.testFailed', { error: result.status ? `${result.status} ${result.error}` : result.error }));
        // The push service no longer knows the endpoint (a token Google or Apple retired, a
        // gateway whose keys changed): the instance has already deleted the subscription, so
        // register afresh now rather than at the next daily refresh.
        if (result.status === 404 || result.status === 410) void ensurePushRegistration({ force: true });
      }
    } catch (e) {
      toast.error(t('mobile.push.testFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setTesting(false);
    }
  }

  const transportOptions: ChoiceOption<TransportPref>[] = [];
  if (showTransports) {
    transportOptions.push(
      { value: 'auto', icon: 'wand-magic-sparkles', title: t('mobile.push.transportAuto'), description: t('mobile.push.transportAutoHint') },
      {
        value: 'fcm',
        icon: 'cloud',
        title: t('mobile.push.transportFcm'),
        description: caps!.fcm ? t('mobile.push.transportFcmHint') : t('mobile.push.transportFcmUnavailable'),
        disabled: !caps!.fcm && pref !== 'fcm',
      },
      ...caps!.distributors.map(
        (d): ChoiceOption<TransportPref> => ({
          value: `unifiedpush:${d.id}`,
          icon: 'tower-broadcast',
          title: d.name || d.id,
          description: t('mobile.push.transportDistributorHint'),
        }),
      ),
    );
    if (__DEV__) {
      transportOptions.push({ value: 'debug', icon: 'bug', title: t('mobile.push.transportDebug'), description: t('mobile.push.transportDebugHint') });
    }
  }

  return (
    <>
      <ListSection title={t('mobile.push.title')}>
        <SettingToggle
          icon="tower-cell"
          title={t('mobile.push.toggle')}
          description={problem ? undefined : statusLine}
          error={problem ? statusLine : undefined}
          value={enabled && !unavailable}
          disabled={unavailable}
          onValueChange={(on) => setPushEnabled(on)}
          testID="push-enabled"
        />
        {enabled && !unavailable ? (
          <SettingItem
            icon="paper-plane"
            title={t('mobile.push.test')}
            description={t('mobile.push.testHint')}
            disabled={status.state !== 'active' || testing}
            busy={testing}
            onPress={() => void test()}
            testID="push-test"
          />
        ) : null}
      </ListSection>
      {showTransports ? (
        <ListSection title={t('mobile.push.transportTitle')}>
          {choiceRows<TransportPref>({
            value: pref,
            onChange: (v) => setTransportPref(v),
            testIDPrefix: 'push-transport',
            options: transportOptions,
          })}
        </ListSection>
      ) : null}
      <Note>{t('mobile.push.privacyNote')}</Note>
    </>
  );
}
