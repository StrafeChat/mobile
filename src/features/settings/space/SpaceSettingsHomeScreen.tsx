/**
 * A space's settings: the page list (SpaceSettingsModal's nav) as a grouped list - the space's
 * own pages, then Moderation - showing only the pages the viewer may use; empty groups drop
 * out. The header carries the space's icon and name.
 */
import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import { useSpacesHydrated } from '@/data';
import { Avatar, EmptyState, ListSection, Spinner, Text } from '@/ui';
import { SettingItem, StatusPill } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { spaceSettingsPath, type SpaceSettingsPageId } from '../routes';
import { spacePageTitle, useSpaceIdParam } from './SpacePage';
import { pageAllowed, useSpaceSettings } from './useSpaceSettings';

const GENERAL: { id: SpaceSettingsPageId; icon: string }[] = [
  { id: 'overview', icon: 'sliders' },
  { id: 'system', icon: 'bullhorn' },
  { id: 'discover', icon: 'compass' },
  { id: 'roles', icon: 'shield-halved' },
  { id: 'emojis', icon: 'face-smile' },
];
const MODERATION: { id: SpaceSettingsPageId; icon: string }[] = [
  { id: 'moderation', icon: 'shield' },
  { id: 'members', icon: 'user-group' },
  { id: 'invites', icon: 'link' },
  { id: 'bans', icon: 'ban' },
  { id: 'audit', icon: 'clipboard-list' },
];

function description(id: SpaceSettingsPageId): string | undefined {
  const key = id === 'overview' ? 'general' : id;
  return id === 'moderation' ? t('mobile.settings.moderationDescription') : t(`spaceSettings.descriptions.${key}`);
}

export function SpaceSettingsHomeScreen() {
  useLocale();
  const spaceId = useSpaceIdParam();
  const data = useSpaceSettings(spaceId);
  const hydrated = useSpacesHydrated();
  const space = data.space;

  if (!space) {
    return (
      <SettingsScreen title={t('space.settings')}>
        {hydrated ? <EmptyState icon="fa-solid fa-layer-group" title={t('mobile.settings.spaceGone')} size="page" /> : <Spinner fill />}
      </SettingsScreen>
    );
  }

  const general = GENERAL.filter((p) => pageAllowed(p.id, data.gates));
  const moderation = MODERATION.filter((p) => pageAllowed(p.id, data.gates));
  const row = (p: { id: SpaceSettingsPageId; icon: string }) => (
    <SettingItem
      key={p.id}
      icon={p.icon}
      title={spacePageTitle(p.id)}
      description={description(p.id)}
      chevron
      onPress={() => router.push(spaceSettingsPath(spaceId, p.id) as Href)}
      testID={`space-settings-${p.id}`}
    />
  );

  return (
    <SettingsScreen title={t('space.settings')} testID="space-settings-home">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 16 }}>
        <Avatar uri={space.icon} name={space.name} size="xl" shape="rounded" />
        <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
          <Text variant="title" numberOfLines={2}>
            {space.name}
          </Text>
          {space.federation ? <StatusPill icon="globe" label={t('space.hostedOn', { domain: space.federation.origin_domain })} /> : null}
          {data.gates.isOwner ? <StatusPill icon="crown" label={t('room.members.owner')} tone="warning" /> : null}
        </View>
      </View>
      {general.length ? <ListSection title={space.name}>{general.map(row)}</ListSection> : null}
      {moderation.length ? <ListSection title={t('spaceSettings.groups.moderation')}>{moderation.map(row)}</ListSection> : null}
      {!general.length && !moderation.length ? <EmptyState icon="fa-solid fa-lock" title={t('mobile.settings.noPermission')} /> : null}
    </SettingsScreen>
  );
}
