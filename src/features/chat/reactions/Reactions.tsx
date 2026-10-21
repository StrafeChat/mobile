/**
 * The reaction pills under a message (the web's MessageReactions): emoji and count, the
 * viewer's own highlighted. Tap toggles (optimistic, reconciled by the store); a pill the
 * viewer may not join is inert, though their own can always be taken back. The web's hover
 * tooltip ("A, B and 3 others reacted with :x:") becomes a long-press: a sheet listing who
 * reacted, one tab per emoji (lazy GET of the reactors, once per emoji). A trailing "+" pill
 * opens the picker when the viewer may add reactions. In a space room a reactor is named and
 * pictured by their space profile (the server sends the global one), the username under it.
 */
import { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { t } from '@web/i18n/t';
import { listReactors, type Reactor } from '@web/api/messages';
import { auth } from '@web/stores/auth';
import { useSolid } from '@/bridge/solid';
import { parseReactionKey, reactionPillDisabled, resolveSpaceUser, spaceIdOfRoom, useCustomEmoji, useMessageReactions } from '@/data';
import { useTheme } from '@/theme';
import { Avatar, haptics, Icon, ListRow, Sheet, SheetScrollView, Spinner, Text, Touchable, useLongPress, withAlpha } from '@/ui';
import { CustomEmojiImage, EmojiGlyph } from '../body/inline';
import { openUserProfile } from '../people';
import { openReactionPicker, reactWith } from './ReactionPicker';

const PILL_EMOJI = 16;

function ReactionEmoji({ emoji, size }: { emoji: string; size: number }) {
  const key = parseReactionKey(emoji);
  const custom = useCustomEmoji(key.kind === 'custom' ? key.id : null);
  if (key.kind === 'unicode') return <EmojiGlyph emoji={key.emoji} size={size} />;
  if (!custom) return <View style={{ width: size, height: size }} />;
  return <CustomEmojiImage url={custom.url} name={custom.name} animated={custom.animated} size={size} />;
}

/** `:name:` for the accessibility label (custom emoji by their name). */
function useReactionName(emoji: string): string {
  const key = parseReactionKey(emoji);
  const custom = useCustomEmoji(key.kind === 'custom' ? key.id : null);
  return key.kind === 'unicode' ? key.emoji : `:${custom?.name ?? ''}:`;
}

interface PillProps {
  roomId: string;
  messageId: string;
  emoji: string;
  count: number;
  me: boolean;
  canJoin: boolean;
  onShowReactors: (emoji: string) => void;
}

function ReactionPill({ roomId, messageId, emoji, count, me, canJoin, onShowReactors }: PillProps) {
  const theme = useTheme();
  const name = useReactionName(emoji);
  const disabled = reactionPillDisabled({ me }, canJoin);
  const longPress = useLongPress(() => onShowReactors(emoji));
  return (
    <Touchable
      feedback="opacity"
      // Not `disabled`: an inert pill still answers the long-press for who reacted (the web's
      // tooltip sits around its disabled button).
      onPress={() => {
        if (disabled) return;
        const key = parseReactionKey(emoji);
        reactWith(roomId, messageId, key.kind === 'unicode' ? { unicode: key.emoji } : { customId: key.id });
      }}
      {...longPress}
      accessibilityRole="button"
      accessibilityState={{ selected: me, disabled }}
      accessibilityLabel={`${name} ${count}`}
      hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
      style={[
        styles.pill,
        {
          borderColor: me ? withAlpha(theme.colors.primary, 0.6) : withAlpha(theme.colors.border, disabled ? 0.5 : 0.7),
          backgroundColor: me ? withAlpha(theme.colors.primary, 0.15) : withAlpha(theme.colors.card, disabled ? 0.2 : 0.4),
          opacity: disabled ? 0.6 : 1,
        },
      ]}
    >
      <ReactionEmoji emoji={emoji} size={PILL_EMOJI} />
      <Text variant="caption" weight="semibold" color={me ? theme.colors.primary : theme.colors.foreground} style={styles.count}>
        {count}
      </Text>
    </Touchable>
  );
}

export const MessageReactionsRow = memo(function MessageReactionsRow({
  roomId,
  messageId,
  canJoin,
  canAdd,
  customEmojiSpaceId,
}: {
  roomId: string;
  messageId: string;
  canJoin: boolean;
  canAdd: boolean;
  customEmojiSpaceId?: string;
}) {
  const theme = useTheme();
  const reactions = useMessageReactions(roomId, messageId);
  const [sheetFor, setSheetFor] = useState<string | null>(null);
  if (reactions.length === 0) return null;
  return (
    <View style={styles.row}>
      {reactions.map((r) => (
        <ReactionPill
          key={r.emoji}
          roomId={roomId}
          messageId={messageId}
          emoji={r.emoji}
          count={r.count}
          me={r.me}
          canJoin={canJoin}
          onShowReactors={setSheetFor}
        />
      ))}
      {canAdd ? (
        <Touchable
          feedback="opacity"
          onPress={() => {
            haptics.selection();
            openReactionPicker({ roomId, messageId, ...(customEmojiSpaceId ? { customEmojiSpaceId } : {}) });
          }}
          accessibilityRole="button"
          accessibilityLabel={t('messages.actions.addReaction')}
          hitSlop={{ top: 6, bottom: 6, left: 2, right: 6 }}
          style={[styles.pill, styles.add, { borderColor: withAlpha(theme.colors.border, 0.7), backgroundColor: withAlpha(theme.colors.card, 0.4) }]}
        >
          <Icon name="face-smile" tone="muted" size={14} />
          <Icon name="plus" tone="muted" size={9} style={styles.plus} />
        </Touchable>
      ) : null}
      {sheetFor ? (
        <ReactorsSheet roomId={roomId} messageId={messageId} initial={sheetFor} emojis={reactions.map((r) => ({ emoji: r.emoji, count: r.count }))} onClose={() => setSheetFor(null)} />
      ) : null}
    </View>
  );
});

// ---- who reacted --------------------------------------------------------------------------------------

/** One reactor: the API's global user, with their space profile on top in a space room. */
function ReactorRow({ reactor, roomId, onPress }: { reactor: Reactor; roomId: string; onPress: () => void }) {
  const view = useSolid(() => {
    const r = resolveSpaceUser(spaceIdOfRoom(roomId), reactor.id, reactor);
    return { name: r.name, avatar: r.avatar ?? null };
  }, [roomId, reactor]);
  return (
    <ListRow
      title={view.name}
      subtitle={reactor.username && reactor.username !== view.name ? reactor.username : undefined}
      leading={<Avatar uri={view.avatar} name={view.name} size="md" />}
      onPress={onPress}
      accessibilityHint={reactor.id === auth.user?.id ? t('common.you') : undefined}
    />
  );
}

function ReactorsSheet({
  roomId,
  messageId,
  initial,
  emojis,
  onClose,
}: {
  roomId: string;
  messageId: string;
  initial: string;
  emojis: { emoji: string; count: number }[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(true);
  const [active, setActive] = useState(initial);
  const [lists, setLists] = useState<Record<string, Reactor[] | 'error' | undefined>>({});

  useEffect(() => {
    if (lists[active] !== undefined) return;
    let live = true;
    listReactors(roomId, messageId, active).then(
      (list) => live && setLists((prev) => ({ ...prev, [active]: list })),
      () => live && setLists((prev) => ({ ...prev, [active]: 'error' })),
    );
    return () => {
      live = false;
    };
  }, [active, lists, roomId, messageId]);

  const list = lists[active];
  // The space too, so a reactor's profile sheet carries the space's role context.
  const ctx = { roomId, spaceId: spaceIdOfRoom(roomId) ?? null };
  return (
    <Sheet open={open} onClose={onClose} title={t('mobile.chat.reactions.title')} snapPoints={['55%']} padded={false} contentStyle={styles.fill}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} style={styles.tabBar} accessibilityRole="tablist">
        {emojis.map((e) => {
          const selected = e.emoji === active;
          return (
            <Touchable
              key={e.emoji}
              onPress={() => setActive(e.emoji)}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              style={[
                styles.pill,
                styles.tab,
                {
                  borderColor: selected ? withAlpha(theme.colors.primary, 0.6) : withAlpha(theme.colors.border, 0.7),
                  backgroundColor: selected ? withAlpha(theme.colors.primary, 0.15) : 'transparent',
                },
              ]}
            >
              <ReactionEmoji emoji={e.emoji} size={18} />
              <Text variant="caption" weight="semibold" style={styles.count}>
                {e.count}
              </Text>
            </Touchable>
          );
        })}
      </ScrollView>
      <SheetScrollView contentContainerStyle={styles.people}>
        {list === undefined ? (
          <Spinner label={t('common.loading')} style={styles.loading} />
        ) : list === 'error' || list.length === 0 ? (
          <Text variant="caption" style={styles.emptyText}>
            {t('mobile.chat.reactions.none')}
          </Text>
        ) : (
          list.map((u) => (
            <ReactorRow
              key={u.id}
              reactor={u}
              roomId={roomId}
              onPress={() => {
                setOpen(false);
                openUserProfile(u.id, ctx);
              }}
            />
          ))
        )}
      </SheetScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: 8,
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  count: { fontVariant: ['tabular-nums'] },
  add: { gap: 0, paddingHorizontal: 10 },
  plus: { marginStart: -2, marginTop: -8 },
  fill: { flex: 1 },
  tabBar: { flexGrow: 0 },
  tabs: { paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  tab: { height: 34, paddingHorizontal: 10, borderRadius: 17 },
  people: { paddingBottom: 24 },
  loading: { marginTop: 24 },
  emptyText: { paddingHorizontal: 20, paddingTop: 16 },
});
