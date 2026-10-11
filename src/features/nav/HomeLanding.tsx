/**
 * Home (HomePage): what the content side shows with nothing open - a time-of-day greeting and
 * the three ways to get going: add friends, start a group, create a space. On a phone the rails
 * are the real home; this is the empty state behind them (and the tablet's first screen).
 */
import { ScrollView, StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { useMe } from '@/data';
import { openShellView } from '@/shell/state';
import { useTheme } from '@/theme';
import { Button, Icon, Text, withAlpha } from '@/ui';
import { ContentHeader } from './ContentHeader';
import { openCreateSpace } from './navigation';
import { openCreateGroupSheet } from './sheets/store';

/** HomePage.greetingKey: morning 5-11, afternoon 12-16, evening 17-20, night otherwise. */
export function greetingKey(hour: number): string {
  if (hour >= 5 && hour < 12) return 'home.greetingMorning';
  if (hour >= 12 && hour < 17) return 'home.greetingAfternoon';
  if (hour >= 17 && hour < 21) return 'home.greetingEvening';
  return 'home.greetingNight';
}

export function HomeLanding() {
  const theme = useTheme();
  const me = useMe();
  const name = me?.display_name || me?.username || t('home.there');
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <ContentHeader title={t('nav.home')} icon="fa-house" />
      <ScrollView contentContainerStyle={styles.center}>
        <View
          style={[
            styles.card,
            { borderRadius: theme.radii.xl, borderColor: theme.colors.border, backgroundColor: withAlpha(theme.colors.card, 0.8) },
          ]}
        >
          <View style={[styles.badge, { backgroundColor: withAlpha(theme.colors.primary, 0.15), borderRadius: theme.radii.lg }]}>
            <Icon name="fa-shield-halved" size={26} tone="primary" />
          </View>
          <Text variant="title" align="center" accessibilityRole="header">
            {t('home.greeting', { greeting: t(greetingKey(new Date().getHours())), name })}
          </Text>
          <Text tone="muted" align="center">
            {t('home.welcome')}
          </Text>
          <View style={styles.actions}>
            <Button title={t('home.addFriends')} icon="fa-user-plus" fullWidth onPress={() => openShellView({ kind: 'friends' })} />
            <Button title={t('home.startGroup')} icon="fa-user-group" variant="secondary" fullWidth onPress={openCreateGroupSheet} />
            <Button title={t('home.createSpace')} icon="fa-plus" variant="outline" fullWidth onPress={openCreateSpace} />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 440, padding: 24, gap: 12, alignItems: 'center', borderWidth: StyleSheet.hairlineWidth },
  badge: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  actions: { alignSelf: 'stretch', gap: 10, marginTop: 12 },
});
