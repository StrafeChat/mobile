/**
 * Settings -> Space Profiles (the web's SpaceProfilesSettingsPage): who you are in one space.
 * A nickname, avatar, banner, pronouns, About Me and bio that replace your main profile there
 * only; whatever is left empty shows the main profile instead.
 *
 * - A space row at the top picks the space (an action sheet of your spaces, rail order). It
 *   opens on `?space=`, else the space on the rail, else the first one.
 * - Your row is fetched (GET .../members/@me) on every space change and, when the space's
 *   member list is loaded, written into it, so the rest of the app shows the result too; while
 *   you are not editing, the form follows that row (an edit from another device, a moderator's
 *   change). A list that is not loaded is left alone and the screen keeps its own copy: a list
 *   this screen started would hold only you, and an E2EE space room shares its Megolm key from
 *   that list (the web's storeOwnRow).
 * - Images upload the moment they are picked, outside the draft, as on My Account; each has a
 *   remove row once set.
 * - The text fields are a draft saved from the header, sending only the fields that changed;
 *   an emptied one is sent as null, which clears it. Leaving with unsaved edits asks first,
 *   and so does switching to another space.
 * - The nickname is locked when the space does not give you Change Nickname. The reset then
 *   leaves it out too: with it, the server would refuse the whole reset.
 * - Lengths count characters the way the server does (lib/spaceProfileLimits: code points of
 *   the trimmed text, and the nickname's character rules): an edited field the server would
 *   refuse says why, and Save waits until it is fixed.
 *
 * The data comes through the web's API calls (api/spaces, re-exported by src/data); none of
 * them touch the stores, so each answer is upserted here.
 */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { confirmDialog } from '@web/stores/confirmDialog';
import { spaces, ensureSpaceRoles } from '@web/stores/spaces';
import { spaceMembers, upsertSpaceMember } from '@web/stores/spaceMembers';
import { auth } from '@web/stores/auth';
import type { SpaceMember } from '@web/api/spaces';
import { inputMaxLength, profileTextLength, SPACE_PROFILE_LIMITS, spaceProfileFieldError, type SpaceProfileTextField } from '@web/lib/spaceProfileLimits';
import { useSolid } from '@/bridge/solid';
import {
  getSpaceMember,
  hasResettableSpaceProfile,
  memberCanChangeNickname,
  mySpaceMember,
  patchSpaceMember,
  resolveProfile,
  spaceProfileResetPatch,
  uploadSpaceMemberAvatar,
  uploadSpaceMemberBanner,
  useMe,
  useSpace,
  useSpaceIds,
  useSpacesHydrated,
  type SpaceProfileFields,
  type SpaceProfilePatch,
} from '@/data';
import { shell } from '@/shell/state';
import { useTheme } from '@/theme';
import { Avatar, Banner, EmptyState, Button, Input, ListSection, SegmentedControl, Text, TextArea, showActionSheet, toast } from '@/ui';
import { BioPreview } from '../components/BioPreview';
import { MediaHeader } from '../components/MediaHeader';
import { FormCard, LoadingRow, Note, SectionTitle, SettingItem } from '../components/rows';
import { SettingsScreen } from '../components/SettingsScreen';
import { errorText } from '../components/sheets';
import { useLocale } from '../hooks/useLocale';
import { useUnsavedGuard } from '../hooks/useUnsavedGuard';
import { PROFILE_IMAGE_MAX_BYTES, asUploadFile, pickImage } from '../hooks/pickImage';
import { openSettings } from '../navigation';

/**
 * Your row into the member store only when the space's list is already there (the web's
 * storeOwnRow): a list this screen started would hold just you, and the members store is what
 * an E2EE space room shares its Megolm key from - a send whose member fetch then failed would
 * fall back to it and share the key with nobody but you. The screen keeps its own copy for a
 * space whose list has not been fetched.
 */
function storeOwnRow(sid: string, m: SpaceMember): void {
  if (spaceMembers.bySpaceId[sid]?.length) upsertSpaceMember(sid, m);
}

export interface SpaceProfileDraft {
  nick: string;
  pronouns: string;
  aboutMe: string;
  bio: string;
}

/** The text fields of a member row (empty = no override). */
export function spaceProfileDraftFrom(m: SpaceProfileFields | null | undefined): SpaceProfileDraft {
  return { nick: m?.nick ?? '', pronouns: m?.space_pronouns ?? '', aboutMe: m?.space_about_me ?? '', bio: m?.space_bio ?? '' };
}

/**
 * The PATCH for a draft: only the fields that differ from `saved` (compared trimmed), each
 * trimmed, an emptied one as null (cleared). The nickname is left out unless the member may
 * change it, so a locked nickname never makes the server refuse the rest.
 */
export function spaceProfileDraftPatch(draft: SpaceProfileDraft, saved: SpaceProfileDraft, opts: { canChangeNick: boolean }): SpaceProfilePatch {
  const out: SpaceProfilePatch = {};
  const put = (key: 'nick' | 'pronouns' | 'about_me' | 'bio', now: string, before: string) => {
    const v = now.trim();
    if (v !== before.trim()) out[key] = v || null;
  };
  if (opts.canChangeNick) put('nick', draft.nick, saved.nick);
  put('pronouns', draft.pronouns, saved.pronouns);
  put('about_me', draft.aboutMe, saved.aboutMe);
  put('bio', draft.bio, saved.bio);
  return out;
}

/** The space the screen shows: the one asked for, else the one on the rail, else the first
 * (rail order) - each only while you are in it. */
export function initialSpaceProfileSpace(ids: readonly string[], requested?: string | null, active?: string | null): string | null {
  if (requested && ids.includes(requested)) return requested;
  if (active && ids.includes(active)) return active;
  return ids[0] ?? null;
}

export function SpaceProfileScreen({ initialSpaceId = null }: { initialSpaceId?: string | null }) {
  useLocale();
  const theme = useTheme();
  const me = useMe();
  const ids = useSpaceIds();
  const hydrated = useSpacesHydrated();
  const active = useSolid(() => shell.selectedSpaceId());
  // A space picked here wins while you are still in it; otherwise the screen falls back.
  const [picked, setPicked] = useState<string | null>(null);
  const spaceId = picked && ids.includes(picked) ? picked : initialSpaceProfileSpace(ids, initialSpaceId, active);
  const space = useSpace(spaceId);
  const stored = useSolid(() => (spaceId ? mySpaceMember(spaceId) : undefined), [spaceId]);
  /** The row GET /members/@me returned, until the member store has one to prefer. */
  const [loaded, setLoaded] = useState<{ spaceId: string; member: SpaceMember } | null>(null);
  // Your row in this space: the store's copy (which gateway events keep current), else the one
  // just fetched.
  const member: (SpaceProfileFields & { id: string; roles?: string[] }) | undefined =
    stored ?? (loaded && loaded.spaceId === spaceId && loaded.member.id === me?.id ? loaded.member : undefined);
  const canChangeNick = useSolid(() => {
    const sp = spaceId ? spaces.spaces.find((s) => s.id === spaceId) : undefined;
    return memberCanChangeNickname(sp, sp?.roles, member, auth.user?.id);
  }, [spaceId, member]);

  const [loadError, setLoadError] = useState<{ spaceId: string; message: string } | null>(null);
  const [reloads, setReloads] = useState(0);
  // An edit belongs to the space it was typed in; without one, the form shows the saved row.
  const [edit, setEdit] = useState<{ spaceId: string; draft: SpaceProfileDraft } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [mediaBusy, setMediaBusy] = useState<'avatar' | 'banner' | null>(null);
  const [mediaError, setMediaError] = useState('');
  const [resetting, setResetting] = useState(false);
  const [bioTab, setBioTab] = useState<'edit' | 'preview'>('edit');

  useEffect(() => {
    if (!spaceId) return;
    let live = true;
    // The nickname gate reads the space's roles; a space can arrive without them.
    void ensureSpaceRoles(spaceId);
    getSpaceMember(spaceId, '@me')
      .then((m) => {
        if (!live) return;
        storeOwnRow(spaceId, m);
        setLoaded({ spaceId, member: m });
        setLoadError(null);
      })
      .catch((err: unknown) => {
        if (live) setLoadError({ spaceId, message: errorText(err, 'mobile.settings.spaceProfiles.loadFailed') });
      });
    return () => {
      live = false;
    };
  }, [spaceId, reloads]);

  const saved = useMemo(
    () => spaceProfileDraftFrom(member),
    // The row's other fields (presence, roles) change often; only these four matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [member?.nick, member?.space_pronouns, member?.space_about_me, member?.space_bio],
  );
  const draft = edit && edit.spaceId === spaceId ? edit.draft : saved;
  const patch = useMemo(() => spaceProfileDraftPatch(draft, saved, { canChangeNick }), [draft, saved, canChangeNick]);
  const dirty = Object.keys(patch).length > 0;
  useUnsavedGuard(dirty && !saving);

  if (!spaceId) {
    return (
      <SettingsScreen title={t('mobile.settings.spaceProfiles.title')} testID="settings-space-profiles">
        {hydrated ? <EmptyState icon="id-badge" body={t('mobile.settings.spaceProfiles.noSpaces')} size="page" /> : <LoadingRow />}
      </SettingsScreen>
    );
  }
  const sid = spaceId;
  const spaceName = space?.name ?? '';
  const known = !!member;
  const loadFailed = loadError?.spaceId === sid ? loadError.message : '';

  const change = (next: Partial<SpaceProfileDraft>) => {
    setSaveError('');
    const d = { ...draft, ...next };
    // Typed back to what is saved: not an edit any more, so the form follows the row again.
    setEdit(Object.keys(spaceProfileDraftPatch(d, saved, { canChangeNick })).length ? { spaceId: sid, draft: d } : null);
  };

  /** Your row as the server answered: the member store's copy where the list is loaded, so
   * the whole app shows it before the gateway's update arrives, and this screen's own. */
  const applied = (m: SpaceMember) => {
    storeOwnRow(sid, m);
    setLoaded({ spaceId: sid, member: m });
  };

  /** Why the server would refuse an edited field, translated; only edits are judged. */
  const fieldError = (k: SpaceProfileTextField): string | undefined => {
    if (draft[k].trim() === saved[k].trim()) return undefined;
    const key = spaceProfileFieldError(k, draft[k]);
    return key ? t(key) : undefined;
  };
  const invalid = (['nick', 'pronouns', 'aboutMe', 'bio'] as const).some((k) => (k !== 'nick' || canChangeNick) && fieldError(k) !== undefined);

  async function save() {
    if (!dirty || saving || invalid) return;
    setSaving(true);
    setSaveError('');
    try {
      applied(await patchSpaceMember(sid, '@me', patch));
      setEdit(null);
      toast.success(t('mobile.settings.spaceProfiles.saved'));
    } catch (err) {
      setSaveError(errorText(err, 'mobile.settings.spaceProfiles.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function switchTo(next: string) {
    if (next === sid) return;
    if (dirty) {
      const discard = await confirmDialog({
        title: t('settings.unsaved.title'),
        body: t('mobile.settings.spaceProfiles.switchUnsavedBody'),
        confirmLabel: t('common.discard'),
        tone: 'danger',
      });
      if (!discard) return;
    }
    setEdit(null);
    setSaveError('');
    setMediaError('');
    setPicked(next);
  }

  function pickSpace() {
    void showActionSheet(
      spaces.spaces.map((s) => ({
        key: s.id,
        label: s.name,
        leading: <Avatar uri={s.icon || undefined} name={s.name} size="md" shape="rounded" />,
        selected: s.id === sid,
        onSelect: () => void switchTo(s.id),
      })),
      { title: t('mobile.settings.spaceProfiles.pickSpace') },
    );
  }

  async function changeImage(kind: 'avatar' | 'banner') {
    const pick = await pickImage({
      title: kind === 'avatar' ? t('mobile.settings.spaceProfiles.changeAvatar') : t('mobile.settings.spaceProfiles.changeBanner'),
      maxBytes: PROFILE_IMAGE_MAX_BYTES,
      // Square for the avatar; a banner keeps its shape (iOS only crops squares).
      ...(kind === 'avatar' ? { crop: { aspect: [1, 1] } } : {}),
    });
    if (pick.status === 'cancelled') return;
    if (pick.status === 'error') {
      setMediaError(pick.message);
      return;
    }
    setMediaError('');
    setMediaBusy(kind);
    try {
      const file = asUploadFile(pick.file);
      applied(kind === 'avatar' ? await uploadSpaceMemberAvatar(sid, file) : await uploadSpaceMemberBanner(sid, file));
    } catch (err) {
      setMediaError(errorText(err, 'settings.profile.uploadFailed'));
    } finally {
      setMediaBusy(null);
    }
  }

  async function removeImage(kind: 'avatar' | 'banner') {
    setMediaError('');
    setMediaBusy(kind);
    try {
      applied(await patchSpaceMember(sid, '@me', kind === 'avatar' ? { avatar: null } : { banner: null }));
    } catch (err) {
      setMediaError(errorText(err, 'mobile.settings.spaceProfiles.saveFailed'));
    } finally {
      setMediaBusy(null);
    }
  }

  async function reset() {
    if (resetting) return;
    const ok = await confirmDialog({
      title: t('mobile.settings.spaceProfiles.resetTitle'),
      body: canChangeNick
        ? t('mobile.settings.spaceProfiles.resetBody', { space: spaceName })
        : t('mobile.settings.spaceProfiles.resetBodyKeepsNick', { space: spaceName }),
      confirmLabel: t('mobile.settings.spaceProfiles.reset'),
      tone: 'danger',
      icon: 'fa-solid fa-eraser',
    });
    if (!ok) return;
    setResetting(true);
    setSaveError('');
    try {
      applied(await patchSpaceMember(sid, '@me', spaceProfileResetPatch({ includeNick: canChangeNick })));
      setEdit(null);
    } catch (err) {
      setSaveError(errorText(err, 'mobile.settings.spaceProfiles.saveFailed'));
    } finally {
      setResetting(false);
    }
  }

  // The preview: you as the space's members see you, with what is typed so far.
  const view = resolveProfile(me, {
    nick: canChangeNick ? draft.nick : member?.nick,
    space_pronouns: draft.pronouns,
    space_about_me: draft.aboutMe,
    space_bio: draft.bio,
    space_avatar: member?.space_avatar,
    space_banner: member?.space_banner,
  });
  const fieldsDisabled = saving || resetting || !known;
  const resettable = hasResettableSpaceProfile(member, { ignoreNick: !canChangeNick });
  const origin = space?.federation?.origin_domain;

  return (
    <SettingsScreen
      title={t('mobile.settings.spaceProfiles.title')}
      testID="settings-space-profiles"
      error={saveError || null}
      onDismissError={() => setSaveError('')}
      right={
        dirty ? (
          <Button
            title={t('common.save')}
            size="sm"
            icon="check"
            loading={saving}
            disabled={invalid}
            onPress={() => void save()}
            accessibilityHint={t('mobile.settings.unsavedHint')}
            testID="space-profile-save"
          />
        ) : null
      }
    >
      <SectionTitle title={t('mobile.settings.spaceProfiles.space')} />
      <ListSection>
        <SettingItem
          leading={<Avatar uri={space?.icon || undefined} name={spaceName || '?'} size="lg" shape="rounded" />}
          title={spaceName}
          description={ids.length > 1 ? t('mobile.settings.spaceProfiles.pickSpace') : undefined}
          chevron={ids.length > 1}
          onPress={ids.length > 1 ? pickSpace : undefined}
          testID="space-profile-space"
        />
      </ListSection>
      <Note style={{ paddingTop: 8 }}>
        {[
          t('mobile.settings.spaceProfiles.intro', { space: spaceName }),
          t('mobile.settings.spaceProfiles.visibility', { space: spaceName }),
          origin ? t('mobile.settings.spaceProfiles.hostedOn', { domain: origin }) : '',
        ]
          .filter(Boolean)
          .join(' ')}
      </Note>
      {loadFailed ? (
        <Banner
          tone="error"
          message={loadFailed}
          action={{
            label: t('common.retry'),
            onPress: () => {
              setLoadError(null);
              setReloads((n) => n + 1);
            },
          }}
          style={{ marginHorizontal: 12, marginBottom: 12 }}
          testID="space-profile-load-failed"
        />
      ) : null}

      <SectionTitle title={t('mobile.settings.spaceProfiles.preview')} />
      <MediaHeader
        name={view.name}
        avatarUri={view.avatar}
        bannerUri={view.banner}
        onPickAvatar={known ? () => void changeImage('avatar') : undefined}
        onPickBanner={known ? () => void changeImage('banner') : undefined}
        avatarBusy={mediaBusy === 'avatar'}
        bannerBusy={mediaBusy === 'banner'}
        hint={t('mobile.settings.spaceProfiles.previewHint', { space: spaceName })}
        error={mediaError}
      >
        <Text variant="heading" numberOfLines={1}>
          {view.name}
        </Text>
        {view.nick ? (
          <Text variant="caption" numberOfLines={1}>
            {view.globalName}
          </Text>
        ) : null}
        {view.pronouns ? (
          <Text variant="caption" numberOfLines={1}>
            {view.pronouns.trim()}
          </Text>
        ) : null}
      </MediaHeader>
      <ListSection footer={t('mobile.settings.mediaHint')} style={{ marginTop: 12 }}>
        <SettingItem
          icon="circle-user"
          title={t('mobile.settings.spaceProfiles.changeAvatar')}
          disabled={!known || !!mediaBusy}
          onPress={() => void changeImage('avatar')}
        />
        {member?.space_avatar ? (
          <SettingItem
            icon="trash"
            title={t('mobile.settings.spaceProfiles.removeAvatar')}
            destructive
            disabled={!!mediaBusy}
            onPress={() => void removeImage('avatar')}
            testID="space-profile-remove-avatar"
          />
        ) : null}
        <SettingItem
          icon="image"
          title={t('mobile.settings.spaceProfiles.changeBanner')}
          disabled={!known || !!mediaBusy}
          onPress={() => void changeImage('banner')}
        />
        {member?.space_banner ? (
          <SettingItem
            icon="trash"
            title={t('mobile.settings.spaceProfiles.removeBanner')}
            destructive
            disabled={!!mediaBusy}
            onPress={() => void removeImage('banner')}
            testID="space-profile-remove-banner"
          />
        ) : null}
      </ListSection>

      <SectionTitle title={t('settings.profile.detailsTitle')} />
      <FormCard style={{ marginBottom: 16 }}>
        <Input
          label={t('mobile.settings.spaceProfiles.nickname')}
          value={draft.nick}
          onChangeText={(v) => change({ nick: v })}
          maxLength={inputMaxLength('nick')}
          error={canChangeNick ? fieldError('nick') : undefined}
          placeholder={view.globalName}
          hint={canChangeNick ? t('mobile.settings.spaceProfiles.nicknameHint') : t('mobile.settings.spaceProfiles.nicknameLocked')}
          disabled={fieldsDisabled || !canChangeNick}
          autoCapitalize="words"
          testID="space-profile-nick"
        />
        <Input
          label={t('settings.profile.pronouns')}
          value={draft.pronouns}
          onChangeText={(v) => change({ pronouns: v })}
          maxLength={inputMaxLength('pronouns')}
          error={fieldError('pronouns')}
          placeholder={t('settings.profile.pronounsPlaceholder')}
          hint={t('mobile.settings.spaceProfiles.usesMain')}
          autoCapitalize="none"
          disabled={fieldsDisabled}
          testID="space-profile-pronouns"
        />
        <TextArea
          label={t('settings.profile.aboutMe')}
          value={draft.aboutMe}
          onChangeText={(v) => change({ aboutMe: v })}
          maxLength={inputMaxLength('aboutMe')}
          countLimit={SPACE_PROFILE_LIMITS.aboutMe}
          countLength={profileTextLength}
          error={fieldError('aboutMe')}
          minRows={2}
          maxRows={5}
          placeholder={t('settings.profile.aboutMePlaceholder')}
          hint={t('mobile.settings.spaceProfiles.usesMain')}
          disabled={fieldsDisabled}
          testID="space-profile-about"
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
              onChangeText={(v) => change({ bio: v })}
              maxLength={inputMaxLength('bio')}
              countLimit={SPACE_PROFILE_LIMITS.bio}
              countLength={profileTextLength}
              error={fieldError('bio')}
              minRows={5}
              maxRows={12}
              placeholder={t('settings.profile.bioPlaceholder')}
              hint={t('mobile.settings.spaceProfiles.usesMain')}
              accessibilityLabel={t('settings.profile.bio')}
              disabled={fieldsDisabled}
              testID="space-profile-bio"
            />
          ) : (
            // The bio others see here: this one, or the main profile's while it is empty.
            <View style={{ minHeight: 80, padding: 12, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.muted }}>
              {view.bio?.trim() ? <BioPreview source={view.bio} /> : <Text tone="muted">{t('mobile.settings.bioEmpty')}</Text>}
            </View>
          )}
        </View>
      </FormCard>

      <ListSection>
        <SettingItem
          icon="eraser"
          title={t('mobile.settings.spaceProfiles.reset')}
          destructive
          disabled={!resettable || saving}
          busy={resetting}
          onPress={() => void reset()}
          testID="space-profile-reset"
        />
        <SettingItem icon="user" title={t('mobile.settings.spaceProfiles.editMain')} chevron onPress={() => openSettings('account')} testID="space-profile-edit-main" />
      </ListSection>
    </SettingsScreen>
  );
}
