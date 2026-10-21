/**
 * Voice statistics (the web's VoiceStatsPopover as a bottom sheet): how the media travels
 * (UDP / TCP, through a relay or not), the round trip, what we send, noise suppression and
 * the connection quality, then per person how much of their audio and video arrived intact.
 * Re-read every second while open; rates cover the interval since the previous reading, so
 * the first reading shows zeros. Closes on hang-up.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { readVoiceStats, voice, voiceStatesForRoom } from '@web/stores/voice';
import { userIdOfIdentity } from '@web/lib/e2ee/callKeys';
import type { AudioStreamStats, VideoStreamStats, VoiceStatsSnapshot } from '@web/lib/voice/stats';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Divider, Sheet, Text, useExternalStore } from '@/ui';
import { callParticipantName, useCallSession, useCallSettings } from './hooks';
import { fmtPct } from './model';
import { closeVoiceStats, voiceStatsStore } from './sheets';

const REFRESH_MS = 1000;

export function VoiceStatsSheetHost() {
  const open = useExternalStore(voiceStatsStore);
  const s = useCallSession();
  // Hanging up closes it.
  useEffect(() => {
    if (s.status === 'idle') closeVoiceStats();
  }, [s.status]);
  return (
    <Sheet open={open} onClose={closeVoiceStats} title={t('voice.stats.title')} icon="wave-square" closeButton testID="voice-stats-sheet">
      <StatsBody active={open} />
    </Sheet>
  );
}

/** Polls while `active`; keeps the last reading on screen while the sheet slides away. */
function StatsBody({ active }: { active: boolean }) {
  const [snap, setSnap] = useState<VoiceStatsSnapshot | null>(null);
  const settings = useCallSettings();
  const quality = useSolid(() => voice.session.quality);

  useEffect(() => {
    if (!active) return;
    // A fresh opening starts from "Measuring…", as the web's popover does.
    setSnap(null);
    let alive = true;
    const tick = () => {
      void readVoiceStats()
        .then((next) => {
          if (alive) setSnap(next);
        })
        .catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [active]);

  if (!snap) {
    return (
      <Text tone="muted" accessibilityLiveRegion="polite">
        {t('voice.stats.measuring')}
      </Text>
    );
  }

  const transport = snap.transport
    ? `${snap.transport.protocol ? snap.transport.protocol.toUpperCase() : '…'}${snap.transport.relay ? ` · ${t('voice.stats.relay')}` : ''}`
    : '…';
  const noise = settings.noiseSuppression ? t('mobile.voice.noiseOn') : t('settings.voice.noiseMode.off');

  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Row label={t('voice.stats.transport')} value={transport} />
        <Row label={t('voice.stats.rtt')} value={snap.rttMs !== undefined ? `${snap.rttMs} ms` : '…'} />
        <Row
          label={t('voice.stats.sending')}
          value={snap.outbound ? `${snap.outbound.kbps} kbps · ${t('voice.stats.loss')} ${fmtPct(snap.outbound.lossPct)}` : t('voice.stats.nothing')}
        />
        <Row label={t('voice.stats.noise')} value={noise} />
        <Row label={t('voice.stats.quality')} value={t(`voice.quality.${quality}`)} />
      </View>
      <Divider subtle />
      {snap.participants.length === 0 ? (
        <Text tone="muted">{t('voice.stats.alone')}</Text>
      ) : (
        <View style={{ gap: 10 }}>
          {snap.participants.map((p) => (
            <View key={p.identity} style={{ gap: 2 }} accessible>
              <ParticipantName identity={p.identity} />
              {p.microphone ? <AudioLine stats={p.microphone} /> : <Text variant="caption">{t('voice.stats.noAudio')}</Text>}
              {p.camera ? <VideoLine stats={p.camera} label={t('voice.stats.camera')} /> : null}
              {p.screen ? <VideoLine stats={p.screen} label={t('voice.stats.screen')} /> : null}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 12 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text variant="caption" style={{ minWidth: 120 }}>
        {label}
      </Text>
      <Text variant="caption" tone="default" style={{ flex: 1, fontVariant: ['tabular-nums'] }}>
        {value}
      </Text>
    </View>
  );
}

function ParticipantName({ identity }: { identity: string }) {
  const name = useSolid(() => {
    const uid = userIdOfIdentity(identity);
    const rid = voice.session.roomId ?? '';
    // The call's own naming rule: a PM's participants, else the space member by their space
    // profile, else what the voice state carries - as the tiles and the user sheet name them.
    const st = voiceStatesForRoom(rid).find((s) => s.user_id === uid);
    return callParticipantName(st ?? { user_id: uid }, rid, voice.session.spaceId);
  }, [identity]);
  return (
    <Text variant="label" numberOfLines={1}>
      {name}
    </Text>
  );
}

function AudioLine({ stats }: { stats: AudioStreamStats }) {
  return (
    <Text variant="caption" style={{ fontVariant: ['tabular-nums'] }}>
      {`${t('voice.stats.loss')} ${fmtPct(stats.lossPct)} · ${t('voice.stats.jitter')} ${stats.jitterMs} ms · ${t('voice.stats.concealed')} ${fmtPct(stats.concealedPct)} · ${stats.kbps} kbps`}
    </Text>
  );
}

function VideoLine({ stats, label }: { stats: VideoStreamStats; label: string }) {
  const theme = useTheme();
  return (
    <Text variant="caption" color={theme.colors.mutedForeground} style={{ fontVariant: ['tabular-nums'] }}>
      {`${label} ${stats.width}×${stats.height} · ${stats.fps} fps · ${t('voice.stats.loss')} ${fmtPct(stats.lossPct)} · ${stats.kbps} kbps`}
    </Text>
  );
}
