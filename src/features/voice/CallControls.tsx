/**
 * The call screen's controls (the web stage's control row, laid out for a thumb):
 *
 *   camera · microphone · deafen · audio output · more · leave
 *
 * with "more" holding what a phone reaches for less often - flip camera, screen share
 * (Android), noise suppression, ring again (PM calls), the output list, statistics, and
 * voice settings. Push-to-talk mode adds a large hold-to-talk button above the row.
 *
 * Gates are the web's: mute is locked under a server mute or without Speak; deafen under a
 * server deafen; camera and screen share need the Video permission; screen share needs a
 * platform that can publish one.
 */
import { useCallback, useState } from 'react';
import { Pressable, View, useWindowDimensions, type GestureResponderEvent } from 'react-native';
import { t } from '@web/i18n/t';
import { leaveVoiceRoom, ringMembers, setScreenShareEnabled, toggleDeafen, toggleMute, toggleNoiseSuppression } from '@web/stores/voice';
import { openUserSettings } from '@web/stores/userSettingsModal';
import type { VoicePerms } from '@web/lib/spacePermissions';
import { screenShareSupported, setPushToTalkHeld, switchCamera } from '@/platform/voice';
import { useTheme } from '@/theme';
import { Icon, Text, Touchable, haptics, hitSlopFor, showActionSheet, toast, useExternalStore, withAlpha, type ActionSheetEntry } from '@/ui';
import { chooseAudioRoute, currentRoute, pickedRouteStore, pressSpeakerButton, routeIcon, routeLabel } from './audioRoute';
import type { CallSessionView } from './hooks';
import { useCallSettings } from './hooks';
import { toggleCameraFromUi } from './join';
import { openScreenShareSheet, toggleVoiceStats } from './sheets';

export type ControlTone = 'idle' | 'on' | 'off';

export interface ControlButtonProps {
  icon: string;
  label: string;
  tone?: ControlTone;
  /** Toggle state for screen readers (on = selected). */
  selected?: boolean;
  disabled?: boolean;
  size?: number;
  onPress?: (e: GestureResponderEvent) => void;
  onLongPress?: (e: GestureResponderEvent) => void;
  testID?: string;
}

/** A round call control (the web's 44 px stage buttons, a little larger for thumbs). */
export function ControlButton({ icon, label, tone = 'idle', selected, disabled, size = 52, onPress, onLongPress, testID }: ControlButtonProps) {
  const theme = useTheme();
  const c = theme.colors;
  const palette =
    tone === 'off'
      ? { bg: c.destructive, fg: c.destructiveForeground, pressed: withAlpha(c.destructive, 0.8) }
      : tone === 'on'
        ? { bg: c.primary, fg: c.primaryForeground, pressed: c.primaryHover }
        : { bg: c.secondary, fg: c.secondaryForeground, pressed: c.accent };
  return (
    <Touchable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      pressedColor={palette.pressed}
      hitSlop={hitSlopFor(size)}
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? { disabled: !!disabled } : { selected, disabled: !!disabled }}
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.bg,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon name={icon} size={Math.round(size * 0.38)} color={palette.fg} />
    </Touchable>
  );
}

/**
 * Hold to talk: transmits while held (and pttReleaseMs after), only in push-to-talk mode.
 * The store releases it if the app leaves the foreground mid-press.
 */
export function PushToTalkButton({ disabled, compact }: { disabled?: boolean; compact?: boolean }) {
  const theme = useTheme();
  const [held, setHeld] = useState(false);
  const press = useCallback((on: boolean) => {
    setHeld(on);
    setPushToTalkHeld(on);
    if (on) haptics.impact('medium');
  }, []);
  const c = theme.colors;
  const label = t('mobile.voice.holdToTalk');
  return (
    <Pressable
      disabled={disabled}
      onPressIn={() => press(true)}
      onPressOut={() => press(false)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={t('mobile.voice.holdToTalkHint')}
      accessibilityState={{ disabled: !!disabled, selected: held }}
      hitSlop={compact ? 6 : 0}
      testID="voice-ptt"
      style={{
        height: compact ? 40 : 56,
        minWidth: compact ? 40 : 200,
        paddingHorizontal: compact ? 10 : 24,
        borderRadius: compact ? 20 : 28,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        backgroundColor: held ? c.success : c.secondary,
        borderWidth: 2,
        borderColor: held ? c.success : withAlpha(c.border, 0.8),
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Icon name={held ? 'microphone-lines' : 'microphone'} size={compact ? 16 : 20} color={held ? c.primaryForeground : c.secondaryForeground} />
      {compact ? null : (
        <Text variant="label" weight="semibold" color={held ? c.primaryForeground : c.secondaryForeground}>
          {held ? t('mobile.voice.talking') : label}
        </Text>
      )}
    </Pressable>
  );
}

export interface CallControlsProps {
  roomId: string;
  kind: 'space' | 'call';
  session: CallSessionView;
  perms: VoicePerms;
  /** Room participants not in the call (PM calls): who "Ring again" rings. */
  absentIds: readonly string[];
  /** Leaving from here also closes the call screen. */
  onLeave?: () => void;
}

export function CallControls({ roomId, kind, session: s, perms, absentIds, onLeave }: CallControlsProps) {
  const settings = useCallSettings();
  const picked = useExternalStore(pickedRouteStore);
  const { width } = useWindowDimensions();
  // Six buttons on one row at any phone width (the screen pads 16 a side; tablets cap at 560).
  const gap = 10;
  const size = Math.max(40, Math.min(58, Math.floor((Math.min(width - 32, 560) - 5 * gap) / 6)));
  const micOff = s.selfMute || s.selfDeaf || s.serverMute || s.suppress;
  const deafened = s.selfDeaf || s.serverDeaf;
  const route = currentRoute(settings.speakerphone, picked);
  const canShare = screenShareSupported();

  const moreEntries = (): ActionSheetEntry[] => [
    s.camera && {
      key: 'flip',
      label: t('mobile.voice.flipCamera'),
      icon: 'camera-rotate',
      onSelect: () => switchCamera(),
    },
    canShare && {
      key: 'screen',
      label: s.screen ? t('voice.stopSharing') : t('voice.shareScreen'),
      icon: 'display',
      disabled: !perms.video,
      onSelect: () => (s.screen ? setScreenShareEnabled(false) : openScreenShareSheet()),
    },
    {
      key: 'noise',
      label: t('settings.voice.noise'),
      description: settings.noiseSuppression ? t('voice.noiseSuppressionOff') : t('voice.noiseSuppressionOn'),
      icon: 'wind',
      selected: settings.noiseSuppression,
      onSelect: () => toggleNoiseSuppression(),
    },
    kind === 'call' &&
      absentIds.length > 0 && {
        key: 'ring',
        label: t('voice.ringAgain'),
        icon: 'bell',
        onSelect: () =>
          ringMembers(roomId, [...absentIds]).catch(() => {
            toast.error(t('mobile.voice.actionFailed'));
          }),
      },
    {
      key: 'output',
      label: t('mobile.voice.audioOutput'),
      description: routeLabel(route),
      icon: routeIcon(route),
      onSelect: () => chooseAudioRoute(),
    },
    { key: 'stats', label: t('voice.stats.title'), icon: 'wave-square', onSelect: () => toggleVoiceStats() },
    'separator',
    { key: 'settings', label: t('settings.sections.voice.title'), icon: 'gear', onSelect: () => openUserSettings('voice') },
  ];

  return (
    <View style={{ alignItems: 'center', gap: 14 }}>
      {settings.inputMode === 'ptt' ? <PushToTalkButton disabled={micOff} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap, flexWrap: 'wrap' }}>
        <ControlButton
          testID="voice-camera"
          size={size}
          icon={s.camera ? 'video' : 'video-slash'}
          label={s.camera ? t('voice.cameraOff') : t('voice.cameraOn')}
          tone={s.camera ? 'on' : 'idle'}
          selected={s.camera}
          disabled={!perms.video}
          onPress={() => {
            haptics.toggle(!s.camera);
            void toggleCameraFromUi();
          }}
          onLongPress={
            s.camera
              ? () => {
                  haptics.longPress();
                  void switchCamera();
                }
              : undefined
          }
        />
        <ControlButton
          testID="voice-mute"
          size={size}
          icon={micOff ? 'microphone-slash' : 'microphone'}
          label={micOff ? t('voice.unmute') : t('voice.mute')}
          tone={micOff ? 'off' : 'idle'}
          selected={micOff}
          disabled={s.serverMute || s.suppress}
          onPress={() => {
            haptics.toggle(micOff);
            toggleMute();
          }}
        />
        <ControlButton
          testID="voice-deafen"
          size={size}
          icon={deafened ? 'volume-xmark' : 'headphones'}
          label={s.selfDeaf ? t('voice.undeafen') : t('voice.deafen')}
          tone={deafened ? 'off' : 'idle'}
          selected={s.selfDeaf}
          disabled={s.serverDeaf}
          onPress={() => {
            haptics.toggle(!s.selfDeaf);
            toggleDeafen();
          }}
        />
        <ControlButton
          testID="voice-speaker"
          size={size}
          icon={routeIcon(route)}
          label={`${t('mobile.voice.audioOutput')}: ${routeLabel(route)}`}
          tone={route === 'speaker' ? 'on' : 'idle'}
          selected={route === 'speaker'}
          onPress={() => void pressSpeakerButton()}
          onLongPress={() => {
            haptics.longPress();
            void chooseAudioRoute();
          }}
        />
        <ControlButton
          testID="voice-more"
          size={size}
          icon="ellipsis"
          label={t('mobile.ui.moreOptions')}
          onPress={() => {
            haptics.selection();
            void showActionSheet(moreEntries());
          }}
        />
        <ControlButton
          testID="voice-leave"
          size={size}
          icon="phone-slash"
          label={t('voice.leave')}
          tone="off"
          onPress={() => {
            haptics.impact('medium');
            onLeave?.();
            void leaveVoiceRoom();
          }}
        />
      </View>
    </View>
  );
}
