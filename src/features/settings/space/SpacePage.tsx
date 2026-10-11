/**
 * The frame of one space settings page: the screen (title, the space's name as subtitle, the
 * shared error banner), plus the gate - a page the viewer may not use (their role changed, a
 * stale deep link) explains itself instead of rendering controls the server would refuse, and
 * a space that went away (deleted, left) says so.
 */
import { useState, type ReactNode } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { t } from '@web/i18n/t';
import { useSpacesHydrated } from '@/data';
import { EmptyState, Spinner } from '@/ui';
import { SettingsScreen, type SettingsScreenProps } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import type { SpaceSettingsPageId } from '../routes';
import { pageAllowed, useSpaceSettings, type SpaceSettingsData } from './useSpaceSettings';

export function useSpaceIdParam(): string {
  const { spaceId } = useLocalSearchParams<{ spaceId: string }>();
  return Array.isArray(spaceId) ? (spaceId[0] ?? '') : (spaceId ?? '');
}

export function spacePageTitle(page: SpaceSettingsPageId): string {
  switch (page) {
    case 'overview':
      return t('spaceSettings.pages.general.title');
    case 'roles':
      return t('spaceSettings.rolesPerms');
    case 'emojis':
      return t('spaceSettings.emojis');
    default:
      return t(`spaceSettings.pages.${page}.title`);
  }
}

export interface SpacePageProps extends Omit<SettingsScreenProps, 'title' | 'children' | 'error' | 'onDismissError'> {
  page: SpaceSettingsPageId;
  title?: string;
  children: (data: SpaceSettingsData, ctx: { setError: (msg: string) => void }) => ReactNode;
}

export function SpacePage({ page, title, children, ...screen }: SpacePageProps) {
  useLocale();
  const spaceId = useSpaceIdParam();
  const data = useSpaceSettings(spaceId);
  const hydrated = useSpacesHydrated();
  const [error, setError] = useState('');
  const heading = title ?? spacePageTitle(page);

  let body: ReactNode;
  if (!data.space) {
    body = hydrated ? <EmptyState icon="fa-solid fa-layer-group" title={t('mobile.settings.spaceGone')} size="page" /> : <Spinner fill />;
  } else if (!pageAllowed(page, data.gates)) {
    body = <EmptyState icon="fa-solid fa-lock" title={t('mobile.settings.noPermission')} size="page" />;
  } else {
    body = children(data, { setError });
  }
  return (
    <SettingsScreen {...screen} title={heading} subtitle={data.space?.name} error={error} onDismissError={() => setError('')}>
      {body}
    </SettingsScreen>
  );
}
