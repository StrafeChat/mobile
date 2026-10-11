/**
 * Room settings pages (SpaceRoomSettingsModal): General (name; topic and slowmode for text),
 * Encryption (the opt-in E2EE switch for space text rooms, with what it changes), Voice (user
 * limit and bitrate), and Notifications (the per-room notify mode and mute, RoomNotifyMenu's
 * options, which also serve PMs and groups).
 *
 * Saving General, Encryption or Voice refreshes the space's rooms and goes back, as the web
 * modal closes. Inputs are disabled without Manage Rooms.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { formatDate, t } from '@web/i18n/t';
import { patchSpaceRoom } from '@web/api/spaces';
import { refreshSpaceRooms, spaces } from '@web/stores/spaces';
import { rooms } from '@web/stores/rooms';
import { NotifyModeAll, NotifyModeDefault, NotifyModeMentions, NotifyModeNone, isRoomMuted, muteRoom, setRoomNotifyMode, unmuteRoom } from '@web/lib/roomNotify';
import { useSolid } from '@/bridge/solid';
import { useRoomNotifySettings } from '@/data';
import { useTheme } from '@/theme';
import { Button, Icon, Input, ListSection, SegmentedControl, Select, Text, withAlpha } from '@/ui';
import { LiveSlider } from '../components/LiveSlider';
import { FormCard, Note, SettingItem, SettingToggle, choiceRows } from '../components/rows';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import { RoomPage } from './RoomPage';
import { ROOM_TYPE_TEXT, type RoomSettingsData } from './useRoomSettings';

/** Bitrate presets in bits per second (the web's BITRATE_OPTIONS). */
export const BITRATE_OPTIONS = [8_000, 16_000, 32_000, 64_000, 96_000, 128_000, 256_000, 384_000] as const;

/** Slowmode presets offered beside the number field, seconds. */
export const SLOWMODE_PRESETS = [0, 5, 10, 30, 60, 300, 900, 3600] as const;

/** The web's slowmode rule: a whole number of seconds, 0 or more; null when invalid. */
export function parseSlowmode(raw: string): number | null {
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) || n < 0 ? null : n;
}

function slowmodeLabel(s: number): string {
  if (s === 0) return t('mobile.settings.slowmodeOff');
  if (s < 60) return t('mobile.settings.seconds', { count: s });
  if (s < 3600) return t('spaceSettings.system.minutes', { count: s / 60 });
  return t('spaceSettings.invites.hours', { count: s / 3600 });
}

function back(): void {
  if (router.canGoBack()) router.back();
}

function General({ data, setError }: { data: RoomSettingsData; setError: (m: string) => void }) {
  const room = data.room!;
  const isText = room.type === ROOM_TYPE_TEXT;
  const [name, setName] = useState(room.name ?? '');
  const [topic, setTopic] = useState(room.topic ?? '');
  const [slowmode, setSlowmode] = useState(String(room.slowmode_seconds ?? 0));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const dirty = name !== (room.name ?? '') || (isText && (topic !== (room.topic ?? '') || slowmode !== String(room.slowmode_seconds ?? 0)));
  useUnsavedGuard(dirty && data.canManageRooms && !done);
  useEffect(() => {
    if (done) back();
  }, [done]);

  async function save() {
    if (!data.spaceId || !data.canManageRooms) return;
    const slow = parseSlowmode(slowmode);
    if (isText && slow === null) {
      setError(t('roomSettings.slowmodeInvalid'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await patchSpaceRoom(data.spaceId, room.id, {
        name: name.trim() || 'unnamed',
        ...(isText ? { topic: topic.trim(), slowmode_seconds: slow ?? 0 } : {}),
      });
      void refreshSpaceRooms(data.spaceId).catch(() => undefined);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roomSettings.saveFailed'));
      setBusy(false);
    }
  }

  const disabled = !data.canManageRooms || busy;
  return (
    <FormCard>
      <Input label={t('createRoom.name')} value={name} onChangeText={setName} disabled={disabled} maxLength={100} testID="room-name" />
      {isText ? (
        <>
          <Input label={t('roomSettings.topic')} value={topic} placeholder={t('roomSettings.topicPlaceholder')} onChangeText={setTopic} disabled={disabled} maxLength={1024} />
          <View style={{ gap: 8 }}>
            <Input
              label={t('roomSettings.slowmode')}
              value={slowmode}
              onChangeText={setSlowmode}
              keyboardType="number-pad"
              disabled={disabled}
              error={parseSlowmode(slowmode) === null ? t('roomSettings.slowmodeInvalid') : undefined}
              testID="room-slowmode"
            />
            <SegmentedControl<string>
              size="sm"
              scrollable
              value={String(parseSlowmode(slowmode) ?? -1)}
              onChange={(v) => setSlowmode(v)}
              accessibilityLabel={t('roomSettings.slowmode')}
              items={SLOWMODE_PRESETS.map((s) => ({ id: String(s), label: slowmodeLabel(s), disabled }))}
            />
          </View>
        </>
      ) : null}
      <Button title={t('roomSettings.save')} loading={busy} disabled={!data.canManageRooms || !dirty} onPress={() => void save()} testID="room-general-save" />
    </FormCard>
  );
}

export function RoomGeneralScreen() {
  return <RoomPage page="general">{(data, { setError }) => <General data={data} setError={setError} />}</RoomPage>;
}

function Encryption({ data, setError }: { data: RoomSettingsData; setError: (m: string) => void }) {
  const theme = useTheme();
  const room = data.room!;
  const stored = room.e2ee_enabled === true;
  const [on, setOn] = useState(stored);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const dirty = on !== stored;
  useEffect(() => {
    if (done) back();
  }, [done]);

  async function save() {
    if (!data.spaceId || !data.canManageRooms || !dirty) return;
    setBusy(true);
    setError('');
    try {
      await patchSpaceRoom(data.spaceId, room.id, { e2ee_enabled: on });
      void refreshSpaceRooms(data.spaceId).catch(() => undefined);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roomSettings.encryptionFailed'));
      setBusy(false);
    }
  }

  return (
    <>
      <ListSection>
        <SettingToggle
          leading={
            <View style={{ width: 32, height: 32, borderRadius: theme.radii.md, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? withAlpha(theme.colors.primary, 0.15) : theme.colors.muted }}>
              <Icon name={on ? 'lock' : 'lock-open'} size={14} color={on ? theme.colors.primary : theme.colors.mutedForeground} />
            </View>
          }
          title={t('room.groupSettings.e2ee')}
          description={on ? t('roomSettings.e2eeOnHint') : t('roomSettings.e2eeOffHint')}
          value={on}
          disabled={!data.canManageRooms || busy}
          onValueChange={setOn}
          testID="room-e2ee"
        />
      </ListSection>
      <ListSection title={t('roomSettings.e2eeWhatChanges')}>
        <View style={{ padding: 16, gap: 10 }}>
          {['roomSettings.e2eePoint1', 'roomSettings.e2eePoint2', 'roomSettings.e2eePoint3', 'roomSettings.e2eePoint4'].map((k) => (
            <View key={k} style={{ flexDirection: 'row', gap: 8 }}>
              <Text tone="muted">•</Text>
              <Text variant="caption" style={{ flex: 1 }}>
                {t(k)}
              </Text>
            </View>
          ))}
        </View>
      </ListSection>
      <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 12 }}>
        {dirty ? <Button title={t('common.revert')} variant="outline" style={{ flex: 1 }} disabled={busy} onPress={() => setOn(stored)} /> : null}
        <Button
          title={on ? t('roomSettings.turnOnEncryption') : t('roomSettings.turnOffEncryption')}
          style={{ flex: 1 }}
          loading={busy}
          disabled={!data.canManageRooms || !dirty}
          onPress={() => void save()}
          testID="room-e2ee-save"
        />
      </View>
    </>
  );
}

export function RoomEncryptionScreen() {
  return <RoomPage page="encryption">{(data, { setError }) => <Encryption data={data} setError={setError} />}</RoomPage>;
}

function Voice({ data, setError }: { data: RoomSettingsData; setError: (m: string) => void }) {
  const room = data.room!;
  const [limit, setLimit] = useState(room.user_limit ?? 0);
  const [bitrate, setBitrate] = useState(room.bitrate || 64_000);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const dirty = (room.user_limit ?? 0) !== limit || (room.bitrate || 64_000) !== bitrate;
  useUnsavedGuard(dirty && data.canManageRooms && !done);
  useEffect(() => {
    if (done) back();
  }, [done]);

  async function save() {
    if (!data.spaceId || !data.canManageRooms || !dirty) return;
    setBusy(true);
    setError('');
    try {
      await patchSpaceRoom(data.spaceId, room.id, { user_limit: limit, bitrate });
      void refreshSpaceRooms(data.spaceId).catch(() => undefined);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roomSettings.saveFailed'));
      setBusy(false);
    }
  }

  const disabled = !data.canManageRooms || busy;
  return (
    <FormCard>
      <LiveSlider
        label={t('roomSettings.userLimit')}
        min={0}
        max={99}
        value={limit}
        format={(v) => (v === 0 ? t('roomSettings.unlimited') : t('roomSettings.userLimitValue', { count: v }))}
        onCommit={setLimit}
        disabled={disabled}
      />
      <Text variant="caption">{t('roomSettings.userLimitHint')}</Text>
      <Select<string>
        label={t('roomSettings.bitrate')}
        value={String(bitrate)}
        disabled={disabled}
        hint={t('roomSettings.bitrateHint')}
        options={BITRATE_OPTIONS.map((b) => ({ value: String(b), label: `${b / 1000} kbps` }))}
        onValueChange={(v) => setBitrate(Number(v))}
      />
      <Button title={t('roomSettings.save')} loading={busy} disabled={disabled || !dirty} onPress={() => void save()} />
    </FormCard>
  );
}

export function RoomVoiceScreen() {
  return <RoomPage page="voice">{(data, { setError }) => <Voice data={data} setError={setError} />}</RoomPage>;
}

const MUTE_DURATIONS: { key: string; ms: number | null }[] = [
  { key: '15m', ms: 15 * 60 * 1000 },
  { key: '1h', ms: 60 * 60 * 1000 },
  { key: '8h', ms: 8 * 60 * 60 * 1000 },
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: 'forever', ms: null },
];

/** The room's own mute fields, wherever the store keeps it (a PM or a space room). */
function useMuteState(roomId: string): { muted: boolean; until: string | null } {
  return useSolid(() => {
    const r = rooms.rooms.find((x) => x.id === roomId) ?? Object.values(spaces.spaceRoomsBySpaceId).flat().find((x) => x.id === roomId);
    if (!r) return { muted: false, until: null };
    return { muted: isRoomMuted(r), until: r.muted ? null : (r.muted_until ?? null) };
  }, [roomId]);
}

function Notifications({ data, setError }: { data: RoomSettingsData; setError: (m: string) => void }) {
  const settings = useRoomNotifySettings(data.roomId, data.spaceId);
  const mute = useMuteState(data.roomId);
  const run = (p: Promise<void>) =>
    void p.catch((e: unknown) => setError(e instanceof Error ? e.message : t('common.saveFailed')));

  return (
    <>
      <ListSection title={t('room.notify.title')}>
        {choiceRows<number>({
          value: settings.notifyMode,
          testIDPrefix: 'room-notify',
          onChange: (mode) => run(setRoomNotifyMode(data.roomId, mode)),
          options: [NotifyModeDefault, NotifyModeAll, NotifyModeMentions, NotifyModeNone].map((m) => ({
            value: m,
            title: t(`room.notify.modes.${m}`),
            description: m === NotifyModeDefault ? t('mobile.settings.notifyDefaultHint', { mode: t(`mobile.settings.effective.${settings.effective}`) }) : undefined,
          })),
        })}
      </ListSection>
      <ListSection title={t('room.notify.muteSection')}>
        {mute.muted ? (
          <SettingItem
            icon="bell"
            title={t('room.notify.unmute')}
            description={mute.until ? t('mobile.settings.mutedUntil', { when: formatDate(mute.until, { dateStyle: 'medium', timeStyle: 'short' }) }) : t('mobile.settings.mutedIndefinitely')}
            onPress={() => run(unmuteRoom(data.roomId))}
            testID="room-unmute"
          />
        ) : (
          MUTE_DURATIONS.map((d) => (
            <SettingItem key={d.key} icon="bell-slash" title={t(`room.notify.duration.${d.key}`)} onPress={() => run(muteRoom(data.roomId, d.ms))} testID={`room-mute-${d.key}`} />
          ))
        )}
      </ListSection>
      <Note>{t('mobile.settings.roomNotifNote')}</Note>
    </>
  );
}

export function RoomNotificationsScreen() {
  return <RoomPage page="notifications">{(data, { setError }) => <Notifications data={data} setError={setError} />}</RoomPage>;
}

