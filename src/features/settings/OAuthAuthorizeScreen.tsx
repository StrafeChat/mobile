/**
 * OAuth2 consent and bot installer (OAuthAuthorizePage), as an in-app screen. Reached from a
 * bot's "Add to space", the developer settings' install link and URL generator, and any web
 * code that opens /oauth2/authorize (desktop/native's openPopupWindow routes it here).
 *
 * The server validated the request and is the authority; this shows who is asking for what,
 * lets you pick the space and narrow the permissions for a bot, and posts the approval. A
 * redirect after approving (or cancelling) leaves the app for the requesting application, as
 * the browser would.
 */
import { useEffect, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { t } from '@web/i18n/t';
import { isApiError } from '@web/api/ApiError';
import { authorize, getAuthorizeInfo, scopeKey, type AuthorizeInfo, type AuthorizeQuery, type OAuthScope } from '@web/api/developers';
import { PermAdministrator, SPACE_ROLE_PERM_ROWS } from '@web/lib/spacePermissions';
import { setSelectedSpaceId, openNav } from '@/shell/state';
import { useMe } from '@/data';
import { useTheme } from '@/theme';
import { Avatar, Button, Checkbox, EmptyState, Icon, ListSection, Select, Spinner, Text, withAlpha } from '@/ui';
import { FormCard, Note, SettingItem } from './components/rows';
import { SettingsScreen } from './components/SettingsScreen';
import { useLocale } from './hooks/useLocale';
import { leaveSettingsScreen } from './navigation';

const SCOPE_ICON: Record<OAuthScope, string> = {
  identify: 'id-badge',
  email: 'envelope',
  spaces: 'layer-group',
  'spaces.join': 'user-plus',
  bot: 'robot',
};

type Params = {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  permissions?: string;
  space_id?: string;
  disable_space_select?: string;
  code_challenge?: string;
  code_challenge_method?: string;
};

/** The web's describeError for consent failures. */
export function describeConsentError(e: unknown): string {
  if (isApiError(e)) {
    if (e.message === 'access_denied' && e.description?.includes('private')) return t('oauth.botPrivate');
    if (e.description) return e.description;
    if (e.message === 'invalid_scope' || e.message === 'invalid_client') return t('oauth.invalidRequest');
  }
  return t('oauth.failed');
}

/** Requested bits the viewer may grant in a space (Administrator grantable = all). */
export function grantableDefaults(requested: number, grantable: number): number {
  return requested & (grantable & PermAdministrator ? ~0 : grantable);
}

/** Where a cancel sends the browser: the app's redirect with access_denied, or nowhere. */
export function denyRedirect(redirectUri: string, state?: string): string | null {
  if (!redirectUri) return null;
  const sep = redirectUri.includes('?') ? '&' : '?';
  let back = `${redirectUri}${sep}error=access_denied`;
  if (state) back += `&state=${encodeURIComponent(state)}`;
  return back;
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function OAuthAuthorizeScreen() {
  useLocale();
  const theme = useTheme();
  const me = useMe();
  const raw = useLocalSearchParams<Params>();
  // expo-router hands back a new params object on every render; keyed on the object, the
  // request below re-ran after each response (setInfo -> render -> new query -> fetch...).
  const paramsKey = JSON.stringify(raw);
  const params: Params = useMemo(() => {
    const out: Params = {};
    for (const [k, v] of Object.entries(JSON.parse(paramsKey) as Record<string, string | string[] | undefined>)) {
      (out as Record<string, string | undefined>)[k] = one(v);
    }
    return out;
  }, [paramsKey]);

  const query: AuthorizeQuery = useMemo(
    () => ({
      response_type: params.response_type ?? 'code',
      client_id: params.client_id ?? '',
      redirect_uri: params.redirect_uri ?? '',
      scope: params.scope ?? '',
      state: params.state,
      permissions: params.permissions,
      code_challenge: params.code_challenge,
      code_challenge_method: params.code_challenge_method,
    }),
    [params],
  );

  const [info, setInfo] = useState<AuthorizeInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [installed, setInstalled] = useState<{ spaceId: string; spaceName: string } | null>(null);
  const [spaceId, setSpaceId] = useState('');
  const [granted, setGranted] = useState(0);

  useEffect(() => {
    if (!query.client_id) {
      setLoadError(t('oauth.invalidRequest'));
      return;
    }
    let live = true;
    setInfo(null);
    setLoadError('');
    getAuthorizeInfo(query)
      .then((d) => {
        if (!live) return;
        setInfo(d);
        if (d.bot) {
          const list = d.spaces ?? [];
          setSpaceId(list.find((s) => s.id === params.space_id)?.id ?? list[0]?.id ?? '');
        }
      })
      .catch((e) => live && setLoadError(describeConsentError(e)));
    return () => {
      live = false;
    };
  }, [query, params.space_id]);

  const wantsBot = !!info?.bot;
  const targets = info?.spaces ?? [];
  const selected = targets.find((s) => s.id === spaceId);
  const grantable = selected?.grantable_permissions ?? 0;
  const spaceLocked = params.disable_space_select === 'true' && targets.some((s) => s.id === params.space_id);
  const requestedRows = useMemo(() => SPACE_ROLE_PERM_ROWS.filter((r) => ((info?.permissions ?? 0) & r.bit) !== 0), [info]);
  const canGrant = (bit: number) => (grantable & (bit | PermAdministrator)) !== 0;

  // Re-seed the checked permissions whenever the space (and so what can be granted) changes.
  useEffect(() => {
    if (!info?.bot) return;
    setGranted(grantableDefaults(info.permissions ?? 0, grantable));
  }, [info, grantable]);

  const appName = info?.application.name ?? '';
  const botName = info ? info.bot?.display_name || info.bot?.username || appName : '';

  async function approve() {
    if (!info) return;
    setBusy(true);
    setError('');
    try {
      const req: AuthorizeQuery & { space_id?: string; permissions?: string } = { ...query };
      if (wantsBot) {
        if (!spaceId) {
          setError(t('oauth.noSpaceSelected'));
          setBusy(false);
          return;
        }
        req.space_id = spaceId;
        req.permissions = String(granted);
      }
      const res = await authorize(req);
      if (res.location) {
        await Linking.openURL(res.location).catch(() => undefined);
        leaveSettingsScreen();
        return;
      }
      setInstalled({ spaceId: res.space_id ?? spaceId, spaceName: selected?.name ?? '' });
    } catch (e) {
      setError(describeConsentError(e));
    } finally {
      setBusy(false);
    }
  }

  function deny() {
    const back = denyRedirect(query.redirect_uri, query.state);
    if (back) void Linking.openURL(back).catch(() => undefined);
    leaveSettingsScreen();
  }

  function openSpace(id: string) {
    setSelectedSpaceId(id);
    openNav();
    router.dismissTo('/' as Href);
  }

  const header = (title: string, avatar?: string | null, name?: string) => (
    <View style={{ alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingBottom: 16 }}>
      <Avatar uri={avatar} name={name ?? title} size="xl" shape="rounded" />
      <Text variant="title" align="center">
        {title}
      </Text>
      <Text variant="caption" align="center">
        {t('oauth.subtitle', { name: me?.display_name || me?.username || '' })}
      </Text>
      {info?.application.description ? (
        <Text variant="caption" align="center">
          {info.application.description}
        </Text>
      ) : null}
    </View>
  );

  if (loadError || !info) {
    return (
      <SettingsScreen title={t('oauth.authorize')}>
        {loadError ? <EmptyState icon="fa-solid fa-triangle-exclamation" title={loadError} size="page" action={<Button title={t('common.close')} variant="outline" onPress={leaveSettingsScreen} />} /> : <Spinner fill />}
      </SettingsScreen>
    );
  }

  if (installed) {
    return (
      <SettingsScreen title={t('oauth.authorizeBot')}>
        <View style={{ alignItems: 'center', gap: 12, padding: 24 }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: withAlpha(theme.colors.primary, 0.15), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={26} tone="primary" />
          </View>
          <Text variant="title" align="center">
            {t('oauth.addedTitle', { bot: botName })}
          </Text>
          <Text tone="muted" align="center">
            {t('oauth.addedBody', { bot: botName, space: installed.spaceName })}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 8, alignSelf: 'stretch' }}>
            <Button title={t('oauth.done')} variant="ghost" style={{ flex: 1 }} onPress={leaveSettingsScreen} />
            <Button title={t('oauth.openSpace')} style={{ flex: 1 }} onPress={() => openSpace(installed.spaceId)} />
          </View>
        </View>
      </SettingsScreen>
    );
  }

  const accountScopes = info.scopes.filter((s) => s !== 'bot');

  return (
    <SettingsScreen
      title={wantsBot ? t('oauth.authorizeBot') : t('oauth.authorize')}
      error={error}
      onDismissError={() => setError('')}
      footer={
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Button title={t('oauth.cancel')} variant="ghost" style={{ flex: 1 }} disabled={busy} onPress={deny} testID="oauth-cancel" />
          <Button
            title={wantsBot ? t('oauth.authorizeBot') : t('oauth.authorize')}
            style={{ flex: 1 }}
            loading={busy}
            disabled={wantsBot && (targets.length === 0 || !spaceId)}
            onPress={() => void approve()}
            testID="oauth-approve"
          />
        </View>
      }
      testID="oauth-consent"
    >
      {wantsBot
        ? header(t('oauth.botTitle', { bot: botName }), info.bot?.avatar || info.application.icon, botName)
        : header(t('oauth.title', { app: appName }), info.application.icon, appName)}

      {wantsBot ? (
        <>
          {targets.length === 0 ? (
            <Note tone="danger">{t('oauth.noSpaces')}</Note>
          ) : spaceLocked ? (
            <ListSection title={t('oauth.addToSpace')} footer={t('oauth.requiresManage')}>
              <SettingItem
                leading={<Avatar uri={selected?.icon} name={selected?.name ?? ''} size="md" shape="rounded" />}
                title={selected?.name ?? ''}
                description={selected?.hosted_on ? t('space.hostedOn', { domain: selected.hosted_on }) : undefined}
              />
            </ListSection>
          ) : (
            <FormCard style={{ marginBottom: 16 }}>
              <Select<string>
                label={t('oauth.addToSpace')}
                value={spaceId}
                options={targets.map((s) => ({
                  value: s.id,
                  label: s.name,
                  description: s.hosted_on ? t('space.hostedOn', { domain: s.hosted_on }) : undefined,
                }))}
                onValueChange={setSpaceId}
                hint={t('oauth.requiresManage')}
              />
            </FormCard>
          )}

          {requestedRows.length === 0 ? (
            <Note>{t('oauth.noPermissions')}</Note>
          ) : (
            <ListSection title={t('oauth.permissionsTitle', { bot: botName })} footer={t('oauth.permissionsHint')}>
              <View style={{ padding: 16, gap: 12 }}>
                {requestedRows.map((r) => (
                  <Checkbox
                    key={r.key}
                    checked={(granted & r.bit) !== 0}
                    disabled={!canGrant(r.bit) || targets.length === 0}
                    onChange={(on) => setGranted((cur) => (on ? cur | r.bit : cur & ~r.bit))}
                    label={r.label}
                    description={canGrant(r.bit) ? r.description : t('oauth.cannotGrant')}
                  />
                ))}
              </View>
            </ListSection>
          )}
        </>
      ) : null}

      {accountScopes.length > 0 ? (
        <ListSection title={t('oauth.willBeAbleTo')}>
          {accountScopes.map((scope) => (
            <SettingItem key={scope} icon={SCOPE_ICON[scope] ?? 'circle-check'} iconColor={theme.colors.primary} title={t(`oauth.scopes.${scopeKey(scope)}`)} />
          ))}
        </ListSection>
      ) : null}
    </SettingsScreen>
  );
}
