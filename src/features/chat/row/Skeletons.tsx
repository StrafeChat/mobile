/**
 * Placeholder rows (the web's MessageSkeleton): the same fixed script of sender groups - one
 * liners, paragraphs, an image, a reply, reaction pills - laid out with the real rows' metrics,
 * so bars sit where the messages that replace them will. The whole-room skeleton draws the
 * script twice anchored to the bottom; a history edge draws four groups past the loaded window.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { Skeleton } from '@/ui';
import { AVATAR_GAP, AVATAR_PX, ROW_PAD_X } from '../layout';

type Kind = 'text' | 'long' | 'image' | 'reply' | 'reactions' | 'short';

const SCRIPT: { name: number; messages: { kind: Kind; lines: number[] }[] }[] = [
  { name: 88, messages: [{ kind: 'text', lines: [58] }, { kind: 'short', lines: [24] }] },
  { name: 124, messages: [{ kind: 'long', lines: [96, 88, 41] }] },
  { name: 72, messages: [{ kind: 'image', lines: [34] }] },
  { name: 104, messages: [{ kind: 'reply', lines: [62] }, { kind: 'text', lines: [79, 30] }] },
  { name: 64, messages: [{ kind: 'reactions', lines: [47] }] },
  { name: 118, messages: [{ kind: 'text', lines: [71] }, { kind: 'text', lines: [52, 66] }, { kind: 'short', lines: [18] }] },
  { name: 96, messages: [{ kind: 'long', lines: [92, 84, 90, 37] }] },
  { name: 80, messages: [{ kind: 'text', lines: [44] }] },
  { name: 132, messages: [{ kind: 'image', lines: [52] }, { kind: 'short', lines: [27] }] },
  { name: 90, messages: [{ kind: 'reply', lines: [83, 29] }] },
  { name: 110, messages: [{ kind: 'text', lines: [64, 48] }, { kind: 'reactions', lines: [36] }] },
  { name: 76, messages: [{ kind: 'short', lines: [22] }] },
];

const LINE = 21;

function Line({ width }: { width: number }) {
  return (
    <View style={styles.line}>
      <Skeleton width={`${width}%`} height={13} />
    </View>
  );
}

function Group({ group, compact }: { group: (typeof SCRIPT)[number]; compact: boolean }) {
  const theme = useTheme();
  const reply = group.messages[0]?.kind === 'reply';
  return (
    <View style={[styles.group, { marginTop: theme.messageGroupSpacing }]}>
      {!compact ? (
        <View style={[styles.gutter, reply ? styles.replyOffset : null]}>
          <Skeleton circle height={AVATAR_PX} />
        </View>
      ) : null}
      <View style={styles.flex}>
        {reply ? (
          <View style={styles.replyLine}>
            <Skeleton circle height={16} />
            <Skeleton width={160} height={10} />
          </View>
        ) : null}
        <View style={styles.header}>
          <Skeleton width={group.name} height={13} />
          <Skeleton width={56} height={10} />
        </View>
        {group.messages.map((m, i) => (
          <View key={i}>
            {m.lines.map((w, j) => (
              <Line key={j} width={w} />
            ))}
            {m.kind === 'image' ? <Skeleton width="80%" height={176} radius={theme.radii.md} style={styles.image} /> : null}
            {m.kind === 'reactions' ? (
              <View style={styles.reactions}>
                <Skeleton width={44} height={26} radius={13} />
                <Skeleton width={44} height={26} radius={13} />
                <Skeleton width={56} height={26} radius={13} />
              </View>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}

/** `groups` groups of the script (repeating), oldest at the top. */
export const SkeletonGroups = memo(function SkeletonGroups({ groups, compact, offset = 0 }: { groups: number; compact: boolean; offset?: number }) {
  const out = [];
  for (let i = 0; i < groups; i++) out.push(SCRIPT[(i + offset) % SCRIPT.length]!);
  return (
    <View accessible={false} importantForAccessibility="no-hide-descendants">
      {out.map((g, i) => (
        <Group key={i} group={g} compact={compact} />
      ))}
    </View>
  );
});

/** The whole-room skeleton while the first page loads: anchored to the bottom, above the composer. */
export function RoomSkeleton({ compact }: { compact: boolean }) {
  return (
    <View style={styles.room}>
      <SkeletonGroups groups={SCRIPT.length * 2} compact={compact} />
    </View>
  );
}

const styles = StyleSheet.create({
  room: { flex: 1, justifyContent: 'flex-end', overflow: 'hidden', paddingBottom: 8 },
  group: { flexDirection: 'row', paddingHorizontal: ROW_PAD_X, gap: AVATAR_GAP },
  gutter: { width: AVATAR_PX },
  replyOffset: { paddingTop: 24 },
  flex: { flex: 1 },
  replyLine: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 20, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 20, marginBottom: 2 },
  line: { height: LINE, justifyContent: 'center' },
  image: { marginTop: 4, maxWidth: 320 },
  reactions: { flexDirection: 'row', gap: 6, marginTop: 6 },
});
