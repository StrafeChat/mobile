/**
 * The card under a space invite link (the web's SpaceInviteLinkEmbed): a skeleton while the
 * preview loads; "Invalid invite" with a way to the invite page if it fails; otherwise the
 * banner, icon, name, member cap, inviter and - for a space hosted on another instance -
 * where it lives, with "Join space" (or "Go to space" when already a member). The app is only
 * ever signed in, so the web's logged-out "Log in to join" does not apply here.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { t } from '@web/i18n/t';
import { getInvitePreview, joinSpaceByInvite, type InvitePreview } from '@web/api/spaces';
import { addOrUpdateSpace, spaces } from '@web/stores/spaces';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Button, haptics, Skeleton, Text, Touchable } from '@/ui';
import { useMediaMaxWidth } from '../layout';
import { errorText, openInvitePage, openSpace } from '../navigation';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; preview: InvitePreview };

const previews = new Map<string, Promise<InvitePreview>>();

/** One request per code per session (rows are recycled and remounted while scrolling). */
function loadPreview(code: string): Promise<InvitePreview> {
  let p = previews.get(code);
  if (!p) {
    p = getInvitePreview(code);
    p.catch(() => previews.delete(code));
    previews.set(code, p);
  }
  return p;
}

export function InviteEmbed({ code }: { code: string }) {
  const theme = useTheme();
  const maxW = useMediaMaxWidth(448);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    let live = true;
    setState({ status: 'loading' });
    loadPreview(code).then(
      (preview) => live && setState({ status: 'ready', preview }),
      () => live && setState({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [code]);

  const spaceId = state.status === 'ready' ? state.preview.space.id : null;
  const member = useSolid(() => (spaceId ? spaces.spaces.some((s) => s.id === spaceId) : false), [spaceId]);

  const card = [
    styles.card,
    { width: maxW, borderColor: theme.colors.border, backgroundColor: theme.colors.card, borderRadius: theme.radii.xl },
  ];

  if (state.status === 'loading') {
    return (
      <View style={[card, styles.pad]} accessibilityLabel={t('invite.loading')}>
        <Skeleton height={80} radius={theme.radii.md} />
        <View style={styles.row}>
          <Skeleton width={56} height={56} radius={theme.radii.lg} />
          <View style={styles.flex}>
            <Skeleton width="66%" height={14} />
            <Skeleton width="50%" height={12} style={styles.gapTop} />
          </View>
        </View>
        <Skeleton height={40} radius={theme.radii.md} style={styles.gapTop} />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={[card, styles.pad]}>
        <Text variant="label">{t('invite.invalidTitle')}</Text>
        <Text variant="caption" style={styles.gapTop}>
          {t('invite.invalidShort')}
        </Text>
        <Touchable feedback="opacity" onPress={() => openInvitePage(code)} accessibilityRole="link" style={styles.gapTop}>
          <Text variant="label" tone="primary" style={styles.underline}>
            {t('invite.openPage')}
          </Text>
        </Touchable>
      </View>
    );
  }

  const { space, inviter } = state.preview;
  const banner = space.banner?.trim();
  const icon = space.icon?.trim();
  const acronym = space.name_acronym || space.name?.slice(0, 2).toUpperCase() || '?';

  const join = async () => {
    setJoinError('');
    setJoining(true);
    try {
      const joined = await joinSpaceByInvite(code);
      addOrUpdateSpace(joined);
      haptics.success();
      openSpace(joined.id);
    } catch (err) {
      setJoinError(errorText(err) || t('invite.joinFailed'));
    } finally {
      setJoining(false);
    }
  };

  return (
    <View style={card}>
      {banner ? <Image source={{ uri: banner }} style={styles.banner} contentFit="cover" recyclingKey={banner} /> : null}
      <View style={[styles.head, banner ? styles.headOverBanner : null]}>
        <View
          style={[
            styles.icon,
            { borderColor: theme.colors.card, backgroundColor: theme.colors.muted, borderRadius: theme.radii.lg },
          ]}
        >
          {icon ? (
            <Image source={{ uri: icon }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={icon} />
          ) : (
            <Text variant="title" tone="primary">
              {acronym}
            </Text>
          )}
        </View>
        <View style={[styles.flex, banner ? styles.textBelowBanner : null]}>
          <Text variant="heading" numberOfLines={1}>
            {space.name}
          </Text>
          {space.max_members > 0 ? <Text variant="caption">{t('invite.upToMembers', { count: space.max_members })}</Text> : null}
          {inviter?.display_name ? <Text variant="caption">{t('invite.invitedBy', { name: inviter.display_name })}</Text> : null}
          {space.federation?.origin_domain ? (
            <Text variant="caption">{t('space.hostedOn', { domain: space.federation.origin_domain })}</Text>
          ) : null}
        </View>
      </View>
      <View style={[styles.foot, { borderTopColor: theme.colors.border }]}>
        {joinError ? (
          <Text variant="caption" tone="danger" style={styles.error}>
            {joinError}
          </Text>
        ) : null}
        {member ? (
          <Button title={t('invite.goToSpace')} onPress={() => openSpace(space.id)} fullWidth />
        ) : (
          <Button title={joining ? t('invite.joining') : t('invite.joinSpace')} loading={joining} onPress={() => void join()} fullWidth />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden', marginTop: 6, maxWidth: '100%' },
  pad: { padding: 16, gap: 10 },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  gapTop: { marginTop: 6 },
  underline: { textDecorationLine: 'underline' },
  banner: { height: 96, width: '100%' },
  head: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12, alignItems: 'flex-start' },
  headOverBanner: { marginTop: -32, paddingTop: 0 },
  textBelowBanner: { paddingTop: 36 },
  icon: { width: 64, height: 64, borderWidth: 2, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  foot: { borderTopWidth: StyleSheet.hairlineWidth, padding: 16, paddingTop: 12, gap: 8 },
  error: { marginBottom: 2 },
});

