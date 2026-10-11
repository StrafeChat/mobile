/**
 * Discord's "name · N messages · View thread" strip under a message that started a thread
 * (the web's MessageThreadFooter). Active threads come with READY and sit in the space's room
 * list; an archived or unlisted one is fetched once; one the viewer cannot see shows nothing.
 */
import { memo, useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { t } from '@web/i18n/t';
import { getThread } from '@web/api/threads';
import { spaceRoomFromPayload, spaces } from '@web/stores/spaces';
import type { SpaceRoom } from '@web/api/spaces';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Icon, Text, Touchable, withAlpha } from '@/ui';
import { openThread } from '../navigation';

const fetched = new Map<string, Promise<SpaceRoom | null>>();

function fetchThread(id: string): Promise<SpaceRoom | null> {
  let p = fetched.get(id);
  if (!p) {
    p = getThread(id)
      .then((raw) => spaceRoomFromPayload(raw))
      .catch(() => null);
    fetched.set(id, p);
  }
  return p;
}

type ThreadView = { id: string; name: string; private: boolean; archived: boolean; count: number };

function view(r: SpaceRoom): ThreadView {
  return {
    id: r.id,
    name: r.name,
    private: r.thread?.private === true,
    archived: r.thread?.archived === true,
    count: r.thread?.message_count ?? 0,
  };
}

export const ThreadFooter = memo(function ThreadFooter({ threadId, spaceId }: { threadId: string; spaceId: string | null }) {
  const theme = useTheme();
  const stored = useSolid(() => {
    const r = spaceId ? spaces.spaceRoomsBySpaceId[spaceId]?.find((x) => x.id === threadId) : undefined;
    return r ? view(r) : null;
  }, [spaceId, threadId]);
  const [remote, setRemote] = useState<ThreadView | null>(null);
  useEffect(() => {
    if (stored) return undefined;
    let live = true;
    void fetchThread(threadId).then((r) => live && setRemote(r ? view(r) : null));
    return () => {
      live = false;
    };
  }, [stored, threadId]);
  const th = stored ?? remote;
  if (!th) return null;
  return (
    <Touchable
      feedback="highlight"
      onPress={() => openThread(th.id)}
      accessibilityRole="button"
      accessibilityLabel={`${th.name}, ${t('threads.messageCount', { count: th.count })}`}
      accessibilityHint={t('threads.view')}
      style={[
        styles.strip,
        { borderColor: withAlpha(theme.colors.border, 0.6), backgroundColor: withAlpha(theme.colors.card, 0.4), borderRadius: theme.radii.lg },
      ]}
    >
      <Icon name={th.private ? 'lock' : 'comments'} size={12} tone="muted" />
      <Text variant="caption" weight="medium" tone="default" numberOfLines={1} style={styles.name}>
        {th.name}
      </Text>
      <Text variant="caption" numberOfLines={1}>
        · {t('threads.messageCount', { count: th.count })}
        {th.archived ? ` · ${t('threads.archivedShort')}` : ''}
      </Text>
      <Text variant="caption" tone="primary" style={styles.view}>
        {t('threads.view')} ›
      </Text>
    </Touchable>
  );
});

const styles = StyleSheet.create({
  strip: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    minHeight: 36,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 448,
  },
  name: { flexShrink: 1 },
  view: { marginStart: 'auto' },
});
