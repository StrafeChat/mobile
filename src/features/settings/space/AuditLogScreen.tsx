/**
 * Space settings -> Audit log (SpaceAuditLogPage): who changed what, newest first, 50 at a
 * time with more loading as you scroll, filterable by action; each entry expands to show the
 * fields that changed (old struck through -> new; a space-profile reset lists what it cleared).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { formatDate, t } from '@web/i18n/t';
import { AUDIT_ACTION_TYPES, listSpaceAuditLog, type AuditLogEntry, type UserSummary } from '@web/api/spaces';
import { useTheme } from '@/theme';
import { Avatar, EmptyState, Icon, Select, Spinner, Text, Touchable, withAlpha } from '@/ui';
import { AUDIT_ACTION_ICON, AUDIT_DESTRUCTIVE, auditChangeValue, auditFieldLabel, auditLookups, auditSentence, auditUserName, isAuditChangePair, type AuditLookups } from './auditFormat';
import { SpacePage } from './SpacePage';
import type { SpaceSettingsData } from './useSpaceSettings';

const PAGE = 50;

function Entry({ entry, lookups, open, onToggle }: { entry: AuditLogEntry; lookups: AuditLookups; open: boolean; onToggle: () => void }) {
  const theme = useTheme();
  const actor = lookups.users[entry.user_id];
  const changes = entry.changes ? Object.entries(entry.changes) : [];
  const hasChanges = changes.length > 0;
  const destructive = AUDIT_DESTRUCTIVE.has(entry.action_type);
  const sentence = auditSentence(entry, lookups);
  const when = formatDate(entry.created_at, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <Touchable
      onPress={hasChanges ? onToggle : undefined}
      disabled={!hasChanges}
      feedback={hasChanges ? 'highlight' : 'none'}
      accessibilityRole={hasChanges ? 'button' : 'text'}
      accessibilityState={hasChanges ? { expanded: open } : undefined}
      accessibilityLabel={`${sentence}, ${when}${entry.reason ? `, ${t('spaceSettings.audit.reason')}: ${entry.reason}` : ''}`}
      accessibilityHint={hasChanges ? t('spaceSettings.audit.toggleDetails') : undefined}
      style={{ flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
    >
      <View>
        <Avatar uri={actor?.avatar} name={auditUserName(entry.user_id, lookups)} size="lg" />
        <View
          style={{
            position: 'absolute',
            bottom: -3,
            end: -3,
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: theme.colors.background,
            backgroundColor: destructive ? theme.colors.destructive : theme.colors.muted,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name={AUDIT_ACTION_ICON[entry.action_type] ?? 'pen'} size={9} color={destructive ? theme.colors.destructiveForeground : theme.colors.foreground} />
        </View>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text>{sentence}</Text>
        <Text variant="caption">
          {when}
          {entry.reason ? ` · ${t('spaceSettings.audit.reason')}: ${entry.reason}` : ''}
        </Text>
        {open && hasChanges ? (
          <View style={{ marginTop: 6, padding: 10, gap: 6, borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: withAlpha(theme.colors.muted, 0.6) }}>
            {changes.map(([key, c]) => (
              <View key={key} style={{ gap: 2 }}>
                <Text variant="caption" weight="semibold">
                  {auditFieldLabel(key)}
                </Text>
                <Text variant="caption" tone="default">
                  {isAuditChangePair(c) ? (
                    <>
                      {c.old !== undefined ? (
                        <>
                          <Text variant="caption" style={{ textDecorationLine: 'line-through', opacity: 0.6 }}>
                            {auditChangeValue(key, c.old, lookups)}
                          </Text>
                          {'  →  '}
                        </>
                      ) : null}
                      {auditChangeValue(key, c.new, lookups)}
                    </>
                  ) : (
                    auditChangeValue(key, c, lookups)
                  )}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {hasChanges ? <Icon name={open ? 'chevron-up' : 'chevron-down'} size={12} tone="muted" /> : null}
    </Touchable>
  );
}

function AuditLog({ data, setError }: { data: SpaceSettingsData; setError: (m: string) => void }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [users, setUsers] = useState<Record<string, UserSummary>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(false);
  const [action, setAction] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const busy = useRef(false);
  const seq = useRef(0);

  const load = useCallback(
    async (reset: boolean, opts: { action: string; pull?: boolean; before?: string }) => {
      if (busy.current && !reset) return;
      busy.current = true;
      const id = ++seq.current;
      if (opts.pull) setRefreshing(true);
      else setLoading(true);
      setError('');
      try {
        const page = await listSpaceAuditLog(data.spaceId, { before: reset ? undefined : opts.before, limit: PAGE, action: opts.action || undefined });
        if (id !== seq.current) return;
        setUsers((prev) => ({ ...prev, ...page.users }));
        setEntries((prev) => (reset ? page.entries : [...prev, ...page.entries]));
        setMore(page.entries.length >= PAGE);
      } catch (e) {
        if (id === seq.current) setError(e instanceof Error ? e.message : t('spaceSettings.audit.loadFailed'));
      } finally {
        if (id === seq.current) {
          setLoading(false);
          setRefreshing(false);
          busy.current = false;
        }
      }
    },
    [data.spaceId, setError],
  );

  useEffect(() => {
    void load(true, { action });
  }, [load, action]);

  const lookups = useMemo(() => auditLookups(users, data.roles, data.rooms, data.members), [users, data.roles, data.rooms, data.members]);

  return (
    <FlashList
      data={entries}
      keyExtractor={(e) => e.id}
      extraData={expanded}
      refreshing={refreshing}
      onRefresh={() => void load(true, { action, pull: true })}
      onEndReachedThreshold={0.5}
      onEndReached={() => {
        if (more && !loading && entries.length) void load(false, { action, before: entries[entries.length - 1]!.id });
      }}
      ListHeaderComponent={
        <View style={{ paddingHorizontal: 12, paddingBottom: 8 }}>
          <Select<string>
            label={t('spaceSettings.audit.filter')}
            value={action}
            options={[{ value: '', label: t('spaceSettings.audit.allActions') }, ...AUDIT_ACTION_TYPES.map((a) => ({ value: a, label: t(`spaceSettings.audit.names.${a}`), icon: AUDIT_ACTION_ICON[a] }))]}
            onValueChange={setAction}
          />
        </View>
      }
      ListEmptyComponent={loading ? <Spinner fill /> : <EmptyState icon="fa-solid fa-clipboard-list" body={t('spaceSettings.audit.none')} />}
      ListFooterComponent={loading && entries.length ? <Spinner style={{ padding: 16 }} /> : null}
      renderItem={({ item }) => (
        <Entry
          entry={item}
          lookups={lookups}
          open={expanded.has(item.id)}
          onToggle={() =>
            setExpanded((prev) => {
              const next = new Set(prev);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              return next;
            })
          }
        />
      )}
    />
  );
}

export function SpaceAuditLogScreen() {
  return (
    <SpacePage page="audit" scroll={false}>
      {(data, { setError }) => <AuditLog data={data} setError={setError} />}
    </SpacePage>
  );
}
