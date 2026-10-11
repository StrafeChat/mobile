/**
 * The screen-share quality picker (the web's ScreenShareDialog as a sheet): resolution and
 * frame rate first - the system "start recording" prompt that follows has no quality
 * controls - each choice saved at once as the default for next time. Android only (the
 * button is gated on screenShareSupported); can't be dismissed while the share is starting.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { setScreenShareEnabled, voice } from '@web/stores/voice';
import {
  SCREEN_SHARE_FPS,
  SCREEN_SHARE_RESOLUTIONS,
  setVoiceSettings,
  voiceSettings,
  type ScreenShareFps,
  type ScreenShareResolution,
} from '@web/stores/voiceSettings';
import { useSolid } from '@/bridge/solid';
import { Button, FieldLabel, SegmentedControl, Sheet, Text, useExternalStore } from '@/ui';
import { closeScreenShareSheet, screenShareSheetStore } from './sheets';

export function resolutionLabel(r: ScreenShareResolution): string {
  return r === 'source' ? t('voice.screenShare.source') : t('voice.screenShare.resolutionValue', { height: r });
}

export function ScreenShareSheetHost() {
  const open = useExternalStore(screenShareSheetStore);
  const active = useSolid(() => voice.session.status !== 'idle');
  const [busy, setBusy] = useState(false);
  const quality = useSolid(() => ({ resolution: voiceSettings.screenShareResolution, fps: voiceSettings.screenShareFps }));
  // The call ended with the picker open: forget it, or it would pop up by itself the next
  // time a call starts.
  useEffect(() => {
    if (!active) closeScreenShareSheet();
  }, [active]);

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      await setScreenShareEnabled(true, { resolution: quality.resolution, fps: quality.fps });
      closeScreenShareSheet();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open && active}
      onClose={() => {
        if (!busy) closeScreenShareSheet();
      }}
      dismissible={!busy}
      title={t('voice.screenShare.title')}
      description={t('voice.screenShare.description')}
      icon="display"
      testID="voice-screen-share-sheet"
    >
      <View style={{ gap: 16 }}>
        <View style={{ gap: 6 }}>
          <FieldLabel label={t('voice.screenShare.resolution')} />
          <SegmentedControl<ScreenShareResolution>
            value={quality.resolution}
            onChange={(r) => setVoiceSettings({ screenShareResolution: r })}
            items={SCREEN_SHARE_RESOLUTIONS.map((r) => ({ id: r, label: resolutionLabel(r) }))}
            accessibilityLabel={t('voice.screenShare.resolution')}
          />
        </View>
        <View style={{ gap: 6 }}>
          <FieldLabel label={t('voice.screenShare.frameRate')} />
          <SegmentedControl<`${ScreenShareFps}`>
            value={`${quality.fps}` as `${ScreenShareFps}`}
            onChange={(f) => setVoiceSettings({ screenShareFps: Number(f) as ScreenShareFps })}
            items={SCREEN_SHARE_FPS.map((f) => ({ id: `${f}` as `${ScreenShareFps}`, label: t('voice.screenShare.fpsValue', { fps: f }) }))}
            accessibilityLabel={t('voice.screenShare.frameRate')}
          />
        </View>
        <Text variant="caption">{quality.fps >= 60 ? t('voice.screenShare.hintMotion') : t('voice.screenShare.hintDetail')}</Text>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title={t('common.cancel')} variant="outline" disabled={busy} onPress={closeScreenShareSheet} style={{ flex: 1 }} />
          <Button title={t('voice.shareScreen')} icon="display" loading={busy} disabled={busy} onPress={() => void share()} style={{ flex: 1 }} testID="voice-screen-share-start" />
        </View>
      </View>
    </Sheet>
  );
}
