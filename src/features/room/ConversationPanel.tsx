/**
 * The shell's content side: whatever shell.view() says is open - a conversation, Friends,
 * Notes, or nothing yet.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { FriendsView, NotesView } from '@/features/nav';
import { openNav, setMembersAvailable, shell } from '@/shell/state';
import { useIsWide } from '@/shell/SwipeShell';
import { useTheme } from '@/theme';
import { Button, EmptyState } from '@/ui';
import { RoomView } from './RoomView';

function NothingOpen() {
  const theme = useTheme();
  const wide = useIsWide();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background, justifyContent: 'center' }}>
      <EmptyState
        icon="comments"
        title={t('mobile.room.nothingOpenTitle')}
        body={t('mobile.room.nothingOpenBody')}
        size="page"
        action={wide ? undefined : <Button title={t('mobile.room.openRooms')} variant="secondary" icon="bars" onPress={openNav} />}
      />
    </View>
  );
}

export function ConversationPanel() {
  const view = useSolid(() => shell.view());
  const kind = view.kind;

  // Only a room view offers the member drawer (RoomView sets it for rooms that have one).
  useEffect(() => {
    if (kind !== 'room') setMembersAvailable(false);
  }, [kind]);

  switch (view.kind) {
    case 'room':
      return <RoomView key={view.roomId} roomId={view.roomId} spaceId={view.spaceId} mode="shell" />;
    case 'friends':
      return <FriendsView />;
    case 'notes':
      return <NotesView />;
    default:
      return <NothingOpen />;
  }
}
