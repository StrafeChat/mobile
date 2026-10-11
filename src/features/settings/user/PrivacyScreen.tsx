/**
 * Privacy & safety - the mobile home for settings the web spreads over several places, all of
 * them the same shared state: the people you have blocked (with unblock; the web shows them on
 * the Friends page), whether notifications show message text, link previews in encrypted
 * chats (off by default: making one sends the link to the server), and showing your birthday.
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '@web/i18n/t';
import { unblockUser } from '@web/api/relationships';
import { removeRelationshipLocally } from '@web/stores/relationships';
import { setNotificationPrefs } from '@web/stores/notificationPrefs';
import { setLinkPreviewsInEncrypted } from '@web/stores/settings';
import { confirmDialog } from '@web/stores/confirmDialog';
import { getMe, patchMe, toAuthUser } from '@web/api/users';
import { auth, setAuthUser } from '@web/stores/auth';
import { formatHandle } from '@web/stores/instance';
import { useFriendIds, useNotificationPrefs, useRelationship, useSettings } from '@/data';
import { Avatar, Button, ListSection } from '@/ui';
import { Note, SettingItem, SettingToggle } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';

function BlockedRow({ userId }: { userId: string }) {
  const rel = useRelationship(userId);
  const [busy, setBusy] = useState(false);
  const user = rel?.user;
  const name = user?.display_name || user?.username || userId;

  async function unblock() {
    const ok = await confirmDialog({ title: t('userMenu.unblock'), body: t('mobile.settings.unblockConfirm', { name }), confirmLabel: t('userMenu.unblock') });
    if (!ok) return;
    setBusy(true);
    try {
      await unblockUser(userId);
      removeRelationshipLocally(userId);
    } catch {
      setBusy(false);
    }
  }

  return (
    <SettingItem
      leading={<Avatar uri={user?.avatar} name={name} size="lg" />}
      title={name}
      description={user ? formatHandle(user) : undefined}
      trailing={<Button title={t('userMenu.unblock')} size="sm" variant="outline" loading={busy} onPress={() => void unblock()} />}
    />
  );
}

export function PrivacyScreen() {
  useLocale();
  const blocked = useFriendIds('blocked');
  const prefs = useNotificationPrefs();
  const settings = useSettings();
  const [birthdayOptIn, setBirthdayOptIn] = useState(auth.user?.birthday_opt_in === true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // A flip made before the profile arrived wins over that (older) answer.
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    getMe()
      .then((me) => live && !touched.current && setBirthdayOptIn(me.birthday_opt_in === true))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function toggleBirthday(next: boolean) {
    touched.current = true;
    setBusy(true);
    setError('');
    try {
      const me = await patchMe({ birthday_opt_in: next });
      setBirthdayOptIn(me.birthday_opt_in === true);
      const u = auth.user;
      if (u) setAuthUser({ ...u, ...toAuthUser(me) });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.profile.birthdaySaveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsScreen title={t('mobile.settings.privacyTitle')} testID="settings-privacy">
      <ListSection title={t('mobile.settings.privacyControls')}>
        <SettingToggle
          icon="eye"
          title={t('settings.notifications.preview')}
          description={t('settings.notifications.previewHint')}
          value={prefs.preview}
          onValueChange={(on) => setNotificationPrefs({ preview: on })}
        />
        <SettingToggle
          icon="link"
          title={t('settings.appearance.chat.linkPreviewsEncrypted')}
          description={t('settings.appearance.chat.linkPreviewsEncryptedDescription')}
          value={!!settings.linkPreviewsInEncrypted}
          onValueChange={setLinkPreviewsInEncrypted}
        />
        <SettingToggle
          icon="cake-candles"
          title={t('settings.profile.birthdayShow')}
          description={t('settings.profile.birthdayShowHint')}
          error={error}
          value={birthdayOptIn}
          busy={busy}
          onValueChange={(on) => void toggleBirthday(on)}
        />
      </ListSection>

      <ListSection title={t('friends.sections.blocked', { count: blocked.length })}>
        {blocked.length === 0 ? (
          <SettingItem icon="user-slash" title={t('friends.empty.blockedTitle')} description={t('friends.empty.blockedBody')} />
        ) : (
          blocked.map((id) => <BlockedRow key={id} userId={id} />)
        )}
      </ListSection>
      <Note>{t('mobile.settings.blockHint')}</Note>
    </SettingsScreen>
  );
}
