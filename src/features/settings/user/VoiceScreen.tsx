/**
 * Voice & Video (VoiceVideoSettingsPage), reworked around a phone's audio:
 *
 * - Output is an audio route (automatic, speaker, earpiece, wired headset, Bluetooth) rather
 *   than a sink id; iOS offers its system route picker. Stored in voiceSettings.outputDeviceId
 *   as the voice layer expects, and applied to a live call at once.
 * - The input device picker and input volume are gone: a phone has one microphone path and
 *   the voice layer applies neither (automatic gain does the levelling).
 * - Noise suppression is the platform's on-device voice processing, on or off. Turning it
 *   back on restores whichever suppressor was last chosen (the stored values are untouched).
 * - Push to talk is the on-screen hold-to-talk button in a call; only the release delay is a
 *   setting. There is no key to capture.
 * - The mic test meters the microphone with the recorder outside a call, and shows the live
 *   call level during one.
 * - Screen-share defaults appear only where screen sharing exists (Android).
 */
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { t } from '@web/i18n/t';
import {
  SCREEN_SHARE_FPS,
  SCREEN_SHARE_RESOLUTIONS,
  setVoiceSettings,
  voiceSettings,
  type ScreenShareFps,
  type ScreenShareResolution,
  type VoiceSettings,
} from '@web/stores/voiceSettings';
import { applyVoiceSettingsToSession, onInputModeChanged, setNoiseSuppressionEnabled, voice } from '@web/stores/voice';
import { listAudioOutputs, screenShareSupported, selectAudioRoute, showAudioRoutePicker } from '@/platform/voice';
import { VoiceRecorderError, startVoiceRecording, type VoiceRecorderHandle } from '@/platform/media';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Banner, Button, ListSection, SegmentedControl, Select, Text } from '@/ui';
import { LiveSlider } from '../components/LiveSlider';
import { FormCard, Note, SettingItem, SettingToggle, choiceRows } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';

/** The voice layer's route ids ('' = let the system choose). */
export const AUDIO_ROUTES = ['', 'speaker', 'earpiece', 'headset', 'bluetooth'] as const;
export type AudioRouteId = (typeof AUDIO_ROUTES)[number];

const ROUTE_ICON: Record<AudioRouteId, string> = { '': 'wand-magic-sparkles', speaker: 'volume-high', earpiece: 'phone', headset: 'headphones', bluetooth: 'fa-brands fa-bluetooth' };

export function routeLabel(id: string): string {
  return t(`mobile.settings.route.${id || 'auto'}`);
}

/** Recorder meter (0..1, see voiceRecorder meteringToLevel) back to dBFS. */
export function levelToDb(level: number): number {
  if (!(level > 0)) return -100;
  const amplitude = Math.pow(level, 1 / 0.7) / 3.2;
  return Math.max(-100, Math.min(0, 20 * Math.log10(amplitude)));
}

/** -60..0 dBFS onto 0..100, as the web's meter. */
export function dbToPercent(db: number): number {
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

/** Whether a level reads as speech with the current sensitivity (the web's `speaking`). */
export function meterSpeaking(pct: number, s: Pick<VoiceSettings, 'autoSensitivity' | 'sensitivityDb'>): boolean {
  return s.autoSensitivity ? pct > 25 : pct > dbToPercent(s.sensitivityDb);
}

const MIC_TEST_MAX_MS = 60_000;

function MicMeter({ percent, speaking, threshold }: { percent: number; speaking: boolean; threshold: number | null }) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('settings.voice.level')}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(percent) }}
      style={{ height: 12, borderRadius: 6, backgroundColor: theme.colors.muted, overflow: 'hidden' }}
    >
      <View style={{ height: '100%', width: `${percent}%`, borderRadius: 6, backgroundColor: speaking ? theme.colors.success : theme.colors.primary }} />
      {threshold !== null ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, start: `${threshold}%`, width: 2, backgroundColor: theme.colors.foreground }} />
      ) : null}
    </View>
  );
}

export function VoiceScreen() {
  useLocale();
  const s = useSolid(() => ({ ...voiceSettings }));
  const call = useSolid(() => ({ status: voice.session.status, micLevel: voice.micLevel }));
  const inCall = call.status !== 'idle';
  const [routes, setRoutes] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [testLevel, setTestLevel] = useState(0);
  const [micError, setMicError] = useState('');
  const recorder = useRef<VoiceRecorderHandle | null>(null);
  const timers = useRef<{ poll?: ReturnType<typeof setInterval>; stop?: ReturnType<typeof setTimeout> }>({});

  useEffect(() => {
    let live = true;
    listAudioOutputs()
      .then((list) => live && setRoutes(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [call.status]);

  // Bumped by every stop (and on leaving), so a start still waiting for the microphone - the
  // permission prompt can take a while - knows it was called off and releases it at once.
  const testGen = useRef(0);
  const inCallRef = useRef(inCall);
  inCallRef.current = inCall;

  function stopTest() {
    testGen.current++;
    clearInterval(timers.current.poll);
    clearTimeout(timers.current.stop);
    recorder.current?.cancel();
    recorder.current = null;
    setTesting(false);
    setTestLevel(0);
  }
  useEffect(() => () => stopTest(), []);
  // A call starting takes the microphone; the test gives way.
  useEffect(() => {
    if (inCall) stopTest();
  }, [inCall]);

  async function startTest() {
    if (recorder.current) return;
    setMicError('');
    const gen = ++testGen.current;
    try {
      const handle = await startVoiceRecording();
      // Left the page, stopped, started again or joined a call meanwhile: never keep the mic open.
      if (gen !== testGen.current || inCallRef.current) {
        handle.cancel();
        return;
      }
      recorder.current = handle;
      setTesting(true);
      timers.current.poll = setInterval(() => {
        const levels = handle.levels();
        setTestLevel(dbToPercent(levelToDb(levels[levels.length - 1] ?? 0)));
      }, 100);
      timers.current.stop = setTimeout(stopTest, MIC_TEST_MAX_MS);
    } catch (e) {
      if (gen !== testGen.current) return;
      stopTest();
      setMicError(e instanceof VoiceRecorderError && e.reason === 'denied' ? t('mobile.media.micDenied') : t('settings.voice.micFailed'));
    }
  }

  function update(patch: Partial<VoiceSettings>, apply?: { input?: boolean; output?: boolean }) {
    setVoiceSettings(patch);
    if (apply && inCall) void applyVoiceSettingsToSession(apply);
  }

  function chooseRoute(id: string) {
    update({ outputDeviceId: id });
    if (inCall) void selectAudioRoute(id).catch(() => undefined);
  }

  // Android lists what is connected; iOS answers ['default', 'force_speaker'] and has its own picker.
  const ios = Platform.OS === 'ios';
  const available = new Set(['', 'speaker', ...routes.filter((r) => (AUDIO_ROUTES as readonly string[]).includes(r))]);
  if (!ios) available.add('earpiece');
  if (s.outputDeviceId) available.add(s.outputDeviceId);
  const routeOptions = AUDIO_ROUTES.filter((r) => available.has(r)).map((r) => ({ value: r, title: routeLabel(r), icon: ROUTE_ICON[r] }));

  const meterPct = inCall ? dbToPercent(call.micLevel ?? -100) : testLevel;
  const meterActive = inCall || testing;
  const suppression = s.noiseSuppression !== 'off';

  return (
    <SettingsScreen title={t('settings.sections.voice.title')} testID="settings-voice">
      {micError ? <Banner tone="error" message={micError} onDismiss={() => setMicError('')} style={{ marginHorizontal: 12, marginBottom: 12 }} /> : null}

      <ListSection title={t('mobile.settings.audioOutput')} footer={inCall ? t('mobile.settings.routeAppliesNow') : t('mobile.settings.routeHint')}>
        {choiceRows<string>({ options: routeOptions, value: s.outputDeviceId, onChange: chooseRoute, testIDPrefix: 'voice-route' })}
        {ios && inCall ? <SettingItem icon="arrow-right-arrow-left" title={t('mobile.settings.routePicker')} chevron onPress={() => void showAudioRoutePicker()} /> : null}
      </ListSection>

      <FormCard style={{ marginBottom: 16 }}>
        <LiveSlider
          label={t('settings.voice.outputVolume')}
          min={0}
          max={200}
          value={s.outputVolume}
          format={(v) => `${v}%`}
          onCommit={(v) => update({ outputVolume: v }, { output: true })}
        />
      </FormCard>

      <ListSection title={t('settings.voice.micTestTitle')}>
        <View style={{ padding: 16, gap: 12 }}>
          <Text variant="caption">{inCall ? t('mobile.settings.micTestInCall') : t('settings.voice.micTestHint')}</Text>
          {!inCall ? (
            <Button
              title={testing ? t('settings.voice.stopTest') : t('settings.voice.startTest')}
              icon={testing ? 'stop' : 'microphone'}
              variant={testing ? 'destructive' : 'outline'}
              onPress={() => (testing ? stopTest() : void startTest())}
              testID="voice-mic-test"
            />
          ) : null}
          <MicMeter percent={meterActive ? meterPct : 0} speaking={meterActive && meterSpeaking(meterPct, s)} threshold={s.autoSensitivity ? null : dbToPercent(s.sensitivityDb)} />
        </View>
      </ListSection>

      <ListSection title={t('settings.voice.inputModeTitle')}>
        <View style={{ padding: 16, gap: 10 }}>
          <SegmentedControl<'vad' | 'ptt'>
            value={s.inputMode}
            onChange={(mode) => {
              setVoiceSettings({ inputMode: mode });
              onInputModeChanged();
            }}
            accessibilityLabel={t('settings.voice.inputModeTitle')}
            items={[
              { id: 'vad', label: t('settings.voice.modeVad') },
              { id: 'ptt', label: t('settings.voice.modePtt') },
            ]}
          />
          <Text variant="caption">{s.inputMode === 'ptt' ? t('mobile.settings.pttHint') : t('settings.voice.modeVadHint')}</Text>
          {s.inputMode === 'ptt' ? (
            <LiveSlider
              label={t('settings.voice.pttRelease')}
              min={0}
              max={2000}
              step={50}
              value={s.pttReleaseMs}
              format={(v) => `${v} ms`}
              onCommit={(v) => setVoiceSettings({ pttReleaseMs: v })}
            />
          ) : null}
        </View>
      </ListSection>

      <ListSection title={t('settings.voice.sensitivityTitle')}>
        <SettingToggle
          icon="wand-magic-sparkles"
          title={t('settings.voice.autoSensitivity')}
          description={t('settings.voice.autoSensitivityHint')}
          value={s.autoSensitivity}
          onValueChange={(on) => update({ autoSensitivity: on })}
        />
        <View style={{ paddingHorizontal: 16, paddingVertical: 12 }}>
          <LiveSlider
            label={t('settings.voice.threshold')}
            min={-100}
            max={0}
            value={s.sensitivityDb}
            format={(v) => `${v} dB`}
            disabled={s.autoSensitivity}
            onCommit={(v) => update({ sensitivityDb: v })}
          />
        </View>
      </ListSection>

      <ListSection title={t('settings.voice.processingTitle')}>
        <SettingToggle
          icon="arrows-rotate"
          title={t('settings.voice.echo')}
          description={t('settings.voice.echoHint')}
          value={s.echoCancellation}
          onValueChange={(on) => update({ echoCancellation: on }, { input: true })}
        />
        <SettingToggle
          icon="wind"
          title={t('settings.voice.noise')}
          description={t('mobile.settings.noiseHint')}
          value={suppression}
          onValueChange={(on) => void setNoiseSuppressionEnabled(on)}
          testID="voice-noise"
        />
        <SettingToggle
          icon="gauge-high"
          title={t('settings.voice.gain')}
          description={t('settings.voice.gainHint')}
          value={s.autoGainControl}
          onValueChange={(on) => update({ autoGainControl: on }, { input: true })}
        />
      </ListSection>
      {Platform.OS === 'ios' ? <Note>{t('mobile.settings.iosVoiceProcessing')}</Note> : null}

      {screenShareSupported() ? (
        <ListSection title={t('settings.voice.screenShareTitle')} footer={t('settings.voice.screenShareHint')}>
          <View style={{ padding: 16, gap: 12 }}>
            <Select<ScreenShareResolution>
              label={t('voice.screenShare.resolution')}
              value={s.screenShareResolution}
              options={SCREEN_SHARE_RESOLUTIONS.map((r) => ({
                value: r,
                label: r === 'source' ? t('voice.screenShare.source') : t('voice.screenShare.resolutionValue', { height: r }),
              }))}
              onValueChange={(v) => setVoiceSettings({ screenShareResolution: v })}
            />
            <Select<string>
              label={t('voice.screenShare.frameRate')}
              value={String(s.screenShareFps)}
              options={SCREEN_SHARE_FPS.map((f) => ({ value: String(f), label: t('voice.screenShare.fpsValue', { fps: f }) }))}
              onValueChange={(v) => setVoiceSettings({ screenShareFps: Number(v) as ScreenShareFps })}
            />
          </View>
        </ListSection>
      ) : null}

      <ListSection title={t('settings.voice.videoTitle')}>
        <SettingToggle
          icon="left-right"
          title={t('settings.voice.mirror')}
          description={t('settings.voice.mirrorHint')}
          value={s.mirrorCamera}
          onValueChange={(on) => setVoiceSettings({ mirrorCamera: on })}
        />
      </ListSection>
      <Note>{t('mobile.settings.cameraFlipNote')}</Note>
    </SettingsScreen>
  );
}
