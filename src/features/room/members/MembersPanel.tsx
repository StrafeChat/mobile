/**
 * The shell's right-hand drawer (a column on a tablet): the member list of the conversation
 * on the content panel - a group PM's participants or the people who can see a space
 * channel or thread. Other views have no member list; the shell only offers the drawer when
 * the room view says there is one (shell membersAvailable).
 *
 * MembersSheetHost is the same list over a pushed screen (a thread), which has no drawer.
 */
import { useRef } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { shell } from '@/shell/state';
import { useTheme } from '@/theme';
import { Sheet, useExternalStore } from '@/ui';
import { closeMembersSheet, membersSheetStore } from '../presenters';
import { MembersList } from './MembersList';

export function MembersPanel() {
  const theme = useTheme();
  const view = useSolid(() => shell.view());
  if (view.kind !== 'room') return null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.card }} accessibilityLabel={t('room.members.title')}>
      <MembersList key={view.roomId} roomId={view.roomId} spaceId={view.spaceId ?? null} safeTop />
    </View>
  );
}

export function MembersSheetHost() {
  const target = useExternalStore(membersSheetStore);
  const last = useRef(target);
  if (target) last.current = target;
  const shown = last.current;
  return (
    <Sheet open={!!target} onClose={closeMembersSheet} snapPoints={['60%', '92%']} padded={false} contentStyle={{ flex: 1 }} testID="members-sheet">
      {shown ? <MembersList key={shown.roomId} roomId={shown.roomId} spaceId={shown.spaceId} inSheet /> : null}
    </Sheet>
  );
}
