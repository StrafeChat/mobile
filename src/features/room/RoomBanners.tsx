/**
 * The strips between a conversation's header and its messages:
 *
 * - an archived thread ("Sending a message unarchives it" / "archived and locked");
 * - encryption unavailable on this device (the engine failed to start) in an encrypted room -
 *   nothing can be read or sent there, and nothing is ever sent in the clear instead;
 * - messages still waiting for their encryption keys, with "Restore" when the account has a
 *   recovery backup that may hold them (they also resolve by themselves when another of the
 *   person's devices shares the keys);
 * - a call ringing or running in a PM or group (the voice area's RoomCallBanner: Join, or
 *   Open when this device is in it).
 */
import { useState } from 'react';
import { View } from 'react-native';
import { auth } from '@web/stores/auth';
import { restoreWithPrompt } from '@web/stores/e2eeBackup';
import { t } from '@web/i18n/t';
import type { RoomInfo } from '@/data';
import { RoomCallBanner } from '@/features/voice';
import { useTheme } from '@/theme';
import { Banner, Icon, Text, toast, withAlpha } from '@/ui';
import { useBackupExists, useCryptoHostState, usePendingDecryptCount } from './hooks';
import { errorMessage } from './util';

function ArchivedThreadStrip({ locked }: { locked: boolean }) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="text"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        paddingHorizontal: 16,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: withAlpha(theme.colors.border, 0.6),
        backgroundColor: withAlpha(theme.colors.muted, 0.25),
      }}
    >
      <Icon name="box-archive" size={11} tone="muted" />
      <Text variant="caption" align="center" style={{ flexShrink: 1 }}>
        {locked ? t('threads.archivedBannerLocked') : t('threads.archivedBanner')}
      </Text>
    </View>
  );
}

function KeysPendingBanner({ roomId }: { roomId: string }) {
  const pending = usePendingDecryptCount(roomId);
  const backup = useBackupExists(pending > 0);
  const [dismissed, setDismissed] = useState(false);
  const [restoring, setRestoring] = useState(false);
  if (pending === 0 || dismissed) return null;
  return (
    <Banner
      tone="info"
      icon="key"
      title={t('mobile.room.keysPendingTitle')}
      message={t('mobile.room.keysPendingBody')}
      onDismiss={() => setDismissed(true)}
      action={
        backup
          ? {
              label: t('recovery.restore'),
              loading: restoring,
              onPress: () => {
                const uid = auth.user?.id;
                if (!uid || restoring) return;
                setRestoring(true);
                // The flow reports its own failures in the prompt; anything it lets through (the
                // lost-code start-over failing) must not leave the button spinning or go unheard.
                void restoreWithPrompt(uid)
                  .catch((e: unknown) => toast.error(errorMessage(e)))
                  .finally(() => setRestoring(false));
              },
            }
          : undefined
      }
      style={{ margin: 8 }}
    />
  );
}

export function RoomBanners({ info }: { info: RoomInfo }) {
  const engine = useCryptoHostState();
  const engineFailed = engine === 'failed' && info.e2ee;
  return (
    <>
      {info.kind === 'thread' && info.thread?.archived ? <ArchivedThreadStrip locked={!!info.thread.locked} /> : null}
      {engineFailed ? (
        <Banner
          tone="error"
          icon="lock-open"
          title={t('mobile.crypto.engineUnavailableTitle')}
          message={t('mobile.crypto.engineUnavailableBody')}
          style={{ margin: 8 }}
        />
      ) : null}
      {info.e2ee && !engineFailed ? <KeysPendingBanner roomId={info.id} /> : null}
      {info.callable ? <RoomCallBanner roomId={info.id} /> : null}
    </>
  );
}
