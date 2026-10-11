/**
 * The list's non-message rows: the conversation intro (once history is exhausted, or the room
 * is empty), the day / NEW / encryption dividers, and the history edges (skeleton groups past
 * either end of the loaded window while more exists that way).
 */
import { memo, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { getMessage, type Message } from '@web/api/messages';
import { decryptServerMessages } from '@web/stores/messages';
import { formatDateHeader } from '@web/lib/utils/datetime';
import { getMessageBodyText, messagePreviewText } from '@web/components/messageList/utils';
import { roomParticipantPool, useRoomInfo, useUserDisplay } from '@/data';
import { useTheme } from '@/theme';
import { Icon, OfficialTag, Text, UserAvatar, withAlpha } from '@/ui';
import { ROW_PAD_X } from '../layout';
import { SkeletonGroups } from './Skeletons';
import { useListContext } from './listContext';

// ---- dividers -----------------------------------------------------------------------------------------

function Rule({ color }: { color: string }) {
  return <View style={[styles.rule, { backgroundColor: color }]} />;
}

export const DateDivider = memo(function DateDivider({ date, newMessages }: { date: string; newMessages: boolean }) {
  const theme = useTheme();
  const label = formatDateHeader(new Date(date));
  if (newMessages) {
    const c = withAlpha(theme.colors.primary, 0.6);
    return (
      <View style={styles.divider} accessibilityRole="header">
        <Rule color={c} />
        <Text variant="overline" tone="primary">
          {t('messages.newMessages')} · {label}
        </Text>
        <Rule color={c} />
      </View>
    );
  }
  return (
    <View style={[styles.divider, styles.dateDivider]} accessibilityRole="header">
      <Rule color={theme.colors.border} />
      <Text variant="caption">{label}</Text>
      <Rule color={theme.colors.border} />
    </View>
  );
});

export const NewDivider = memo(function NewDivider() {
  const theme = useTheme();
  const c = withAlpha(theme.colors.primary, 0.6);
  return (
    <View style={styles.divider} accessibilityRole="header">
      <Rule color={c} />
      <Text variant="overline" tone="primary">
        {t('messages.newMessages')}
      </Text>
      <Rule color={c} />
    </View>
  );
});

export const E2eeDivider = memo(function E2eeDivider({ encrypted }: { encrypted: boolean }) {
  const theme = useTheme();
  return (
    <View style={[styles.divider, styles.dateDivider]}>
      <Rule color={theme.colors.border} />
      <View style={styles.inline}>
        <Icon name={encrypted ? 'lock' : 'lock-open'} size={10} tone="muted" />
        <Text variant="caption">{encrypted ? t('messages.nowEncrypted') : t('messages.noLongerEncrypted')}</Text>
      </View>
      <Rule color={theme.colors.border} />
    </View>
  );
});

export const HistoryEdge = memo(function HistoryEdge({ side }: { side: 'older' | 'newer' }) {
  const { compact } = useListContext();
  return <SkeletonGroups groups={4} compact={compact} offset={side === 'older' ? 0 : 6} />;
});

// ---- the intro ---------------------------------------------------------------------------------------

const starterCache = new Map<string, Promise<string | null>>();

/** A thread's starter message text, from its parent channel (decrypted like any page). */
function loadStarter(parentId: string, messageId: string, roomId: string): Promise<string | null> {
  const key = `${parentId}:${messageId}`;
  let p = starterCache.get(key);
  if (!p) {
    p = getMessage(parentId, messageId)
      .then((raw) => decryptServerMessages([raw as unknown as Message]))
      .then(([m]) => (m ? messagePreviewText(getMessageBodyText(m), roomParticipantPool(roomId), auth.user?.id, 300) : null))
      .catch(() => null);
    starterCache.set(key, p);
  }
  return p;
}

function IntroIcon({ name }: { name: string }) {
  const theme = useTheme();
  return (
    <View style={[styles.introIcon, { backgroundColor: withAlpha(theme.colors.primary, 0.2) }]}>
      <Icon name={name} size={26} tone="default" />
    </View>
  );
}

function PmIntro({ userId }: { userId: string }) {
  const { roomId } = useListContext();
  const user = useUserDisplay(userId, { roomId });
  const name = user?.username || t('common.unknown');
  return (
    <View style={styles.introCenter}>
      <UserAvatar userId={userId} uri={user?.avatar ?? null} name={name} size="xl" />
      <View style={styles.introName}>
        <Text variant="heading">{name}</Text>
        <OfficialTag system={user?.system} size="sm" />
      </View>
      <Text variant="caption" align="center" style={styles.introNote}>
        {user?.system ? t('intro.pmOfficial') : t('intro.pmEncrypted')}
      </Text>
    </View>
  );
}

function ThreadIntro({ name, ownerId, isPrivate, parentId, starterId }: { name: string; ownerId?: string; isPrivate: boolean; parentId?: string; starterId?: string }) {
  const theme = useTheme();
  const { roomId, spaceId } = useListContext();
  const owner = useUserDisplay(ownerId, { roomId, spaceId });
  const [starter, setStarter] = useState<string | null>(null);
  useEffect(() => {
    if (!parentId || !starterId) return undefined;
    let live = true;
    void loadStarter(parentId, starterId, roomId).then((s) => live && setStarter(s));
    return () => {
      live = false;
    };
  }, [parentId, starterId, roomId]);
  return (
    <View style={styles.introCenter}>
      <IntroIcon name={isPrivate ? 'lock' : 'comments'} />
      <Text variant="title" align="center">
        {name}
      </Text>
      <Text variant="caption" align="center">
        {t('threads.startedBy', { name: owner?.name ?? t('common.someone') })}
      </Text>
      {starter ? (
        <Text
          variant="body"
          style={[styles.starter, { borderColor: withAlpha(theme.colors.border, 0.7), backgroundColor: withAlpha(theme.colors.muted, 0.2), borderRadius: theme.radii.xl }]}
        >
          {starter}
        </Text>
      ) : null}
    </View>
  );
}

export const ListIntro = memo(function ListIntro() {
  const theme = useTheme();
  const { roomId, spaceId } = useListContext();
  const info = useRoomInfo(roomId, spaceId);
  if (!info) return <View style={styles.introSpacer} />;
  switch (info.kind) {
    case 'pm':
      return info.otherUserId ? <PmIntro userId={info.otherUserId} /> : <View style={styles.introSpacer} />;
    case 'notes':
      return (
        <View style={styles.introCenter}>
          <IntroIcon name="note-sticky" />
          <Text variant="heading">{t('intro.notesTitle')}</Text>
          <Text variant="body" tone="muted" align="center" style={styles.introNote}>
            {t('intro.notesBody')}
          </Text>
        </View>
      );
    case 'group':
      return (
        <View style={styles.introCenter}>
          <IntroIcon name="user-group" />
          <Text variant="heading">{info.name || t('intro.groupTitle')}</Text>
          <Text variant="body" tone="muted" align="center" style={styles.introNote}>
            {t('intro.groupBody')}
          </Text>
        </View>
      );
    case 'thread':
      return (
        <ThreadIntro
          name={info.name}
          isPrivate={info.thread?.private === true}
          {...(info.thread?.owner_id ? { ownerId: info.thread.owner_id } : {})}
          {...(info.parentId ? { parentId: info.parentId } : {})}
          {...(info.thread?.starter_message_id ? { starterId: info.thread.starter_message_id } : {})}
        />
      );
    case 'text': {
      const name = info.name || t('intro.roomFallback');
      return (
        <View style={styles.introStart}>
          <IntroIcon name={info.e2ee ? 'lock' : 'hashtag'} />
          <Text variant="title">{t('intro.roomWelcome', { name })}</Text>
          <Text variant="body" tone="muted">
            {t('intro.roomStartBefore')}{' '}
            <Text variant="body" weight="semibold">
              #{name}
            </Text>{' '}
            {t('intro.roomStartAfter')}
          </Text>
          {info.e2ee ? (
            <View
              style={[
                styles.e2eePill,
                { borderColor: withAlpha(theme.colors.primary, 0.3), backgroundColor: withAlpha(theme.colors.primary, 0.1), borderRadius: theme.radii.lg },
              ]}
            >
              <Icon name="lock" size={11} tone="primary" />
              <Text variant="caption" tone="default" style={styles.flexShrink}>
                {t('intro.roomEncrypted')}
              </Text>
            </View>
          ) : null}
        </View>
      );
    }
    default:
      return <View style={styles.introSpacer} />;
  }
});

const styles = StyleSheet.create({
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: ROW_PAD_X, paddingVertical: 8 },
  dateDivider: { paddingVertical: 12 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  introCenter: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 24, gap: 6 },
  introStart: { alignItems: 'flex-start', paddingHorizontal: ROW_PAD_X, paddingTop: 24, paddingBottom: 16, gap: 4 },
  introIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  introName: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  introNote: { marginTop: 8, maxWidth: 300 },
  introSpacer: { height: 24 },
  starter: { marginTop: 12, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingVertical: 10, maxWidth: 448 },
  e2eePill: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 12, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth },
  flexShrink: { flexShrink: 1 },
});
