/**
 * The bottom tab bar (MobileTabBar): Home, Notifications (with everything waiting on you as a
 * badge) and You (your own avatar and status). A tap only switches what the nav panel shows -
 * it never moves the conversation - and the bar travels with the nav panel, so it is out of
 * sight while a conversation is in front.
 */
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { useMe, useNotificationBadgeCount } from '@/data';
import { setShellTab, shell, type ShellTab } from '@/shell/state';
import { useTheme } from '@/theme';
import { Badge, Icon, Text, Touchable, UserAvatar, haptics } from '@/ui';

export const TAB_BAR_HEIGHT = 56;

function Tab({
  tab,
  active,
  label,
  badge,
  children,
}: {
  tab: ShellTab;
  active: boolean;
  label: string;
  badge?: number;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const a11y = badge ? `${label}, ${t('mobile.nav.waiting', { count: badge })}` : label;
  return (
    <Touchable
      feedback="opacity"
      accessibilityRole="tab"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: active }}
      onPress={() => {
        if (!active) haptics.selection();
        setShellTab(tab);
      }}
      style={styles.tab}
    >
      <View style={[styles.indicator, { backgroundColor: active ? theme.colors.primary : 'transparent' }]} />
      <View>
        {children}
        {badge ? <Badge count={badge} ringColor={theme.colors.card} style={styles.badge} /> : null}
      </View>
      <Text variant="caption" weight={active ? 'semibold' : 'medium'} tone={active ? 'default' : 'muted'} numberOfLines={1}>
        {label}
      </Text>
    </Touchable>
  );
}

export function TabBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const tab = useSolid(() => shell.tab());
  const badge = useNotificationBadgeCount();
  const me = useMe();
  const name = me?.display_name || me?.username || '';
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={t('mobile.tabs.aria')}
      style={[
        styles.bar,
        {
          height: TAB_BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          backgroundColor: theme.colors.card,
          borderTopColor: theme.colors.border,
        },
      ]}
    >
      <Tab tab="home" active={tab === 'home'} label={t('nav.home')}>
        <Icon name="fa-house" size={20} color={tab === 'home' ? theme.colors.foreground : theme.colors.mutedForeground} />
      </Tab>
      <Tab tab="notifications" active={tab === 'notifications'} label={t('mobile.tabs.notifications')} badge={badge}>
        <Icon
          name="fa-bell"
          size={20}
          color={tab === 'notifications' ? theme.colors.foreground : theme.colors.mutedForeground}
        />
      </Tab>
      <Tab tab="you" active={tab === 'you'} label={t('mobile.tabs.you')}>
        {me ? (
          <UserAvatar userId={me.id} name={name} uri={me.avatar} size="sm" highlighted={tab === 'you'} ringColor={theme.colors.card} />
        ) : (
          <Icon name="fa-user" size={20} tone="muted" />
        )}
      </Tab>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 44 },
  indicator: { position: 'absolute', top: 0, height: 2, width: '40%', borderRadius: 1 },
  badge: { position: 'absolute', top: -6, end: -12 },
});
