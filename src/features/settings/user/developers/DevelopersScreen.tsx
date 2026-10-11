/**
 * Developers (DevelopersSettingsPage, list view): the account's OAuth2 applications, a new
 * one, and the instance's developer documentation. Each application opens its own screen.
 */
import { useCallback, useRef, useState } from 'react';
import { router, useFocusEffect, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import { createApplication, listApplications } from '@web/api/developers';
import { Avatar, BotTag, EmptyState, ListSection, Spinner } from '@/ui';
import { Note, SettingItem } from '../../components/rows';
import { TextPromptSheet } from '../../components/sheets';
import { SettingsScreen } from '../../components/SettingsScreen';
import { useLoad } from '../../hooks/useLoad';
import { useLocale } from '../../hooks/useLocale';
import { developerAppPath } from '../../routes';
import { openDocs, stashSecret } from './shared';

export function DevelopersScreen() {
  useLocale();
  const apps = useLoad(() => listApplications());
  const [createOpen, setCreateOpen] = useState(false);

  // Back from an application (renamed, bot added, deleted): show the list as it now is.
  const reload = apps.reload;
  const focusedOnce = useRef(false);
  useFocusEffect(
    useCallback(() => {
      // The first focus is the mount, which already loaded.
      if (focusedOnce.current) void reload();
      focusedOnce.current = true;
    }, [reload]),
  );

  const list = apps.data ?? [];
  return (
    <SettingsScreen
      title={t('settings.sections.developers.title')}
      actions={[{ icon: 'plus', label: t('settings.developers.newApp'), onPress: () => setCreateOpen(true), testID: 'developers-new' }]}
      error={apps.error ? t('settings.developers.loadFailed') : ''}
      refreshing={apps.refreshing}
      onRefresh={() => void reload()}
      testID="settings-developers"
    >
      <Note>{t('settings.developers.intro')}</Note>
      <ListSection>
        <SettingItem icon="plus" title={t('settings.developers.newApp')} onPress={() => setCreateOpen(true)} />
        <SettingItem icon="book" title={t('settings.developers.docs')} chevron accessibilityRole="link" onPress={openDocs} />
      </ListSection>
      {apps.loading && !apps.data ? (
        <Spinner fill />
      ) : list.length === 0 ? (
        <EmptyState icon="fa-solid fa-code" title={t('settings.developers.empty')} />
      ) : (
        <ListSection>
          {list.map((app) => (
            <SettingItem
              key={app.id}
              leading={<Avatar uri={app.icon} name={app.name} size="lg" shape="rounded" />}
              title={app.name}
              titleAccessory={app.has_bot ? <BotTag bot /> : null}
              description={app.has_bot ? t('settings.developers.withBot') : t('settings.developers.noBot')}
              chevron
              onPress={() => router.push(developerAppPath(app.id) as Href)}
              testID={`developers-app-${app.id}`}
            />
          ))}
        </ListSection>
      )}

      <TextPromptSheet
        open={createOpen}
        title={t('settings.developers.newApp')}
        description={t('settings.developers.newAppHint')}
        icon="code"
        label={t('settings.developers.name')}
        placeholder={t('settings.developers.namePlaceholder')}
        maxLength={80}
        confirmLabel={t('settings.developers.create')}
        onConfirm={async (name) => {
          let app;
          try {
            app = await createApplication(name.trim());
          } catch {
            throw new Error(t('settings.developers.createFailed'));
          }
          apps.setData((prev) => [app, ...(prev ?? [])]);
          stashSecret(app.id, { labelKey: 'settings.developers.clientSecret', value: app.client_secret });
          setCreateOpen(false);
          router.push(developerAppPath(app.id) as Href);
        }}
        onClose={() => setCreateOpen(false)}
      />
    </SettingsScreen>
  );
}
