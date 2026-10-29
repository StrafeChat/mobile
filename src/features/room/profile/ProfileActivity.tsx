/**
 * What the person is playing, on the profile sheet and the full profile (the web's
 * ProfileActivity, components/ActivityStatus): "Playing a game", the game's name and how long,
 * "for 1 hr 2 min", moving on while the card is open.
 *
 * Read live from the presence store by user id - the profile subject is a snapshot taken when
 * the sheet opened and would freeze both the game and the clock. Nothing renders while they
 * are not playing, or are offline or invisible. The name is plain text (never a link,
 * markdown, emoji or mentions), isolated so a right-to-left one cannot reorder the line.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { activityElapsedLabel, useActivity, type Activity } from '@/data';
import { useTheme } from '@/theme';
import { Icon, Text, bidiIsolate, withAlpha } from '@/ui';
import { SectionLabel } from './SectionLabel';

/** How often the duration is re-read: within the minute, like the web's 15 s clock. */
const CLOCK_MS = 15_000;

/** Date.now(), re-read every CLOCK_MS while `ticking` (and the component is mounted). */
function useClock(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, [ticking]);
  return now;
}

function ActivityCard({ activity }: { activity: Activity }) {
  const theme = useTheme();
  const now = useClock(!!activity.started_at);
  const elapsed = activityElapsedLabel(activity.started_at, now);
  const heading = t('activity.playingGame');
  return (
    <View
      accessible
      accessibilityLabel={[heading, activity.name, elapsed].filter(Boolean).join(', ')}
      testID="profile-activity"
    >
      <SectionLabel>{heading}</SectionLabel>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderRadius: theme.radii.lg,
          borderWidth: 1,
          borderColor: withAlpha(theme.colors.border, 0.7),
          backgroundColor: withAlpha(theme.colors.muted, 0.3),
        }}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: theme.radii.lg,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: withAlpha(theme.colors.primary, 0.15),
          }}
        >
          <Icon name="gamepad" size={16} color={theme.colors.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="label" weight="semibold" numberOfLines={1}>
            {bidiIsolate(activity.name)}
          </Text>
          {elapsed ? (
            <Text variant="caption" numberOfLines={1} style={{ marginTop: 2 }}>
              {elapsed}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** The card for `userId`, or nothing when they are not playing (or not around). */
export function ProfileActivity({ userId }: { userId: string | null | undefined }) {
  const activity = useActivity(userId);
  return activity ? <ActivityCard activity={activity} /> : null;
}
