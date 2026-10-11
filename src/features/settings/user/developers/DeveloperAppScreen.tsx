/**
 * One OAuth2 application (DevelopersSettingsPage, detail view): the once-shown secret or
 * token, name / description / redirect URIs, its bot (add, reset token, public switch, add to
 * a space, Discover listing, profile with avatar and banner), the OAuth2 credentials, the
 * authorization URL generator, and deleting the application.
 *
 * Links the web opens in a new tab open here on the in-app consent screen (install a bot) or
 * the in-app browser (docs, a generated URL with a redirect).
 */
import { useEffect, useMemo, useState } from 'react';
import { Share, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { formatDate, t } from '@web/i18n/t';
import {
  OAUTH_SCOPES,
  addBot,
  authorizeUrl,
  deleteApplication,
  getApplication,
  resetApplicationSecret,
  resetBotToken,
  scopeKey,
  updateApplication,
  updateBotProfile,
  uploadBotAvatar,
  uploadBotBanner,
  type Application,
  type BotProfile,
  type OAuthScope,
} from '@web/api/developers';
import { applyBotListing, getBotListing, withdrawBotListing } from '@web/api/discover';
import { PermAdministrator, SPACE_ROLE_PERM_GROUPS } from '@web/lib/spacePermissions';
import { confirmDialog } from '@web/stores/confirmDialog';
import { openExternalUrl } from '@/platform/overrides/desktop/native';
import { useTheme } from '@/theme';
import { Avatar, Banner, BotTag, Button, Checkbox, EmptyState, Input, ListSection, MONO_FONT, Select, Spinner, Text, TextArea, withAlpha } from '@/ui';
import { DiscoverListingForm } from '../../components/DiscoverListingForm';
import { MediaHeader } from '../../components/MediaHeader';
import { FormCard, Note, SectionTitle, SettingItem, SettingToggle } from '../../components/rows';
import { SettingsScreen } from '../../components/SettingsScreen';
import { useCopy } from '../../hooks/useCopy';
import { useLocale } from '../../hooks/useLocale';
import { PROFILE_IMAGE_MAX_BYTES, asUploadFile, pickImage } from '../../hooks/pickImage';
import { consentPathFor, openDocs, takeSecret, type OnceSecret } from './shared';

/** Redirect URIs as the form holds them (one per line) -> the list the API takes. */
export function parseRedirects(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Every scope but a bare `bot` needs somewhere to deliver the code. */
export function scopesNeedRedirect(scopes: ReadonlySet<OAuthScope>): boolean {
  return [...scopes].some((s) => s !== 'bot');
}

/** The URL generator's link, or '' while it cannot be built (the web's generatedUrl). */
export function generatedAuthorizeUrl(app: Pick<Application, 'client_id'>, scopes: ReadonlySet<OAuthScope>, perms: number, redirect: string): string {
  const needsRedirect = scopesNeedRedirect(scopes);
  if (scopes.size === 0 || (needsRedirect && !redirect)) return '';
  return authorizeUrl({
    clientId: app.client_id,
    scopes: OAUTH_SCOPES.filter((s) => scopes.has(s)),
    redirectUri: needsRedirect ? redirect : undefined,
    permissions: scopes.has('bot') ? perms : undefined,
  });
}

/** Open an authorize URL: our own consent screen when it is one, else the in-app browser. */
function openAuthorize(url: string): void {
  const path = consentPathFor(url);
  if (path) router.push(path as Href);
  else void openExternalUrl(url);
}

function CopyValue({ value, copyKey, label }: { value: string; copyKey: string; label?: string }) {
  const theme = useTheme();
  const { copy, copied } = useCopy();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text variant="label">{label}</Text> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          padding: 10,
          borderRadius: theme.radii.md,
          backgroundColor: theme.colors.muted,
        }}
      >
        <Text selectable numberOfLines={3} style={{ flex: 1, fontFamily: MONO_FONT, fontSize: theme.font(12), writingDirection: 'ltr' }}>
          {value}
        </Text>
        <Button title={copied(copyKey) ? t('common.copied') : t('common.copy')} size="sm" variant="secondary" onPress={() => void copy(copyKey, value)} />
      </View>
    </View>
  );
}

export function DeveloperAppScreen() {
  useLocale();
  const theme = useTheme();
  const { appId } = useLocalSearchParams<{ appId: string }>();
  const [app, setApp] = useState<Application | null>(null);
  const [loadError, setLoadError] = useState('');
  const [secret, setSecret] = useState<OnceSecret | null>(() => (appId ? takeSecret(appId) : null));
  const [error, setError] = useState('');
  // General form.
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fRedirects, setFRedirects] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  // Bot profile form.
  const [bName, setBName] = useState('');
  const [bAbout, setBAbout] = useState('');
  const [bBio, setBBio] = useState('');
  const [botSaving, setBotSaving] = useState(false);
  const [botAvatarBusy, setBotAvatarBusy] = useState(false);
  const [botBannerBusy, setBotBannerBusy] = useState(false);
  const [botMediaError, setBotMediaError] = useState('');
  // URL generator.
  const [scopes, setScopes] = useState<Set<OAuthScope>>(new Set(['identify']));
  const [perms, setPerms] = useState(0);
  const [redirect, setRedirect] = useState('');
  const { copy, copied } = useCopy();

  function seed(a: Application, first: boolean) {
    setApp(a);
    setFName(a.name);
    setFDesc(a.description);
    setFRedirects(a.redirect_uris.join('\n'));
    seedBot(a.bot);
    if (first) {
      setScopes(new Set<OAuthScope>(a.has_bot ? ['bot'] : ['identify']));
      setPerms(0);
      setRedirect(a.redirect_uris[0] ?? '');
    }
  }
  function seedBot(bot: BotProfile | undefined) {
    setBName(bot?.display_name ?? '');
    setBAbout(bot?.about_me ?? '');
    setBBio(bot?.bio ?? '');
  }

  useEffect(() => {
    if (!appId) return;
    let live = true;
    getApplication(appId)
      .then((a) => live && seed(a, true))
      .catch(() => live && setLoadError(t('settings.developers.loadFailed')));
    return () => {
      live = false;
    };
  }, [appId]);

  const redirects = parseRedirects(fRedirects);
  const dirty = !!app && (fName.trim() !== app.name || fDesc.trim() !== app.description || redirects.join('\n') !== app.redirect_uris.join('\n'));
  const bot = app?.bot;
  const botDirty = !!bot && (bName.trim() !== (bot.display_name ?? '') || bAbout.trim() !== (bot.about_me ?? '') || bBio.trim() !== (bot.bio ?? ''));
  const generated = useMemo(() => (app ? generatedAuthorizeUrl(app, scopes, perms, redirect) : ''), [app, scopes, perms, redirect]);
  const installUrl = app?.has_bot ? authorizeUrl({ clientId: app.client_id, scopes: ['bot'], permissions: perms }) : '';

  async function run<T>(fn: () => Promise<T>, failKey = 'settings.developers.actionFailed'): Promise<T | undefined> {
    setBusy(true);
    setError('');
    try {
      return await fn();
    } catch {
      setError(t(failKey));
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!app) return;
    setSaving(true);
    setError('');
    try {
      const updated = await updateApplication(app.id, { name: fName.trim(), description: fDesc.trim(), redirect_uris: redirects });
      seed(updated, false);
      if (!updated.redirect_uris.includes(redirect)) setRedirect(updated.redirect_uris[0] ?? '');
    } catch {
      setError(t('settings.developers.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  async function confirmed(titleKey: string, bodyKey: string, vars?: Record<string, string>): Promise<boolean> {
    return confirmDialog({ title: t(titleKey), body: t(bodyKey, vars), confirmLabel: t(titleKey), tone: 'danger' });
  }

  async function resetSecret() {
    if (!app || !(await confirmed('settings.developers.resetSecret', 'settings.developers.resetSecretConfirm'))) return;
    const res = await run(() => resetApplicationSecret(app.id));
    if (res) setSecret({ labelKey: 'settings.developers.clientSecret', value: res.client_secret });
  }

  async function attachBot() {
    if (!app) return;
    const res = await run(async () => {
      const created = await addBot(app.id);
      const updated = await getApplication(app.id);
      return { created, updated };
    });
    if (!res) return;
    seed(res.updated, false);
    setSecret({ labelKey: 'settings.developers.botToken', value: res.created.token });
    setScopes(new Set<OAuthScope>(['bot']));
  }

  async function regenToken() {
    if (!app || !(await confirmed('settings.developers.resetToken', 'settings.developers.resetTokenConfirm'))) return;
    const res = await run(() => resetBotToken(app.id));
    if (res) setSecret({ labelKey: 'settings.developers.botToken', value: res.token });
  }

  async function setBotPublic(on: boolean) {
    if (!app) return;
    const res = await run(() => updateApplication(app.id, { bot_public: on }));
    if (res) seed(res, false);
  }

  async function remove() {
    if (!app || !(await confirmed('settings.developers.deleteApp', 'settings.developers.deleteConfirm', { name: app.name }))) return;
    const ok = await run(async () => {
      await deleteApplication(app.id);
      return true;
    });
    if (ok && router.canGoBack()) router.back();
  }

  async function saveBot() {
    if (!app?.bot) return;
    setBotSaving(true);
    setError('');
    try {
      const updated = await updateBotProfile(app.id, { display_name: bName.trim(), about_me: bAbout.trim(), bio: bBio.trim() });
      setApp({ ...app, bot: updated });
      seedBot(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.developers.saveFailed'));
    } finally {
      setBotSaving(false);
    }
  }

  async function botImage(kind: 'avatar' | 'banner') {
    if (!app?.bot) return;
    const pick = await pickImage({ maxBytes: PROFILE_IMAGE_MAX_BYTES });
    if (pick.status === 'cancelled') return;
    if (pick.status === 'error') {
      setBotMediaError(pick.message);
      return;
    }
    setBotMediaError('');
    const setB = kind === 'avatar' ? setBotAvatarBusy : setBotBannerBusy;
    setB(true);
    try {
      const updated = kind === 'avatar' ? await uploadBotAvatar(app.id, asUploadFile(pick.file)) : await uploadBotBanner(app.id, asUploadFile(pick.file));
      setApp((a) => (a ? { ...a, bot: updated } : a));
    } catch (err) {
      setBotMediaError(err instanceof Error ? err.message : t('settings.profile.uploadFailed'));
    } finally {
      setB(false);
    }
  }

  const toggleScope = (scope: OAuthScope, on: boolean) =>
    setScopes((prev) => {
      const next = new Set(prev);
      if (on) next.add(scope);
      else next.delete(scope);
      return next;
    });

  if (!app) {
    return (
      <SettingsScreen title={t('settings.sections.developers.title')}>
        {loadError ? <EmptyState icon="fa-solid fa-triangle-exclamation" title={loadError} /> : <Spinner fill />}
      </SettingsScreen>
    );
  }

  return (
    <SettingsScreen title={app.name} subtitle={t('settings.developers.created', { when: formatDate(app.created_at, { dateStyle: 'medium' }) })} error={error} onDismissError={() => setError('')} testID="settings-developer-app">
      {secret ? (
        <Banner
          tone="warning"
          title={t('settings.developers.secretOnce', { what: t(secret.labelKey) })}
          message={secret.value}
          onDismiss={() => setSecret(null)}
          action={{ label: copied('secret') ? t('common.copied') : t('common.copy'), onPress: () => void copy('secret', secret.value) }}
          style={{ marginHorizontal: 12, marginBottom: 16 }}
        />
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingBottom: 12 }}>
        <Avatar uri={app.icon} name={app.name} size="xl" shape="rounded" />
        <View style={{ flex: 1 }}>
          <Text variant="title" numberOfLines={2}>
            {app.name}
          </Text>
          <Text variant="caption" tone="link" accessibilityRole="link" onPress={openDocs}>
            {t('settings.developers.docs')}
          </Text>
        </View>
      </View>

      <FormCard style={{ marginBottom: 16 }}>
        <Input label={t('settings.developers.name')} value={fName} onChangeText={setFName} maxLength={80} />
        <TextArea label={t('settings.developers.description')} value={fDesc} onChangeText={setFDesc} maxLength={400} minRows={2} />
        <TextArea
          label={t('settings.developers.redirects')}
          hint={t('settings.developers.redirectsHint')}
          value={fRedirects}
          onChangeText={setFRedirects}
          minRows={3}
          showCount={false}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          keyboardType="url"
          inputStyle={{ fontFamily: MONO_FONT, fontSize: theme.font(12) }}
        />
        <Button title={t('common.saveChanges')} loading={saving} disabled={!dirty} onPress={() => void save()} testID="developer-save" />
      </FormCard>

      <ListSection title={t('settings.developers.botTitle')}>
        {app.has_bot ? (
          <>
            <SettingItem
              leading={bot ? <Avatar uri={bot.avatar} name={bot.display_name || bot.username} size="lg" /> : undefined}
              icon={bot ? undefined : 'robot'}
              title={bot?.display_name || bot?.username || t('settings.developers.botActive')}
              titleAccessory={<BotTag bot />}
              description={bot ? `@${bot.username} · ${bot.id}` : t('settings.developers.botActiveHint')}
            />
            <SettingItem icon="rotate" title={t('settings.developers.resetToken')} disabled={busy} onPress={() => void regenToken()} />
            <SettingToggle
              icon="globe"
              title={t('settings.developers.publicBot')}
              description={t('settings.developers.publicBotHint')}
              value={app.bot_public}
              busy={busy}
              onValueChange={(on) => void setBotPublic(on)}
            />
            <SettingItem
              icon="plus"
              title={t('settings.developers.addToSpace')}
              description={t('settings.developers.addToSpaceHint')}
              chevron
              disabled={!installUrl}
              onPress={() => openAuthorize(installUrl)}
              testID="developer-install"
            />
          </>
        ) : (
          <SettingItem
            icon="robot"
            title={t('settings.developers.addBot')}
            description={t('settings.developers.botHint')}
            busy={busy}
            onPress={() => void attachBot()}
            testID="developer-add-bot"
          />
        )}
      </ListSection>

      {app.has_bot ? (
        <View style={{ marginBottom: 16 }}>
          <SectionTitle title={t('discover.listing.title')} />
          <DiscoverListingForm
            load={() => getBotListing(app.id)}
            apply={(input) => applyBotListing(app.id, input)}
            withdraw={() => withdrawBotListing(app.id)}
            blocked={!app.has_bot ? t('discover.listing.noBot') : !app.bot_public ? t('discover.listing.botPrivate') : undefined}
            onError={setError}
          />
        </View>
      ) : null}

      {bot ? (
        <View style={{ marginBottom: 16 }}>
          <SectionTitle title={t('settings.developers.botProfile')} />
          <Note>{t('settings.developers.botProfileHint')}</Note>
          <MediaHeader
            name={bName.trim() || bot.display_name || bot.username}
            avatarUri={bot.avatar}
            bannerUri={bot.banner}
            onPickAvatar={() => void botImage('avatar')}
            onPickBanner={() => void botImage('banner')}
            avatarBusy={botAvatarBusy}
            bannerBusy={botBannerBusy}
            avatarSize={68}
            bannerHeight={100}
            hint={t('mobile.settings.mediaHint')}
            error={botMediaError}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text variant="heading" numberOfLines={1} style={{ flexShrink: 1 }}>
                {bName.trim() || bot.display_name || bot.username}
              </Text>
              <BotTag bot />
            </View>
          </MediaHeader>
          <FormCard style={{ marginTop: 12 }}>
            <Input label={t('settings.developers.botDisplayName')} value={bName} onChangeText={setBName} maxLength={32} />
            <TextArea
              label={t('settings.developers.botAboutMe')}
              hint={t('settings.profile.aboutMeHint')}
              placeholder={t('settings.profile.aboutMePlaceholder')}
              value={bAbout}
              onChangeText={setBAbout}
              maxLength={190}
              minRows={2}
            />
            <TextArea
              label={t('settings.developers.botBio')}
              hint={t('mobile.settings.bioHint')}
              placeholder={t('settings.profile.bioPlaceholder')}
              value={bBio}
              onChangeText={setBBio}
              maxLength={190}
              minRows={3}
            />
            <Button title={t('common.saveChanges')} loading={botSaving} disabled={!botDirty} onPress={() => void saveBot()} />
          </FormCard>
        </View>
      ) : null}

      <SectionTitle title={t('settings.developers.oauthTitle')} />
      <FormCard style={{ marginBottom: 16 }}>
        <CopyValue label={t('settings.developers.clientId')} value={app.client_id} copyKey="cid" />
        <View style={{ gap: 6 }}>
          <Text variant="label">{t('settings.developers.clientSecret')}</Text>
          <Text variant="caption">{t('settings.developers.secretHidden')}</Text>
          <Button title={t('settings.developers.resetSecret')} variant="outline" size="sm" loading={busy} onPress={() => void resetSecret()} style={{ alignSelf: 'flex-start' }} />
        </View>
      </FormCard>

      <SectionTitle title={t('settings.developers.urlGenerator')} />
      <Note>{t('settings.developers.urlGeneratorHint')}</Note>
      <FormCard style={{ marginBottom: 16 }}>
        <Text variant="label">{t('settings.developers.scopes')}</Text>
        {OAUTH_SCOPES.map((scope) => (
          <Checkbox
            key={scope}
            checked={scopes.has(scope)}
            disabled={scope === 'bot' && !app.has_bot}
            onChange={(on) => toggleScope(scope, on)}
            label={scope}
            description={scope === 'bot' && !app.has_bot ? t('settings.developers.botScopeNeedsBot') : t(`oauth.scopes.${scopeKey(scope)}`)}
          />
        ))}
        {scopes.has('bot') ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <Text variant="label">{t('settings.developers.botPermissions')}</Text>
              <Text variant="caption" style={{ fontFamily: MONO_FONT }}>
                {t('settings.developers.permissionsValue', { value: String(perms) })}
              </Text>
            </View>
            {SPACE_ROLE_PERM_GROUPS.map((group) => (
              <View key={group.category} style={{ gap: 8 }}>
                <Text variant="overline">{group.category}</Text>
                {group.rows.map((r) => (
                  <Checkbox key={r.key} checked={(perms & r.bit) !== 0} onChange={(on) => setPerms((cur) => (on ? cur | r.bit : cur & ~r.bit))} label={r.label} />
                ))}
              </View>
            ))}
            {(perms & PermAdministrator) !== 0 ? (
              <Text variant="caption" tone="danger">
                {t('settings.developers.administratorWarning')}
              </Text>
            ) : null}
          </View>
        ) : null}
        {scopesNeedRedirect(scopes) ? (
          app.redirect_uris.length > 0 ? (
            <Select<string>
              label={t('settings.developers.redirectUri')}
              value={redirect}
              options={app.redirect_uris.map((u) => ({ value: u, label: u }))}
              onValueChange={setRedirect}
            />
          ) : (
            <Text variant="caption" tone="danger">
              {t('settings.developers.redirectRequired')}
            </Text>
          )
        ) : null}
        <View style={{ gap: 8 }}>
          <Text variant="label">{t('settings.developers.generatedUrl')}</Text>
          {generated ? (
            <>
              <Text selectable style={{ fontFamily: MONO_FONT, fontSize: theme.font(12), padding: 10, borderRadius: theme.radii.md, backgroundColor: theme.colors.muted }}>
                {generated}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Button title={copied('url') ? t('common.copied') : t('settings.developers.copyUrl')} size="sm" variant="secondary" onPress={() => void copy('url', generated)} />
                <Button title={t('settings.developers.openUrl')} size="sm" variant="outline" onPress={() => openAuthorize(generated)} />
                <Button title={t('mobile.settings.share')} size="sm" variant="outline" icon="share-nodes" onPress={() => void Share.share({ message: generated }).catch(() => undefined)} />
              </View>
            </>
          ) : (
            <Text variant="caption">{t('settings.developers.generatedUrlEmpty')}</Text>
          )}
        </View>
      </FormCard>

      <ListSection>
        <View style={{ backgroundColor: withAlpha(theme.colors.destructive, 0.05) }}>
          <SettingItem
            icon="trash"
            title={t('settings.developers.deleteApp')}
            description={t('settings.developers.deleteHint')}
            destructive
            busy={busy}
            onPress={() => void remove()}
            testID="developer-delete"
          />
        </View>
      </ListSection>
    </SettingsScreen>
  );
}
