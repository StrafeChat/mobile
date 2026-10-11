/**
 * My Account: the profile editor (ProfileSettingsPage).
 *
 * - Banner and avatar upload straight away, independent of the draft (camera or library,
 *   the web's image-type and 8 MB checks).
 * - Display name, pronouns, about me and bio are a draft saved from the header; leaving with
 *   unsaved edits asks first.
 * - The bio has an Edit / Preview switch rendering exactly what the full profile shows.
 * - The birthday switch saves the moment it flips, outside the draft (a discarded profile
 *   edit must not undo it, nor it the draft).
 *
 * One deliberate difference from the web: an emptied bio or about me is sent as "" so it is
 * cleared (the server accepts that), where the web sends nothing and the old text stays. An
 * emptied display name is still left out, as on the web: names fall back to the username.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { getMe, patchMe, toAuthUser, uploadAvatar, uploadBanner, type MeResponse } from '@web/api/users';
import { auth, setAuthUser } from '@web/stores/auth';
import { formatBirthday } from '@web/lib/utils/birthday';
import { useMe } from '@/data';
import { signOut } from '@/platform/session';
import { confirmDialog } from '@web/stores/confirmDialog';
import { Button, Input, ListSection, MONO_FONT, SegmentedControl, Text, TextArea, UserPresenceDot, toast } from '@/ui';
import { useTheme } from '@/theme';
import { BioPreview } from '../components/BioPreview';
import { MediaHeader } from '../components/MediaHeader';
import { FormCard, SectionTitle, SettingItem, SettingToggle } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { useCopy } from '../hooks/useCopy';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import { PROFILE_IMAGE_MAX_BYTES, asUploadFile, pickImage } from '../hooks/pickImage';

/** Server limits (equinox users/schema.go). */
export const PROFILE_LIMITS = { displayName: 32, pronouns: 40, aboutMe: 190, bio: 190 } as const;

export interface ProfileDraft {
  displayName: string;
  pronouns: string;
  aboutMe: string;
  bio: string;
}

/** The PATCH body for a profile draft (see the file comment for the clearing rules). */
export function profilePatch(d: ProfileDraft): { display_name?: string; bio: string; about_me: string; pronouns: string } {
  const name = d.displayName.trim();
  return {
    ...(name ? { display_name: name } : {}),
    bio: d.bio.trim(),
    about_me: d.aboutMe.trim(),
    pronouns: d.pronouns.trim(),
  };
}

function draftFrom(me: Partial<MeResponse> | null | undefined): ProfileDraft {
  return {
    displayName: me?.display_name || me?.username || '',
    pronouns: me?.pronouns ?? '',
    aboutMe: me?.about_me ?? '',
    bio: me?.bio ?? '',
  };
}

function mergeMe(me: MeResponse): void {
  const u = auth.user;
  if (u) setAuthUser({ ...u, ...toAuthUser(me) });
}

export function AccountScreen() {
  useLocale();
  const theme = useTheme();
  const me = useMe();
  const { copy, copied } = useCopy();
  const [draft, setDraft] = useState<ProfileDraft>(() => draftFrom(me));
  const [saved, setSaved] = useState<ProfileDraft>(() => draftFrom(me));
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileError, setProfileError] = useState('');
  const [bioTab, setBioTab] = useState<'edit' | 'preview'>('edit');
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [bannerBusy, setBannerBusy] = useState(false);
  const [mediaError, setMediaError] = useState('');
  const [birthday, setBirthday] = useState<string | undefined>(me?.birthday);
  const [birthdayOptIn, setBirthdayOptIn] = useState(me?.birthday_opt_in === true);
  const [birthdayBusy, setBirthdayBusy] = useState(false);
  const [birthdayError, setBirthdayError] = useState('');

  useUnsavedGuard(dirty && !saving);

  useEffect(() => {
    let live = true;
    getMe()
      .then((res) => {
        if (!live) return;
        const d = draftFrom(res);
        setDraft(d);
        setSaved(d);
        setBirthday(res.birthday);
        setBirthdayOptIn(res.birthday_opt_in === true);
        mergeMe(res);
        setDirty(false);
      })
      .catch(() => {
        if (!live) return;
        const u = auth.user;
        setBirthday(u?.birthday);
        setBirthdayOptIn(u?.birthday_opt_in === true);
      });
    return () => {
      live = false;
    };
  }, []);

  const edit = useCallback((patch: Partial<ProfileDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    // As on the web: any keystroke marks the draft dirty, even one that is undone.
    setDirty(true);
  }, []);

  async function save() {
    if (!auth.user || saving) return;
    setProfileError('');
    setSaving(true);
    try {
      const res = await patchMe(profilePatch(draft));
      mergeMe(res);
      const d = draftFrom(res);
      setDraft(d);
      setSaved(d);
      setDirty(false);
      toast.success(t('mobile.settings.profileSaved'));
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : t('settings.profile.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function toggleBirthday(next: boolean) {
    if (birthdayBusy) return;
    setBirthdayBusy(true);
    setBirthdayError('');
    try {
      const res = await patchMe({ birthday_opt_in: next });
      setBirthdayOptIn(res.birthday_opt_in === true);
      mergeMe(res);
    } catch (err) {
      setBirthdayError(err instanceof Error ? err.message : t('settings.profile.birthdaySaveFailed'));
    } finally {
      setBirthdayBusy(false);
    }
  }

  async function changeImage(kind: 'avatar' | 'banner') {
    const pick = await pickImage({ title: kind === 'avatar' ? t('mobile.settings.changeAvatar') : t('mobile.settings.changeBanner'), maxBytes: PROFILE_IMAGE_MAX_BYTES });
    if (pick.status === 'cancelled') return;
    if (pick.status === 'error') {
      setMediaError(pick.message);
      return;
    }
    setMediaError('');
    const setBusy = kind === 'avatar' ? setAvatarBusy : setBannerBusy;
    setBusy(true);
    try {
      const res = kind === 'avatar' ? await uploadAvatar(asUploadFile(pick.file)) : await uploadBanner(asUploadFile(pick.file));
      mergeMe(res);
    } catch (err) {
      setMediaError(err instanceof Error ? err.message : t('settings.profile.uploadFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function logOut(everywhere: boolean) {
    const ok = await confirmDialog({
      title: everywhere ? t('mobile.settings.logOutEverywhere') : t('settings.profile.logOut'),
      body: everywhere ? t('mobile.settings.logOutEverywhereConfirm') : t('mobile.settings.logOutConfirm'),
      confirmLabel: everywhere ? t('mobile.settings.logOutEverywhere') : t('settings.profile.logOut'),
      tone: 'danger',
      icon: 'fa-solid fa-right-from-bracket',
    });
    if (ok) await signOut({ everywhere });
  }

  const birthdayLabel = useMemo(() => formatBirthday(birthday), [birthday]);
  const name = draft.displayName || me?.display_name || me?.username || '';
  const discardable = dirty && JSON.stringify(draft) !== JSON.stringify(saved);

  return (
    <SettingsScreen
      title={t('settings.sections.account.title')}
      testID="settings-account"
      right={
        dirty ? (
          <Button
            title={t('common.save')}
            size="sm"
            icon="check"
            loading={saving}
            onPress={() => void save()}
            accessibilityHint={discardable ? t('mobile.settings.unsavedHint') : undefined}
            testID="account-save"
          />
        ) : null
      }
    >
      <SectionTitle title={t('settings.profile.mediaTitle')} />
      <MediaHeader
        name={name}
        avatarUri={me?.avatar}
        bannerUri={me?.banner}
        onPickAvatar={() => void changeImage('avatar')}
        onPickBanner={() => void changeImage('banner')}
        avatarBusy={avatarBusy}
        bannerBusy={bannerBusy}
        avatarOverlay={me ? <UserPresenceDot userId={me.id} size={18} ringColor={theme.colors.card} /> : undefined}
        hint={t('mobile.settings.mediaHint')}
        error={mediaError}
      >
        <Text variant="heading" numberOfLines={1}>
          {name}
        </Text>
        {draft.pronouns.trim() ? (
          <Text variant="caption" numberOfLines={1}>
            {draft.pronouns.trim()}
          </Text>
        ) : null}
      </MediaHeader>

      <SectionTitle title={t('settings.profile.detailsTitle')} />
      <FormCard style={{ marginBottom: 16 }}>
        <Input
          label={t('settings.profile.displayName')}
          value={draft.displayName}
          onChangeText={(v) => edit({ displayName: v })}
          maxLength={PROFILE_LIMITS.displayName}
          disabled={saving}
          error={profileError || undefined}
          hint={t('settings.profile.displayNameHint')}
          autoCapitalize="words"
          testID="account-display-name"
        />
        <Input
          label={t('settings.profile.pronouns')}
          value={draft.pronouns}
          onChangeText={(v) => edit({ pronouns: v })}
          maxLength={PROFILE_LIMITS.pronouns}
          placeholder={t('settings.profile.pronounsPlaceholder')}
          hint={t('settings.profile.pronounsHint')}
          autoCapitalize="none"
          disabled={saving}
        />
        <TextArea
          label={t('settings.profile.aboutMe')}
          value={draft.aboutMe}
          onChangeText={(v) => edit({ aboutMe: v })}
          maxLength={PROFILE_LIMITS.aboutMe}
          minRows={2}
          maxRows={5}
          placeholder={t('settings.profile.aboutMePlaceholder')}
          hint={t('settings.profile.aboutMeHint')}
          disabled={saving}
        />
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <Text variant="label">{t('settings.profile.bio')}</Text>
            <SegmentedControl
              size="sm"
              value={bioTab}
              onChange={setBioTab}
              accessibilityLabel={t('settings.profile.bio')}
              items={[
                { id: 'edit', label: t('common.edit') },
                { id: 'preview', label: t('common.preview') },
              ]}
            />
          </View>
          {bioTab === 'edit' ? (
            <TextArea
              value={draft.bio}
              onChangeText={(v) => edit({ bio: v })}
              maxLength={PROFILE_LIMITS.bio}
              minRows={5}
              maxRows={12}
              placeholder={t('settings.profile.bioPlaceholder')}
              hint={t('mobile.settings.bioHint')}
              accessibilityLabel={t('settings.profile.bio')}
              disabled={saving}
            />
          ) : (
            <View style={{ minHeight: 80, padding: 12, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.muted }}>
              {draft.bio.trim() ? <BioPreview source={draft.bio} /> : <Text tone="muted">{t('mobile.settings.bioEmpty')}</Text>}
            </View>
          )}
        </View>
        <View style={{ gap: 6 }}>
          <Text variant="label">{t('settings.profile.username')}</Text>
          <View style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.muted }}>
            <Text tone="muted" selectable style={{ fontFamily: MONO_FONT, writingDirection: 'ltr' }}>
              {me?.username}
            </Text>
          </View>
          <Text variant="caption">{t('settings.profile.usernameHint')}</Text>
        </View>
      </FormCard>

      <ListSection title={t('settings.profile.birthdayTitle')}>
        <SettingToggle
          icon="cake-candles"
          title={t('settings.profile.birthdayShow')}
          description={`${t('settings.profile.birthdayShowHint')}\n${birthdayLabel ? t('settings.profile.birthdayYours', { date: birthdayLabel }) : t('settings.profile.birthdayNone')}`}
          error={birthdayError}
          value={birthdayOptIn}
          busy={birthdayBusy}
          onValueChange={(on) => void toggleBirthday(on)}
          testID="account-birthday"
        />
      </ListSection>

      <ListSection title={t('settings.profile.accountTitle')}>
        <SettingItem
          icon={copied('uid') ? 'check' : 'copy'}
          title={copied('uid') ? t('common.copied') : t('userArea.copyUserId')}
          onPress={() => void copy('uid', me?.id ?? '')}
        />
        <SettingItem icon="right-from-bracket" title={t('settings.profile.logOut')} destructive onPress={() => void logOut(false)} />
        <SettingItem
          icon="power-off"
          title={t('mobile.settings.logOutEverywhere')}
          description={t('mobile.settings.logOutEverywhereHint')}
          destructive
          onPress={() => void logOut(true)}
        />
      </ListSection>
    </SettingsScreen>
  );
}
