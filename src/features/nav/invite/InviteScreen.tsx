/**
 * An invite (InvitePage): the public preview of the space - icon, name, who invited you,
 * "Hosted on <domain>" for a space on another instance, its description - and Join, or Open
 * when you are already in it. `code@domain` invites are joined through this instance, which
 * proxies to the space's origin; the code arrives percent-encoded from links and is decoded.
 *
 * Membership is matched on the preview's id and, for a mirrored space, on the origin id the
 * mirror carries (the web compares only the first, so it can miss a mirrored membership).
 * Signed out there is nothing to join with: the screen points to sign-in.
 */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { getInvitePreview, joinSpaceByInvite, parseInviteCode, type InvitePreview } from '@web/api/spaces';
import { addOrUpdateSpace, spaces } from '@web/stores/spaces';
import { useSolid } from '@/bridge/solid';
import { useSession } from '@/data';
import { useTheme } from '@/theme';
import { Banner, Button, EmptyState, Header, Spinner, Text } from '@/ui';
import { errorMessage } from '../actions';
import { closeScreenToShell, goBack, goToSpace, replaceRoute } from '../navigation';
import { SpaceIcon } from '../SpaceIcon';

/** The route segment as typed in a link: a federated code's "@" may be percent-encoded. */
export function decodeInviteParam(raw: string | string[] | undefined): string {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (!s) return '';
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** The local id of the space an invite is for, when this account is already in it. */
export function memberSpaceId(
  preview: InvitePreview,
  mine: readonly { id: string; federation?: { origin_id: string; origin_domain: string } }[],
  codeDomain = '',
): string | null {
  const id = preview.space.id;
  const direct = mine.find((s) => s.id === id);
  if (direct) return direct.id;
  // A preview of a space this instance mirrors carries the mirror's id; one fetched from the
  // origin (a `code@domain` invite) carries the origin's own id, which our mirror records as
  // federation.origin_id - on the domain the code names.
  const origin = preview.space.federation;
  const originId = origin?.origin_id ?? id;
  const originDomain = (origin?.origin_domain ?? codeDomain).toLowerCase();
  if (!originDomain) return null;
  const mirrored = mine.find(
    (s) => s.federation && s.federation.origin_id === originId && s.federation.origin_domain.toLowerCase() === originDomain,
  );
  return mirrored?.id ?? null;
}

type State = { status: 'loading' } | { status: 'invalid' } | { status: 'ready'; preview: InvitePreview };

export function InviteScreen({ code }: { code: string }) {
  const theme = useTheme();
  const session = useSession();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const mine = useSolid(() => spaces.spaces.map((s) => ({ id: s.id, ...(s.federation ? { federation: { ...s.federation } } : {}) })));

  useEffect(() => {
    let alive = true;
    if (!code) {
      setState({ status: 'invalid' });
      return;
    }
    setState({ status: 'loading' });
    getInvitePreview(code)
      .then((preview) => {
        if (alive) setState(preview?.space ? { status: 'ready', preview } : { status: 'invalid' });
      })
      .catch(() => {
        if (alive) setState({ status: 'invalid' });
      });
    return () => {
      alive = false;
    };
  }, [code]);

  const join = useCallback(async () => {
    setError('');
    setJoining(true);
    try {
      const space = await joinSpaceByInvite(code);
      addOrUpdateSpace(space);
      goToSpace(space.id, { fromScreen: true });
    } catch (err) {
      setError(errorMessage(err, 'invite.joinFailed'));
    } finally {
      setJoining(false);
    }
  }, [code]);

  let body: React.ReactNode;
  if (state.status === 'loading') {
    body = (
      <View style={styles.center}>
        <Spinner />
        <Text tone="muted">{t('invite.loading')}</Text>
      </View>
    );
  } else if (state.status === 'invalid') {
    body = (
      <EmptyState
        size="page"
        icon="fa-solid fa-link-slash"
        title={t('invite.invalidTitle')}
        body={t('invite.invalidBody')}
        action={<Button title={t('invite.goHome')} variant="outline" onPress={closeScreenToShell} />}
      />
    );
  } else {
    const { preview } = state;
    const sp = preview.space;
    const name = sp.name || t('space.unnamed');
    const memberOf = memberSpaceId(preview, mine, parseInviteCode(code)?.domain ?? '');
    const domain = sp.federation?.origin_domain;
    body = (
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.card, { borderRadius: theme.radii.xl, borderColor: theme.colors.border, backgroundColor: theme.colors.card }]}>
          <Text variant="overline">{t('invite.youAreInvited')}</Text>
          <View style={styles.identity}>
            <SpaceIcon
              name={name}
              initials={sp.name_acronym || sp.name?.slice(0, 2).toUpperCase() || '?'}
              icon={sp.icon}
              size={64}
              radius={18}
            />
            <View style={styles.flex}>
              <Text variant="title" numberOfLines={2}>
                {name}
              </Text>
              {preview.inviter?.display_name ? (
                <Text tone="muted">{t('invite.invitedBy', { name: preview.inviter.display_name })}</Text>
              ) : null}
              {domain ? <Text variant="caption">{t('space.hostedOn', { domain })}</Text> : null}
              {preview.member_count !== undefined ? (
                <Text variant="caption">{t('discover.members', { count: preview.member_count })}</Text>
              ) : null}
            </View>
          </View>
          {sp.description ? (
            <Text tone="muted" numberOfLines={3}>
              {sp.description}
            </Text>
          ) : null}
          {error ? <Banner tone="error" message={error} /> : null}
          {!session.signedIn ? (
            <View style={styles.actions}>
              <Text tone="muted">{t('invite.logInToJoin')}</Text>
              <Button title={t('invite.logIn')} fullWidth onPress={() => replaceRoute('/sign-in')} />
            </View>
          ) : memberOf ? (
            <View style={styles.actions}>
              <Text tone="muted">{t('invite.alreadyMember')}</Text>
              <Button title={t('invite.openSpace')} fullWidth onPress={() => goToSpace(memberOf, { fromScreen: true })} />
            </View>
          ) : (
            <Button title={t('invite.joinNamed', { name })} fullWidth loading={joining} onPress={() => void join()} />
          )}
        </View>
      </ScrollView>
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <Header title={t('invite.joinSpace')} onBack={goBack} border={false} transparent />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  scroll: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 460, padding: 20, gap: 14, borderWidth: StyleSheet.hairlineWidth },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  actions: { gap: 10 },
});
