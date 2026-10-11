/**
 * The top of a space's room list (SpaceRoomsBar's header): the banner when the space has one,
 * fading into the list; the icon, the name with the official check, and "Hosted on <domain>"
 * for a space mirrored from another instance. Tapping it opens the space sheet - its banner and
 * name over the space's actions (invite, settings, create room/section, mark read, report,
 * leave), each gated as the web's dropdown is.
 */
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { spaceMembers } from '@web/stores/spaceMembers';
import { useSolid } from '@/bridge/solid';
import { useSpace } from '@/data';
import { useTheme } from '@/theme';
import { Icon, Text, Touchable, showActionSheet, withAlpha } from '@/ui';
import { spaceMenuEntries } from '../menus';
import { SpaceIcon } from '../SpaceIcon';

const BANNER_HEIGHT = 112;

function Banner({ uri, height }: { uri: string; height: number }) {
  const theme = useTheme();
  return (
    <View style={[StyleSheet.absoluteFill, { height }]} pointerEvents="none">
      <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" recyclingKey={uri} />
      {/* A stepped fade to the list's surface (no gradient dependency). */}
      <View style={[styles.fadeTop, { backgroundColor: withAlpha(theme.colors.card, 0.1) }]} />
      <View style={[styles.fadeMid, { backgroundColor: withAlpha(theme.colors.card, 0.55) }]} />
      <View style={[styles.fadeBottom, { backgroundColor: withAlpha(theme.colors.card, 0.85) }]} />
    </View>
  );
}

/** The space sheet's header: banner, icon, name, official / hosted-on, member count. */
export function SpaceSheetHeader({ spaceId }: { spaceId: string }) {
  const theme = useTheme();
  const space = useSpace(spaceId);
  const members = useSolid(() => spaceMembers.bySpaceId[spaceId]?.length, [spaceId]);
  if (!space) return null;
  const name = space.name || t('space.unnamed');
  const domain = space.federation?.origin_domain;
  return (
    <View style={styles.sheetHeader}>
      {space.banner ? (
        <View style={[styles.sheetBanner, { borderRadius: theme.radii.lg }]}>
          <Image source={{ uri: space.banner }} style={StyleSheet.absoluteFill} contentFit="cover" />
        </View>
      ) : null}
      <View style={styles.sheetIdentity}>
        <SpaceIcon name={name} initials={space.initials} icon={space.icon} size={52} radius={16} />
        <View style={styles.flex}>
          <View style={styles.nameLine}>
            <Text variant="heading" numberOfLines={2} style={styles.shrink}>
              {name}
            </Text>
            {space.official ? <Icon name="fa-circle-check" size={15} tone="primary" accessibilityLabel={t('space.official')} /> : null}
          </View>
          {domain ? <Text variant="caption">{t('space.hostedOn', { domain })}</Text> : null}
          {members !== undefined ? <Text variant="caption">{t('discover.members', { count: members })}</Text> : null}
        </View>
      </View>
      {space.description ? (
        <Text variant="caption" numberOfLines={3}>
          {space.description}
        </Text>
      ) : null}
    </View>
  );
}

export function openSpaceSheet(spaceId: string): void {
  void showActionSheet(spaceMenuEntries(spaceId, 'header'), { header: <SpaceSheetHeader spaceId={spaceId} /> });
}

export function SpaceHeader({ spaceId }: { spaceId: string }) {
  const theme = useTheme();
  const space = useSpace(spaceId);
  if (!space) return null;
  const name = space.name || t('emoji.picker.space');
  const domain = space.federation?.origin_domain;
  const height = space.banner ? BANNER_HEIGHT : 56;
  const label = [name, space.official ? t('space.official') : null, domain ? t('space.hostedOn', { domain }) : null]
    .filter(Boolean)
    .join(', ');
  return (
    <View
      style={[
        styles.header,
        { height, borderBottomColor: theme.colors.border, backgroundColor: theme.colors.card },
      ]}
    >
      {space.banner ? <Banner uri={space.banner} height={height} /> : null}
      <Touchable
        feedback="highlight"
        onPress={() => openSpaceSheet(spaceId)}
        accessibilityLabel={label}
        accessibilityHint={t('mobile.nav.spaceMenuHint')}
        style={[styles.trigger, { borderRadius: theme.radii.md }]}
      >
        <SpaceIcon name={name} initials={space.initials} icon={space.icon} size={32} radius={10} />
        <View style={styles.flex}>
          <View style={styles.nameLine}>
            <Text variant="heading" numberOfLines={1} style={styles.shrink}>
              {name}
            </Text>
            {space.official ? <Icon name="fa-circle-check" size={13} tone="primary" /> : null}
          </View>
          {domain ? (
            <Text variant="caption" numberOfLines={1}>
              {t('space.hostedOn', { domain })}
            </Text>
          ) : null}
        </View>
        <Icon name="fa-chevron-down" size={12} tone="muted" />
      </Touchable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    justifyContent: 'flex-end',
    paddingHorizontal: 8,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  fadeTop: { position: 'absolute', start: 0, end: 0, top: 0, height: '40%' },
  fadeMid: { position: 'absolute', start: 0, end: 0, top: '40%', height: '30%' },
  fadeBottom: { position: 'absolute', start: 0, end: 0, bottom: 0, height: '30%' },
  trigger: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 8 },
  flex: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  shrink: { flexShrink: 1 },
  sheetHeader: { gap: 10, paddingHorizontal: 16, paddingBottom: 8 },
  sheetBanner: { height: 96, overflow: 'hidden' },
  sheetIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
