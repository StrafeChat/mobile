/**
 * The per-participant voice sheet (the web's VoiceUserMenu as a bottom sheet), opened by a
 * long-press on a tile, a dock avatar or a voice row in the room list:
 *
 * - for someone else: their volume (0-200 %, applied as you drag and remembered on this
 *   device) and "Mute for me";
 * - their profile;
 * - in a space voice room, for moderators: server mute / deafen, move to another voice room
 *   and disconnect - shown with the permission (Mute / Deafen / Move Members) and never
 *   against the owner unless you are the owner. The server checks again. Unlike the web,
 *   a failure is reported (a toast), and disconnecting asks first.
 *
 * It closes when the person leaves the room.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { confirmDialog } from '@web/stores/confirmDialog';
import { spaces } from '@web/stores/spaces';
import { MAX_USER_VOLUME, disconnectMember, moveMember, serverDeafen, serverMute, setUserLocalMuted, setUserVolume } from '@web/stores/voice';
import { useSolid } from '@/bridge/solid';
import { useIsSpeaking } from '@/data/voice';
import { profileSubject } from '@/data/users';
import { presentProfileSheet } from '@/platform/presenters';
import { useTheme } from '@/theme';
import { Avatar, ListRow, ListSection, Sheet, Slider, Text, ToggleRow, haptics, toast, useExternalStore } from '@/ui';
import { callParticipantAvatar, callParticipantName, useRoomVoicePerms, useUserPlayback, useVoiceStateOf } from './hooks';
import { closeVoiceUserSheet, voiceUserSheetStore, type VoiceUserTarget } from './sheets';

const ROOM_TYPE_VOICE = 4;

/** Root-mounted (VoiceHosts). */
export function VoiceUserSheetHost() {
  const target = useExternalStore(voiceUserSheetStore);
  // Keep the last target while the sheet animates out.
  const [shown, setShown] = useState<VoiceUserTarget | null>(target);
  useEffect(() => {
    if (target) setShown(target);
  }, [target]);
  return (
    <Sheet
      open={!!target}
      onClose={() => {
        closeVoiceUserSheet();
        setShown(null);
      }}
      padded={false}
      testID="voice-user-sheet"
    >
      {shown ? <VoiceUserSheetBody key={`${shown.roomId}:${shown.userId}`} target={shown} /> : null}
    </Sheet>
  );
}

function VoiceUserSheetBody({ target }: { target: VoiceUserTarget }) {
  const theme = useTheme();
  const { userId, roomId } = target;
  const spaceId = target.spaceId ?? null;
  const meId = useSolid(() => auth.user?.id ?? null);
  const isSelf = userId === meId;
  const state = useVoiceStateOf(roomId, userId);
  const display = useSolid(
    () => {
      const st = state ?? { user_id: userId };
      return {
        name: callParticipantName(st, roomId, spaceId),
        avatar: callParticipantAvatar(st, roomId, spaceId),
      };
    },
    [state, userId, roomId, spaceId],
  );
  const speaking = useIsSpeaking(userId);
  const playback = useUserPlayback(userId);
  const perms = useRoomVoicePerms(spaceId, roomId);
  const ownerId = useSolid(() => (spaceId ? spaces.spaces.find((s) => s.id === spaceId)?.owner_id : undefined), [spaceId]);
  const otherVoiceRooms = useSolid(
    () =>
      spaceId
        ? (spaces.spaceRoomsBySpaceId[spaceId] ?? []).filter((r) => r.type === ROOM_TYPE_VOICE && r.id !== roomId).map((r) => ({ id: r.id, name: r.name }))
        : [],
    [spaceId, roomId],
  );
  const [volume, setVolume] = useState(playback.volume);
  const [page, setPage] = useState<'main' | 'move'>('main');
  const [busy, setBusy] = useState(false);

  // The target left the room: nothing to act on.
  useEffect(() => {
    if (!state) closeVoiceUserSheet();
  }, [state]);

  const canModerateTarget = !isSelf && (userId !== ownerId || meId === ownerId);
  const showModeration = !!spaceId && canModerateTarget && (perms.muteMembers || perms.deafenMembers || perms.moveMembers);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      haptics.success();
      closeVoiceUserSheet();
    } catch (err) {
      console.warn('[voice] moderation failed', err);
      toast.error(t('mobile.voice.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    const ok = await confirmDialog({
      title: t('mobile.voice.disconnectTitle', { name: display.name }),
      body: t('mobile.voice.disconnectBody'),
      confirmLabel: t('voice.menu.disconnect'),
      tone: 'danger',
      icon: 'fa-solid fa-phone-slash',
    });
    if (ok && spaceId) await run(() => disconnectMember(spaceId, userId));
  }

  const statusBits = [
    speaking ? t('mobile.voice.speaking') : null,
    state?.mute ? t('voice.status.serverMuted') : state?.self_mute ? t('voice.status.muted') : null,
    state?.deaf ? t('voice.status.serverDeafened') : state?.self_deaf ? t('voice.status.deafened') : null,
    state?.self_stream ? t('voice.status.streaming') : null,
    state?.priority_speaker ? t('voice.status.priority') : null,
  ].filter(Boolean);

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 }}>
      <View style={{ borderRadius: 24, borderWidth: 2, borderColor: speaking ? theme.colors.success : 'transparent' }}>
        <Avatar uri={display.avatar} name={display.name} size="lg" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="heading" numberOfLines={1} accessibilityRole="header">
          {display.name}
        </Text>
        {statusBits.length ? (
          <Text variant="caption" numberOfLines={2}>
            {statusBits.join(' · ')}
          </Text>
        ) : null}
      </View>
    </View>
  );

  if (page === 'move') {
    return (
      <View style={{ paddingBottom: 12 }}>
        <ListRow
          icon="chevron-left"
          title={t('common.back')}
          onPress={() => setPage('main')}
          accessibilityRole="button"
        />
        <ListSection title={t('voice.menu.move')} card={false}>
          {otherVoiceRooms.map((r) => (
            <ListRow
              key={r.id}
              icon="volume-high"
              title={r.name}
              disabled={busy}
              onPress={() => spaceId && void run(() => moveMember(spaceId, userId, r.id))}
            />
          ))}
        </ListSection>
      </View>
    );
  }

  return (
    <View style={{ paddingBottom: 12 }}>
      {header}
      {!isSelf ? (
        <View style={{ paddingHorizontal: 16, paddingBottom: 8, gap: 8 }}>
          <Slider
            testID="voice-user-volume"
            label={t('voice.menu.volume')}
            valueLabel={`${volume}%`}
            value={volume}
            min={0}
            max={MAX_USER_VOLUME}
            step={1}
            onValueChange={(v) => {
              setVolume(v);
              setUserVolume(userId, v);
            }}
          />
          <ToggleRow
            title={t('voice.menu.muteLocal')}
            icon={playback.localMuted ? 'volume-xmark' : 'volume-high'}
            value={playback.localMuted}
            onValueChange={(on) => setUserLocalMuted(userId, on)}
            testID="voice-user-local-mute"
          />
        </View>
      ) : null}
      <ListRow
        icon="user"
        title={t('mobile.voice.viewProfile')}
        chevron
        onPress={() => {
          closeVoiceUserSheet();
          presentProfileSheet({ subject: profileSubject(userId, { roomId, spaceId }), currentUserId: meId ?? undefined });
        }}
      />
      {showModeration ? (
        <ListSection title={t('spaceSettings.groups.moderation')} card={false}>
          {perms.muteMembers ? (
            <ListRow
              icon="microphone-slash"
              title={state?.mute ? t('voice.menu.serverUnmute') : t('voice.menu.serverMute')}
              disabled={busy}
              onPress={() => spaceId && void run(() => serverMute(spaceId, userId, !state?.mute))}
              testID="voice-user-server-mute"
            />
          ) : null}
          {perms.deafenMembers ? (
            <ListRow
              icon="volume-xmark"
              title={state?.deaf ? t('voice.menu.serverUndeafen') : t('voice.menu.serverDeafen')}
              disabled={busy}
              onPress={() => spaceId && void run(() => serverDeafen(spaceId, userId, !state?.deaf))}
            />
          ) : null}
          {perms.moveMembers && otherVoiceRooms.length > 0 ? (
            <ListRow icon="arrow-right-arrow-left" title={t('voice.menu.move')} chevron disabled={busy} onPress={() => setPage('move')} />
          ) : null}
          {perms.moveMembers ? (
            <ListRow icon="phone-slash" title={t('voice.menu.disconnect')} destructive disabled={busy} onPress={() => void disconnect()} />
          ) : null}
        </ListSection>
      ) : null}
    </View>
  );
}
