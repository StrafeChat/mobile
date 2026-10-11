/**
 * Pieces the admin dashboard screens share (AdminPage.tsx): ban durations, name / handle /
 * date formatting, the stat-number rule, the server gate, and small chips.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { formatDate, t } from '@web/i18n/t';
import { getInstanceCapabilities, type AdminUser } from '@web/api/instance';
import { formatHandle } from '@web/stores/instance';
import { useTheme } from '@/theme';
import { SegmentedControl, Text, withAlpha } from '@/ui';

const DAY = 24 * 60 * 60;

/** Ban lengths (the server caps them at a year). */
export const ADMIN_DURATIONS = [
  { seconds: 0, key: 'admin.durations.forever' },
  { seconds: DAY, key: 'admin.durations.day' },
  { seconds: 7 * DAY, key: 'admin.durations.week' },
  { seconds: 30 * DAY, key: 'admin.durations.month' },
  { seconds: 365 * DAY, key: 'admin.durations.year' },
] as const;

export const adminWhen = (iso?: string) => (iso ? formatDate(iso, { dateStyle: 'medium', timeStyle: 'short' }) || iso : '');
export const adminTag = (u: AdminUser | null | undefined) => (u ? formatHandle(u) : t('common.unknown'));
export const adminName = (u: AdminUser | null | undefined) => u?.display_name || u?.username || t('common.unknown');

/** A stat value: -1 is the server saying "could not determine" - a dash, never a wrong 0. */
export function statNumber(v: number): string {
  return v < 0 ? '—' : v.toLocaleString();
}

/** The badge count on a tab: only positive numbers. */
export function statCount(v?: number): number | undefined {
  return v != null && v > 0 ? v : undefined;
}

export function DurationPicker({ value, onChange, disabled }: { value: number; onChange: (s: number) => void; disabled?: boolean }) {
  return (
    <View style={{ gap: 6 }}>
      <Text variant="label">{t('admin.users.banDuration')}</Text>
      <SegmentedControl<string>
        size="sm"
        scrollable
        value={String(value)}
        onChange={(v) => onChange(Number(v))}
        accessibilityLabel={t('admin.users.banDuration')}
        items={ADMIN_DURATIONS.map((d) => ({ id: String(d.seconds), label: t(d.key), disabled }))}
      />
    </View>
  );
}

export type ChipTone = 'primary' | 'danger' | 'muted' | 'warning';

export function Chip({ label, tone = 'muted' }: { label: string; tone?: ChipTone }) {
  const theme = useTheme();
  const c = tone === 'primary' ? theme.colors.primary : tone === 'danger' ? theme.colors.destructive : tone === 'warning' ? theme.colors.warning : theme.colors.mutedForeground;
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: withAlpha(c, 0.15), alignSelf: 'flex-start' }}>
      <Text variant="caption" weight="semibold" color={c} maxFontSizeMultiplier={1.4}>
        {label}
      </Text>
    </View>
  );
}

/**
 * Whether this account administers the instance - asked of the server every time, never the
 * cached flag (a deep link here can beat READY), failing closed. null while asking.
 */
export function useAdminGate(): boolean | null {
  const [admin, setAdmin] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    getInstanceCapabilities()
      .then((r) => live && setAdmin(r.instance_admin === true))
      .catch(() => live && setAdmin(false));
    return () => {
      live = false;
    };
  }, []);
  return admin;
}
