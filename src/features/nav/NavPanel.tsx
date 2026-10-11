/**
 * The nav side of the shell (the web's mobile nav panel): on the Home tab, the space rail
 * beside either the PM list (Home selected) or the selected space's rooms; on the
 * Notifications and You tabs, that tab's panel across the whole width; the bottom tab bar
 * under all of them. It also hosts the nav area's sheets and keeps the app icon badge in step
 * with the Notifications badge.
 *
 * The selected space is the shell's (`selectedSpaceId`): opening a room selects its space, and
 * a space that disappears (left, kicked, deleted) drops the selection back to Home.
 */
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Notifications from 'expo-notifications';
import { spaces } from '@web/stores/spaces';
import { useSolid } from '@/bridge/solid';
import { useNotificationBadgeCount } from '@/data';
import { setSelectedSpaceId, shell } from '@/shell/state';
import { useTheme } from '@/theme';
import { HomeList } from './home/HomeList';
import { NotificationsPanel } from './notifications/NotificationsPanel';
import { SpaceRail } from './rail/SpaceRail';
import { NavSheets } from './sheets/NavSheets';
import { SpaceRoomList } from './space/SpaceRoomList';
import { TabBar } from './TabBar';
import { YouPanel } from './you/YouPanel';

/** A selected space that no longer exists (after hydration) means Home. */
function useDropMissingSpace(selected: string | null): void {
  const missing = useSolid(
    () => !!selected && spaces.hydrated && !spaces.spaces.some((s) => s.id === selected),
    [selected],
  );
  useEffect(() => {
    if (missing) setSelectedSpaceId(null);
  }, [missing]);
}

/** The launcher / home-screen badge follows the Notifications tab's count, and clears when the
 * signed-in app goes away (sign-out). iOS shows it only with notification permission. */
function useAppIconBadge(count: number): void {
  useEffect(() => {
    Notifications.setBadgeCountAsync(count).catch(() => undefined);
  }, [count]);
  useEffect(
    () => () => {
      Notifications.setBadgeCountAsync(0).catch(() => undefined);
    },
    [],
  );
}

export function NavPanel() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tab = useSolid(() => shell.tab());
  const selected = useSolid(() => shell.selectedSpaceId());
  const badge = useNotificationBadgeCount();
  useDropMissingSpace(selected);
  useAppIconBadge(badge);

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.card, paddingTop: insets.top }]}>
      <View style={styles.fill}>
        {tab === 'home' ? (
          <View style={styles.row}>
            <SpaceRail />
            <View style={[styles.list, { borderStartColor: theme.colors.border }]}>
              {selected ? <SpaceRoomList key={selected} spaceId={selected} /> : <HomeList />}
            </View>
          </View>
        ) : tab === 'notifications' ? (
          <NotificationsPanel />
        ) : (
          <YouPanel />
        )}
      </View>
      <TabBar />
      <NavSheets />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  row: { flex: 1, flexDirection: 'row' },
  list: {
    flex: 1,
    minWidth: 0,
    borderStartWidth: StyleSheet.hairlineWidth,
    borderTopStartRadius: 12,
    overflow: 'hidden',
  },
});
