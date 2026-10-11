/**
 * Space settings -> System (SpaceSystemPage): the system messages room and its join / leave
 * notices, the default notification level, the inactive voice room and timeout, and the
 * space widget (its JSON URL, and a live preview). Every control saves on change; the store's
 * copy of the space is replaced with the server's.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import {
  AFK_TIMEOUTS,
  SYSTEM_FLAG_SUPPRESS_JOIN,
  SYSTEM_FLAG_SUPPRESS_LEAVE,
  getSpaceWidget,
  patchSpace,
  spaceWidgetUrl,
  type PatchSpaceInput,
  type SpaceWidget,
} from '@web/api/spaces';
import { addOrUpdateSpace } from '@web/stores/spaces';
import { useTheme } from '@/theme';
import { Avatar, Button, ListSection, MONO_FONT, Select, Spinner, Text } from '@/ui';
import { FormCard, Note, SettingToggle, choiceRows } from '../components/rows';
import { useCopy } from '../hooks/useCopy';
import { SpacePage } from './SpacePage';
import type { SpaceSettingsData } from './useSpaceSettings';

const ROOM_TYPE_TEXT = 3;
const ROOM_TYPE_VOICE = 4;

/** The system_room_flags value after turning a notice on or off (the bits mean "suppressed"). */
export function withSystemNotice(flags: number, bit: number, on: boolean): number {
  return on ? flags & ~bit : flags | bit;
}

function WidgetPreview({ spaceId, tick, acronym }: { spaceId: string; tick: string; acronym: string }) {
  const theme = useTheme();
  const [widget, setWidget] = useState<SpaceWidget | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setWidget(undefined);
    getSpaceWidget(spaceId)
      .then((w) => live && setWidget(w))
      .catch(() => live && setWidget(null));
    return () => {
      live = false;
    };
  }, [spaceId, tick]);
  return (
    <View style={{ gap: 8 }}>
      <Text variant="overline">{t('spaceSettings.system.widgetPreview')}</Text>
      {widget === undefined ? (
        <Spinner />
      ) : widget === null ? (
        <Text tone="muted">{t('spaceSettings.system.widgetUnavailable')}</Text>
      ) : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: theme.radii.lg, borderWidth: 1, borderColor: theme.colors.border }}>
          <Avatar uri={widget.icon} name={widget.name || acronym} size="lg" shape="rounded" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text weight="semibold" numberOfLines={1}>
              {widget.name}
            </Text>
            <Text variant="caption">
              {t('spaceSettings.system.widgetOnline', { count: widget.presence_count })} · {t('spaceSettings.system.widgetMembers', { count: widget.member_count })}
            </Text>
          </View>
          {widget.instant_invite ? (
            <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: theme.radii.md, backgroundColor: theme.colors.primary }}>
              <Text variant="caption" weight="semibold" color={theme.colors.primaryForeground}>
                {t('spaceSettings.system.widgetJoin')}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

function System({ data, setError }: { data: SpaceSettingsData; setError: (m: string) => void }) {
  const theme = useTheme();
  const space = data.space!;
  const canManage = data.gates.canManageSpace;
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(0);
  const { copy, copied } = useCopy();
  const flags = space.system_room_flags ?? 0;
  const textRooms = data.rooms.filter((r) => r.type === ROOM_TYPE_TEXT);
  const voiceRooms = data.rooms.filter((r) => r.type === ROOM_TYPE_VOICE);
  const disabled = !canManage || busy;

  async function patch(body: PatchSpaceInput) {
    if (!canManage || busy) return;
    setBusy(true);
    setError('');
    try {
      addOrUpdateSpace(await patchSpace(data.spaceId, body));
      setSaved((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('common.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ListSection title={t('spaceSettings.system.messagesTitle')}>
        <View style={{ padding: 16 }}>
          <Select<string>
            label={t('spaceSettings.system.room')}
            value={space.system_room_id ?? ''}
            disabled={disabled}
            hint={t('spaceSettings.system.roomHint')}
            options={[{ value: '', label: t('spaceSettings.system.noRoom') }, ...textRooms.map((r) => ({ value: r.id, label: `#${r.name}` }))]}
            onValueChange={(v) => void patch({ system_room_id: v })}
          />
        </View>
        <SettingToggle
          icon="user-plus"
          title={t('spaceSettings.system.joinTitle')}
          description={t('spaceSettings.system.joinHint', { user: t('common.someone') })}
          value={(flags & SYSTEM_FLAG_SUPPRESS_JOIN) === 0}
          disabled={disabled || !space.system_room_id}
          onValueChange={(on) => void patch({ system_room_flags: withSystemNotice(flags, SYSTEM_FLAG_SUPPRESS_JOIN, on) })}
        />
        <SettingToggle
          icon="user-minus"
          title={t('spaceSettings.system.leaveTitle')}
          description={t('spaceSettings.system.leaveHint')}
          value={(flags & SYSTEM_FLAG_SUPPRESS_LEAVE) === 0}
          disabled={disabled || !space.system_room_id}
          onValueChange={(on) => void patch({ system_room_flags: withSystemNotice(flags, SYSTEM_FLAG_SUPPRESS_LEAVE, on) })}
        />
      </ListSection>

      <ListSection title={t('spaceSettings.system.notifTitle')} footer={t('spaceSettings.system.notifHint')}>
        {choiceRows<number>({
          value: space.default_message_notifications ?? 0,
          disabled,
          onChange: (v) => void patch({ default_message_notifications: v }),
          options: [
            { value: 0, icon: 'comments', title: t('spaceSettings.system.notifAll'), description: t('spaceSettings.system.notifAllHint') },
            { value: 1, icon: 'at', title: t('spaceSettings.system.notifMentions'), description: t('spaceSettings.system.notifMentionsHint') },
          ],
        })}
      </ListSection>

      <ListSection title={t('spaceSettings.system.afkTitle')} footer={t('spaceSettings.system.afkHint')}>
        <View style={{ padding: 16, gap: 12 }}>
          <Select<string>
            label={t('spaceSettings.system.afkRoom')}
            value={space.afk_room_id ?? ''}
            disabled={disabled}
            options={[{ value: '', label: t('spaceSettings.system.noAfkRoom') }, ...voiceRooms.map((r) => ({ value: r.id, label: r.name }))]}
            onValueChange={(v) => void patch({ afk_room_id: v })}
          />
          <Select<string>
            label={t('spaceSettings.system.afkTimeout')}
            value={String(space.afk_timeout || 300)}
            disabled={disabled || !space.afk_room_id}
            options={AFK_TIMEOUTS.map((s) => ({ value: String(s), label: t('spaceSettings.system.minutes', { count: s / 60 }) }))}
            onValueChange={(v) => void patch({ afk_timeout: Number(v) })}
          />
        </View>
      </ListSection>

      <ListSection title={t('mobile.settings.widgetTitle')}>
        <SettingToggle
          icon="window-restore"
          title={t('mobile.settings.widgetEnable')}
          description={t('spaceSettings.system.widgetEnableHint')}
          value={space.widget_enabled === true}
          disabled={disabled}
          onValueChange={(on) => void patch({ widget_enabled: on })}
        />
        <View style={{ padding: 16 }}>
          <Select<string>
            label={t('spaceSettings.system.widgetRoom')}
            value={space.widget_room_id ?? ''}
            disabled={disabled || !space.widget_enabled}
            options={[{ value: '', label: t('spaceSettings.system.widgetNoInvite') }, ...textRooms.map((r) => ({ value: r.id, label: `#${r.name}` }))]}
            onValueChange={(v) => void patch({ widget_room_id: v })}
          />
        </View>
      </ListSection>
      {space.widget_enabled ? (
        <FormCard style={{ marginBottom: 16 }}>
          <View style={{ gap: 6 }}>
            <Text variant="label">{t('spaceSettings.system.widgetUrl')}</Text>
            <Text selectable style={{ fontFamily: MONO_FONT, fontSize: theme.font(12), padding: 10, borderRadius: theme.radii.md, backgroundColor: theme.colors.muted }}>
              {spaceWidgetUrl(data.spaceId)}
            </Text>
            <Button
              title={copied('widget') ? t('common.copied') : t('common.copy')}
              icon={copied('widget') ? 'check' : 'copy'}
              variant="outline"
              size="sm"
              style={{ alignSelf: 'flex-start' }}
              onPress={() => void copy('widget', spaceWidgetUrl(data.spaceId))}
            />
            <Text variant="caption">{t('spaceSettings.system.widgetUrlHint')}</Text>
          </View>
          <WidgetPreview spaceId={data.spaceId} tick={`${space.widget_room_id ?? ''}:${saved}`} acronym={space.initials} />
        </FormCard>
      ) : null}
      {busy ? <Note>{t('common.loading')}</Note> : null}
    </>
  );
}

export function SpaceSystemScreen() {
  return <SpacePage page="system">{(data, { setError }) => <System data={data} setError={setError} />}</SpacePage>;
}
