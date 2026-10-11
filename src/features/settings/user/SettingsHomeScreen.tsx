/**
 * Settings: the list of pages (the web's settings nav, as a grouped list), with a search box,
 * an account card on top and the app version underneath.
 *
 * The Instance group is shown only when the server says this account administers the
 * instance - asked on every open and failing closed, as the web's modal does.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router, type Href } from 'expo-router';
import * as Application from 'expo-application';
import { t } from '@web/i18n/t';
import { getInstanceCapabilities } from '@web/api/instance';
import { confirmDialog } from '@web/stores/confirmDialog';
import { useHandle, useMe } from '@/data';
import { signOut } from '@/platform/session';
import { ListSection, SearchInput, Text, UserAvatar } from '@/ui';
import { SettingItem } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { openAdminDashboard } from '../navigation';
import { userSettingsPath } from '../routes';
import { settingsGroups } from '../sections';

/** "Public beta · v1.2.3 (45)" - the app's own version, from the native build. */
export function appVersionLabel(): string {
  const version = Application.nativeApplicationVersion ?? '0.0.0';
  const build = Application.nativeBuildVersion;
  return t('mobile.settings.versionLine', { version: build ? `${version} (${build})` : version });
}

export function SettingsHomeScreen() {
  useLocale();
  const me = useMe();
  const handle = useHandle(me);
  const [query, setQuery] = useState('');
  const [instanceAdmin, setInstanceAdmin] = useState(false);

  useEffect(() => {
    let live = true;
    getInstanceCapabilities()
      .then((res) => live && setInstanceAdmin(res.instance_admin === true))
      .catch(() => live && setInstanceAdmin(false));
    return () => {
      live = false;
    };
  }, []);

  const groups = settingsGroups(query, { instanceAdmin });
  const name = me?.display_name || me?.username || '';

  async function logOut() {
    const ok = await confirmDialog({
      title: t('settings.profile.logOut'),
      body: t('mobile.settings.logOutConfirm'),
      confirmLabel: t('settings.profile.logOut'),
      tone: 'danger',
      icon: 'fa-solid fa-right-from-bracket',
    });
    if (ok) await signOut();
  }

  return (
    <SettingsScreen title={t('settings.title')} testID="settings-home">
      <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
        <SearchInput value={query} onValueChange={setQuery} placeholder={t('common.search')} accessibilityLabel={t('settings.searchAria')} />
      </View>

      {!query.trim() && me ? (
        <ListSection>
          <SettingItem
            leading={<UserAvatar userId={me.id} uri={me.avatar} name={name} size="lg" />}
            title={name}
            description={handle}
            chevron
            onPress={() => router.push(userSettingsPath('account') as Href)}
            accessibilityHint={t('mobile.settings.editProfileHint')}
            testID="settings-account-card"
          />
        </ListSection>
      ) : null}

      {groups.map((g) => (
        <ListSection key={g.id} title={g.label()}>
          {g.items.map((e) => (
            <SettingItem
              key={e.id}
              testID={`settings-nav-${e.id}`}
              icon={e.icon}
              title={e.label()}
              description={query.trim() ? e.description() : undefined}
              chevron
              onPress={() => router.push(userSettingsPath(e.id) as Href)}
            />
          ))}
          {g.id === 'instance' ? (
            <SettingItem
              icon="shield-halved"
              title={t('settings.instance.dashboard')}
              description={query.trim() ? t('settings.instance.dashboardHint') : undefined}
              chevron
              onPress={() => openAdminDashboard()}
              testID="settings-nav-admin"
            />
          ) : null}
        </ListSection>
      ))}

      {groups.length === 0 ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <Text tone="muted">{t('mobile.settings.noResults', { query: query.trim() })}</Text>
        </View>
      ) : null}

      {!query.trim() ? (
        <ListSection>
          <SettingItem icon="right-from-bracket" title={t('settings.profile.logOut')} destructive onPress={() => void logOut()} testID="settings-logout" />
        </ListSection>
      ) : null}

      <Text variant="caption" align="center" style={{ paddingHorizontal: 24, paddingTop: 4 }}>
        {appVersionLabel()}
      </Text>
    </SettingsScreen>
  );
}
