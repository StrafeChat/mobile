/**
 * The frame of a room settings page, and the page list itself (SpaceRoomSettingsModal's nav):
 * General, Encryption (text rooms), Voice (voice rooms), Permissions, and - mobile's common
 * entry point for them - Notifications. A section offers muting every room in it instead.
 */
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import { isRoomMuted, muteRoom, unmuteRoom } from '@web/lib/roomNotify';
import { useSolid } from '@/bridge/solid';
import { useRoomInfo, useSpacesHydrated } from '@/data';
import { spaces } from '@web/stores/spaces';
import { EmptyState, ListSection, Spinner, Text, haptics } from '@/ui';
import { SettingItem } from '../components/rows';
import { SettingsScreen, type SettingsScreenProps } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { roomSettingsPath, type RoomSettingsPageId } from '../routes';
import { ROOM_TYPE_SECTION, roomLabel, roomPages, useRoomIdParam, useRoomSettings, type RoomSettingsData } from './useRoomSettings';

const PAGE_ICON: Record<RoomSettingsPageId, string> = {
  general: 'sliders',
  encryption: 'lock',
  voice: 'volume-high',
  permissions: 'shield-halved',
  notifications: 'bell',
};

export function roomPageTitle(page: RoomSettingsPageId): string {
  if (page === 'permissions') return t('roomSettings.pages.overrides.title');
  if (page === 'notifications') return t('room.notify.title');
  return t(`roomSettings.pages.${page}.title`);
}

function roomPageDescription(page: RoomSettingsPageId, label: string): string {
  if (page === 'permissions') return t('roomSettings.pages.overrides.description', { room: label });
  if (page === 'notifications') return t('mobile.settings.roomNotifDescription');
  return t(`roomSettings.pages.${page}.description`, { room: label });
}

export interface RoomPageProps extends Omit<SettingsScreenProps, 'title' | 'children' | 'error' | 'onDismissError'> {
  page: RoomSettingsPageId;
  children: (data: RoomSettingsData, ctx: { setError: (msg: string) => void }) => ReactNode;
}

export function RoomPage({ page, children, ...screen }: RoomPageProps) {
  useLocale();
  const roomId = useRoomIdParam();
  const data = useRoomSettings(roomId);
  const hydrated = useSpacesHydrated();
  const info = useRoomInfo(roomId);
  const [error, setError] = useState('');
  const available = roomPages(data.room);

  let body: ReactNode;
  if (!data.room && !info) {
    body = hydrated ? <EmptyState icon="fa-solid fa-hashtag" title={t('mobile.settings.roomGone')} size="page" /> : <Spinner fill />;
  } else if (!available.includes(page)) {
    body = <EmptyState icon="fa-solid fa-ban" title={t('mobile.settings.noPermission')} size="page" />;
  } else {
    body = children(data, { setError });
  }
  return (
    <SettingsScreen {...screen} title={roomPageTitle(page)} subtitle={data.room ? roomLabel(data.room) : info?.name} error={error} onDismissError={() => setError('')}>
      {body}
    </SettingsScreen>
  );
}

function SectionMuteRow({ data }: { data: RoomSettingsData }) {
  const children = useSolid(
    () => (data.spaceId ? (spaces.spaceRoomsBySpaceId[data.spaceId] ?? []).filter((r) => r.parent_id === data.roomId).map((r) => ({ id: r.id, muted: isRoomMuted(r) })) : []),
    [data.spaceId, data.roomId],
  );
  const anyUnmuted = children.some((c) => !c.muted);
  if (children.length === 0) return null;
  return (
    <SettingItem
      icon={anyUnmuted ? 'bell-slash' : 'bell'}
      title={anyUnmuted ? t('mobile.settings.muteSection') : t('mobile.settings.unmuteSection')}
      description={t('mobile.settings.sectionMuteHint')}
      onPress={() => {
        haptics.selection();
        for (const c of children) void (anyUnmuted ? muteRoom(c.id, null) : unmuteRoom(c.id)).catch(() => undefined);
      }}
    />
  );
}

export function RoomSettingsHomeScreen() {
  useLocale();
  const roomId = useRoomIdParam();
  const data = useRoomSettings(roomId);
  const info = useRoomInfo(roomId);
  const hydrated = useSpacesHydrated();
  const room = data.room;
  const section = room?.type === ROOM_TYPE_SECTION;
  const label = room ? roomLabel(room) : (info?.name ?? '');
  const title = section ? t('space.sectionSettings') : t('space.roomSettings');

  if (!room && !info) {
    return (
      <SettingsScreen title={title}>
        {hydrated ? <EmptyState icon="fa-solid fa-hashtag" title={t('mobile.settings.roomGone')} size="page" /> : <Spinner fill />}
      </SettingsScreen>
    );
  }

  return (
    <SettingsScreen title={title} subtitle={data.space?.name} testID="room-settings-home">
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Text variant="title" numberOfLines={2}>
          {label}
        </Text>
      </View>
      <ListSection>
        {roomPages(room).map((p) => (
          <SettingItem
            key={p}
            icon={PAGE_ICON[p]}
            title={roomPageTitle(p)}
            description={roomPageDescription(p, label)}
            chevron
            onPress={() => router.push(roomSettingsPath(roomId, p) as Href)}
            testID={`room-settings-${p}`}
          />
        ))}
        {section ? <SectionMuteRow data={data} /> : null}
      </ListSection>
    </SettingsScreen>
  );
}
