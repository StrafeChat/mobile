/**
 * The You tab (MobileYouPanel, plus what the web keeps in the desktop user popover): your
 * avatar, name, username and custom status; the four statuses; shortcuts to Friends (with the
 * incoming request count), Notes and Settings; and the account - edit profile, custom status,
 * switch accounts, the admin dashboard for instance administrators, copy your id, log out.
 *
 * Status and custom status changes are optimistic and roll back if the save fails
 * (ownPresence.ts). Friends and Notes open on the content side over the Home tab, so swiping
 * back lands on Home, not here - the web's behaviour.
 */
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { confirmDialog } from '@web/stores/confirmDialog';
import { useFriendRequestCount, useInstance, useMe, useSelfPresence } from '@/data';
import { signOut } from '@/platform/session';
import { openShellView } from '@/shell/state';
import { useTheme } from '@/theme';
import {
  Header,
  ListRow,
  ListSection,
  PresenceDot,
  Text,
  Touchable,
  UserAvatar,
  haptics,
  presenceColor,
  withAlpha,
} from '@/ui';
import { copyText } from '../actions';
import { openAccountSwitcher, openSettings } from '../links';
import { openAdminDashboard } from '../navigation';
import { openCustomStatusSheet } from '../sheets/store';
import { setOwnStatus, STATUS_OPTIONS } from './ownPresence';

function StatusGrid() {
  const theme = useTheme();
  const self = useSelfPresence();
  const [saving, setSaving] = useState(false);
  return (
    <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel={t('mobile.you.status')}>
      {STATUS_OPTIONS.map((status) => {
        const active = self.status === status;
        return (
          <Touchable
            key={status}
            accessibilityRole="radio"
            accessibilityLabel={t(`presence.${status}`)}
            accessibilityState={{ checked: active, disabled: saving }}
            disabled={saving}
            onPress={async () => {
              if (active) return;
              haptics.selection();
              setSaving(true);
              await setOwnStatus(status);
              setSaving(false);
            }}
            style={[
              styles.statusCell,
              {
                borderRadius: theme.radii.lg,
                borderColor: active ? withAlpha(theme.colors.primary, 0.4) : withAlpha(theme.colors.border, 0.7),
                backgroundColor: active ? withAlpha(theme.colors.primary, 0.1) : theme.colors.card,
                opacity: saving && !active ? 0.6 : 1,
              },
            ]}
          >
            <View style={[styles.statusDot, { backgroundColor: status === 'invisible' ? withAlpha(theme.colors.mutedForeground, 0.5) : presenceColor(theme, status) }]} />
            <Text variant="label" tone={active ? 'default' : 'muted'} numberOfLines={1} style={styles.flex}>
              {t(`presence.${status}`)}
            </Text>
          </Touchable>
        );
      })}
    </View>
  );
}

async function confirmLogOut(): Promise<void> {
  const name = auth.user?.display_name || auth.user?.username || '';
  const ok = await confirmDialog({
    title: t('settings.profile.logOut'),
    body: t('mobile.nav.logOutConfirm', { name }),
    confirmLabel: t('settings.profile.logOut'),
    tone: 'danger',
    icon: 'fa-solid fa-right-from-bracket',
  });
  if (ok) await signOut();
}

export function YouPanel({ bottomInset = 0 }: { bottomInset?: number }) {
  const theme = useTheme();
  const me = useMe();
  const self = useSelfPresence();
  const requests = useFriendRequestCount();
  const inst = useInstance();
  if (!me) return null;
  const name = me.display_name || me.username;
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <Header
        title={t('mobile.tabs.you')}
        safeTop={false}
        large
        actions={[{ icon: 'fa-gear', label: t('common.settings'), onPress: () => openSettings() }]}
      />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 24 + bottomInset }]}>
        <View style={styles.top}>
          <View style={styles.identity}>
            <UserAvatar userId={me.id} name={name} uri={me.avatar} size="xl" ringColor={theme.colors.background} />
            <View style={styles.flex}>
              <Text variant="title" numberOfLines={1}>
                {name}
              </Text>
              <Text tone="muted" numberOfLines={1}>
                {me.username}
              </Text>
            </View>
          </View>

          <Touchable
            onPress={openCustomStatusSheet}
            accessibilityLabel={self.custom_status ? `${t('userArea.customStatus')}: ${self.custom_status}` : t('userArea.setCustomStatus')}
            accessibilityHint={t('mobile.nav.editCustomStatusHint')}
            style={[styles.customStatus, { borderRadius: theme.radii.lg, backgroundColor: theme.colors.card, borderColor: theme.colors.border }]}
          >
            <PresenceDot status={self.status} size={10} />
            <Text tone={self.custom_status ? 'default' : 'muted'} numberOfLines={2} style={styles.flex}>
              {self.custom_status || t('userArea.setCustomStatus')}
            </Text>
          </Touchable>

          <Text variant="overline" style={styles.sectionLabel}>
            {t('mobile.you.status')}
          </Text>
          <StatusGrid />
        </View>

        <ListSection title={t('mobile.you.shortcuts')}>
          <ListRow
            title={t('nav.friends')}
            icon="fa-user-group"
            badge={requests || undefined}
            chevron
            onPress={() => openShellView({ kind: 'friends' })}
          />
          <ListRow title={t('nav.notes')} icon="fa-note-sticky" chevron onPress={() => openShellView({ kind: 'notes' })} />
          <ListRow title={t('common.settings')} icon="fa-gear" chevron onPress={() => openSettings()} />
        </ListSection>

        <ListSection title={t('mobile.nav.account')}>
          <ListRow title={t('userArea.editProfile')} icon="fa-pen" chevron onPress={() => openSettings('account')} />
          <ListRow title={t('desktop.accounts.switch')} icon="fa-users" chevron onPress={() => openAccountSwitcher()} />
          {inst.instanceAdmin ? (
            <ListRow title={t('userArea.adminDashboard')} icon="fa-shield-halved" chevron onPress={openAdminDashboard} />
          ) : null}
          <ListRow title={t('userArea.copyUsername')} icon="fa-copy" value={me.username} onPress={() => void copyText(me.username)} />
          <ListRow title={t('userArea.copyUserId')} icon="fa-id-card" onPress={() => void copyText(me.id)} />
          <ListRow title={t('settings.profile.logOut')} icon="fa-right-from-bracket" destructive onPress={() => void confirmLogOut()} />
        </ListSection>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  content: { paddingTop: 16, gap: 8 },
  /** Tablets get a readable column; ListSection brings its own side margins. */
  top: { paddingHorizontal: 16, gap: 12, marginBottom: 12 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  customStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sectionLabel: { marginTop: 8, paddingHorizontal: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusCell: {
    flexBasis: '47%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
});
