/**
 * The call screen (route /call): the web's VoiceStage, full screen on a phone.
 *
 * - Tiles for everyone in the room, sized to the measured stage (fitTiles; on a phone held
 *   upright tiles may grow to 3:4 so a one-to-one call fills the screen); tap a tile to
 *   spotlight it, the others move to a strip underneath; long-press for the user sheet.
 * - Banners while connected: the session error (dismissible), a moderator's mute / deafen
 *   or no Speak permission, and "waiting for encryption keys from …" for anyone whose media
 *   key has not arrived. Under the tiles: the end-to-end encryption line and, in a PM call,
 *   who is still being rung.
 * - Not connected: who is there, and Join / Join with video (Start call in a PM), gated on
 *   the Connect and Video permissions and on this device being able to encrypt calls.
 * - Connected: the controls (CallControls). Leaving closes the screen; the chevron
 *   minimises it to the dock.
 *
 * While it shows the call you are in, the dock steps aside (voice.stageVisible).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ScrollView, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@web/i18n/t';
import { enableAudioPlayback, setVoice, setVoiceFocus, setVoiceStageVisible } from '@web/stores/voice';
import { useIsConnectedTo } from '@/data/voice';
import { usePmRoom, useRoomInfo } from '@/data/rooms';
import { useInstance, useMyId } from '@/data/me';
import { useSpace } from '@/data/spaces';
import { callEncryptionSupported } from '@/platform/voice';
import { openRoom } from '@/shell/state';
import { useTheme } from '@/theme';
import { Banner, Button, EmptyState, Header, Icon, IconButton, Spinner, Text, useExternalStore } from '@/ui';
import { CallControls } from './CallControls';
import { callViewStore, closeCallScreen, setCallScreenMounted, setCallViewTarget } from './callView';
import { callParticipantName, useCallRecord, useCallSession, useCallTiles, useRoomVoicePerms, useRoomVoiceStates, useVoiceFocus, type ParticipantRef } from './hooks';
import { joinVoiceFromUi, joiningStore } from './join';
import {
  PORTRAIT_MIN_ASPECT,
  STRIP_HEIGHT,
  STRIP_TILE,
  TILE_GAP,
  absentParticipantIds,
  fitTiles,
  qualityIcon,
  ringingNames,
  splitFocus,
  statusKey,
  unkeyedNames,
  voiceErrorKey,
  type CallTile,
} from './model';
import { PulseDot } from './Pulse';
import { toggleVoiceStats } from './sheets';
import { VoiceTile } from './VoiceTile';

export interface CallScreenProps {
  /** The room to show; the call you are in when omitted. */
  roomId?: string | null;
  spaceId?: string | null;
}

export function CallScreen(props: CallScreenProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const view = useExternalStore(callViewStore);
  const s = useCallSession();
  const instance = useInstance();

  // Route params seed the view; later opens (the dock, a join elsewhere) update it in place.
  useEffect(() => {
    if (props.roomId) setCallViewTarget({ roomId: props.roomId, spaceId: props.spaceId ?? null });
    setCallScreenMounted(true);
    return () => setCallScreenMounted(false);
    // Params are read once; openCallScreen handles changes while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Follow the session while showing it: a moderator's move (which tears the old room down
  // before joining the new one, so the last room is remembered across the idle moment).
  const lastSessionRoom = useRef(s.roomId);
  useEffect(() => {
    if (!s.roomId) return;
    const prev = lastSessionRoom.current;
    lastSessionRoom.current = s.roomId;
    if (prev && prev !== s.roomId && callViewStore.get().roomId === prev) {
      setCallViewTarget({ roomId: s.roomId, spaceId: s.spaceId });
    }
  }, [s.roomId, s.spaceId]);

  // Opened on "the current call": pin it, so the moment a move or reconnect spends idle does
  // not empty the screen. A hang-up from here closes the screen (CallControls' onLeave).
  useEffect(() => {
    if (!view.roomId && s.roomId) setCallViewTarget({ roomId: s.roomId, spaceId: s.spaceId });
  }, [view.roomId, s.roomId, s.spaceId]);

  const shown = view.roomId
    ? { roomId: view.roomId, spaceId: view.spaceId }
    : props.roomId
      ? { roomId: props.roomId, spaceId: props.spaceId ?? null }
      : s.roomId
        ? { roomId: s.roomId, spaceId: s.spaceId }
        : null;
  const roomId = shown?.roomId ?? null;
  // Nothing to show (opened with no call and no room): back to where we were.
  useEffect(() => {
    if (!roomId) closeCallScreen();
  }, [roomId]);

  if (!shown) {
    return <View style={{ flex: 1, backgroundColor: theme.colors.background }} />;
  }
  return (
    <CallStage
      key={shown.roomId}
      roomId={shown.roomId}
      spaceId={shown.spaceId}
      voiceEnabled={instance.voiceEnabled}
      bottomInset={insets.bottom}
    />
  );
}

function CallStage({ roomId, spaceId: spaceHint, voiceEnabled, bottomInset }: { roomId: string; spaceId: string | null; voiceEnabled: boolean; bottomInset: number }) {
  const theme = useTheme();
  const meId = useMyId();
  const info = useRoomInfo(roomId, spaceHint);
  const spaceId = info?.spaceId ?? spaceHint ?? null;
  const space = useSpace(spaceId);
  const kind: 'space' | 'call' = info && (info.kind === 'pm' || info.kind === 'group') ? 'call' : spaceId ? 'space' : 'call';
  const s = useCallSession();
  const connected = useIsConnectedTo(roomId);
  const tiles = useCallTiles(roomId, spaceId);
  const states = useRoomVoiceStates(roomId);
  const focus = useVoiceFocus();
  const perms = useRoomVoicePerms(spaceId, roomId);
  const call = useCallRecord(roomId);
  const pm = usePmRoom(kind === 'call' ? roomId : null);
  const joining = useExternalStore(joiningStore);
  const encryptionOk = useMemo(() => callEncryptionSupported(), []);
  const [joinError, setJoinError] = useState<string | null>(null);

  // The dock hides while the stage of the call you are in is on screen.
  useEffect(() => {
    setVoiceStageVisible(connected);
    return () => setVoiceStageVisible(false);
  }, [connected]);

  const nameOf = (st: ParticipantRef) => callParticipantName(st, roomId, spaceId);
  const unkeyed = connected && s.encrypted && s.roomId === roomId ? unkeyedNames(states, s.keyed, nameOf) : [];
  const absent = kind === 'call' ? absentParticipantIds(pm?.participants, states, meId) : [];
  const ringing = kind === 'call' && connected ? ringingNames(call, pm?.participants) : '';
  const roomName = info?.name ?? '…';
  const statusLine = connected ? `${t(statusKey(s.status))} · ${t(`voice.quality.${s.quality}`)}` : spaceId ? (space?.name ?? '') : t('nav.privateMessages');

  async function join(video: boolean) {
    setJoinError(null);
    await joinVoiceFromUi(roomId, { spaceId, video, onError: setJoinError });
  }

  const header = (
    <Header
      transparent
      border={false}
      leading={
        <IconButton
          icon="chevron-down"
          label={t('mobile.voice.minimize')}
          size="lg"
          color={theme.colors.foreground}
          onPress={closeCallScreen}
          testID="voice-minimize"
        />
      }
      title={roomName}
      subtitle={statusLine}
      titleAccessory={connected && s.encrypted ? <Icon name="lock" size={11} color={theme.colors.primary} style={{ marginStart: 6 }} accessibilityLabel={t('voice.e2ee')} /> : undefined}
      actions={[
        ...(kind === 'call'
          ? [
              {
                icon: 'message',
                label: t('mobile.voice.openChat'),
                onPress: () => {
                  openRoom(roomId, null);
                  closeCallScreen();
                },
              },
            ]
          : []),
        ...(connected ? [{ icon: qualityIcon(s.quality), label: t('voice.stats.title'), onPress: toggleVoiceStats, testID: 'voice-stats-button' }] : []),
      ]}
    />
  );

  if (!voiceEnabled) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
        {header}
        <EmptyState icon="volume-xmark" body={t('space.voiceUnsupported')} size="page" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }} testID="voice-call-screen">
      {header}

      {/* Banners */}
      <View style={{ gap: 8, paddingHorizontal: 12 }}>
        {connected && (s.audioBlocked || s.videoBlocked) ? (
          <Banner
            tone="warning"
            icon={s.videoBlocked ? 'play' : 'volume-high'}
            message={t(s.videoBlocked ? 'mobile.voice.enablePlayback' : 'mobile.voice.enableAudio')}
            action={{ label: t('mobile.voice.enableAction'), onPress: () => void enableAudioPlayback() }}
          />
        ) : null}
        {connected && s.error ? (
          <Banner tone="error" message={t(voiceErrorKey(s.error))} onDismiss={() => setVoice('session', 'error', null)} testID="voice-error-banner" />
        ) : null}
        {connected && (s.serverMute || s.serverDeaf || s.suppress) ? (
          <Banner
            tone="info"
            icon={s.serverDeaf ? 'volume-xmark' : 'microphone-slash'}
            message={s.serverDeaf ? t('voice.serverDeafened') : s.serverMute ? t('voice.serverMuted') : t('voice.suppressed')}
          />
        ) : null}
        {unkeyed.length > 0 ? (
          <Banner tone="info" icon="key" message={t('voice.waitingForKeys', { names: unkeyed.join(', ') })} testID="voice-keys-banner" />
        ) : null}
        {!connected && !encryptionOk ? <Banner tone="error" icon="lock" message={t('mobile.voice.errors.e2eeUnsupported')} /> : null}
      </View>

      <Stage tiles={tiles} focus={focus} roomId={roomId} spaceId={spaceId} kind={kind} roomName={roomName} />

      {/* Encryption and ringing lines */}
      <View style={{ alignItems: 'center', gap: 4, paddingHorizontal: 16, paddingBottom: 8 }}>
        {connected && s.encrypted ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }} accessible accessibilityLabel={t('voice.e2ee')}>
            <Icon name="lock" size={10} color={theme.colors.primary} />
            <Text variant="caption">{t('voice.e2ee')}</Text>
          </View>
        ) : null}
        {ringing ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }} accessibilityLiveRegion="polite">
            <PulseDot color={theme.colors.primary} />
            <Text variant="caption">{t('voice.ringing', { names: ringing })}</Text>
          </View>
        ) : null}
      </View>

      {/* Controls */}
      <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: Math.max(bottomInset, 12) + 8, alignItems: 'center' }}>
        {connected ? (
          <View style={{ width: '100%', maxWidth: 560 }}>
            <CallControls roomId={roomId} kind={kind} session={s} perms={perms} absentIds={absent} onLeave={closeCallScreen} />
          </View>
        ) : (
          <View style={{ width: '100%', maxWidth: 420, gap: 10 }}>
            <Button
              testID="voice-join"
              size="lg"
              fullWidth
              icon={kind === 'call' ? 'phone' : 'volume-high'}
              title={kind === 'call' ? (states.length > 0 ? t('voice.joinCall') : t('voice.startCall')) : t('voice.join')}
              loading={joining === roomId}
              disabled={!!joining || !perms.connect || !encryptionOk}
              onPress={() => void join(false)}
            />
            {perms.video ? (
              <Button
                testID="voice-join-video"
                size="lg"
                variant="outline"
                fullWidth
                icon="video"
                title={kind === 'call' && states.length === 0 ? t('voice.startVideoCall') : t('voice.joinWithVideo')}
                disabled={!!joining || !perms.connect || !encryptionOk}
                onPress={() => void join(true)}
              />
            ) : null}
            {!perms.connect ? (
              <Text variant="caption" align="center">
                {t('voice.noConnect')}
              </Text>
            ) : null}
            {joinError ? (
              <Text variant="caption" tone="danger" align="center" accessibilityLiveRegion="assertive">
                {joinError}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

function Stage({
  tiles,
  focus,
  roomId,
  spaceId,
  kind,
  roomName,
}: {
  tiles: CallTile[];
  focus: string | null;
  roomId: string;
  spaceId: string | null;
  kind: 'space' | 'call';
  roomName: string;
}) {
  const theme = useTheme();
  const [area, setArea] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    const next = { w: Math.floor(width - 2 * TILE_GAP), h: Math.floor(height - 2 * TILE_GAP) };
    setArea((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
  };
  const { focused, strip } = splitFocus(tiles, focus);
  const fitOpts = { minAspect: PORTRAIT_MIN_ASPECT };

  let body: ReactNode;
  if (tiles.length === 0) {
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 16 }}>
        <View
          style={{
            width: 72,
            height: 72,
            borderRadius: 36,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.colors.muted,
          }}
        >
          <Icon name={kind === 'call' ? 'phone' : 'volume-high'} size={28} tone="muted" />
        </View>
        <Text tone="muted" align="center" style={{ maxWidth: 320 }}>
          {kind === 'call' ? t('voice.emptyCall', { name: roomName }) : t('voice.empty')}
        </Text>
      </View>
    );
  } else if (area.w <= 0 || area.h <= 0) {
    body = <Spinner fill decorative />;
  } else if (focused) {
    const size = fitTiles(area.w, strip.length > 0 ? area.h - STRIP_HEIGHT : area.h, 1, fitOpts);
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: TILE_GAP }}>
        <VoiceTile
          tile={focused}
          roomId={roomId}
          spaceId={spaceId}
          focused
          width={size.w}
          height={size.h}
          onPress={() => setVoiceFocus(focused.key)}
        />
        {strip.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ flexGrow: 0, width: '100%' }}
            contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', gap: TILE_GAP, paddingHorizontal: TILE_GAP }}
          >
            {strip.map((tile) => (
              <VoiceTile
                key={tile.key}
                tile={tile}
                roomId={roomId}
                spaceId={spaceId}
                compact
                width={STRIP_TILE.w}
                height={STRIP_TILE.h}
                onPress={() => setVoiceFocus(tile.key)}
              />
            ))}
          </ScrollView>
        ) : null}
      </View>
    );
  } else {
    const grid = fitTiles(area.w, area.h, tiles.length, fitOpts);
    const gridWidth = grid.cols * grid.w + (grid.cols - 1) * TILE_GAP;
    body = (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: gridWidth, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: TILE_GAP }}>
          {tiles.map((tile) => (
            <VoiceTile
              key={tile.key}
              tile={tile}
              roomId={roomId}
              spaceId={spaceId}
              width={grid.w}
              height={grid.h}
              onPress={() => setVoiceFocus(tile.key)}
            />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: TILE_GAP }} onLayout={onLayout} testID="voice-stage">
      {body}
    </View>
  );
}
