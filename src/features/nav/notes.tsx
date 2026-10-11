/**
 * Notes (NotesPage): your personal notes room - a room whose only participant is you. This view
 * only finds it and hands over: the store's copy when READY carried it, else GET /rooms/notes
 * (created on demand), seeding your presence and adding it to the store. Then the room opens
 * in its place like any conversation (end-to-end encrypted like a PM).
 */
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { getNotesRoom } from '@web/api/rooms';
import { rooms, setRooms } from '@web/stores/rooms';
import { setUserPresence } from '@web/stores/presence';
import { useNotesRoomId } from '@/data';
import { openRoom } from '@/shell/state';
import { useTheme } from '@/theme';
import { Button, EmptyState, Spinner, Text } from '@/ui';
import { errorMessage } from './actions';
import { ContentHeader } from './ContentHeader';

/** Fetch the notes room (creating it server-side if needed) and put it in the store. */
export async function fetchNotesRoom(): Promise<string> {
  const room = await getNotesRoom();
  for (const p of room.participants ?? []) {
    if (p.presence?.status) setUserPresence(p.id, p.presence);
  }
  if (!rooms.rooms.some((r) => r.id === room.id)) setRooms('rooms', (list) => [...list, room]);
  return room.id;
}

export function NotesView() {
  const theme = useTheme();
  const notesRoomId = useNotesRoomId();
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Known (now or as soon as it lands in the store): open it.
  useEffect(() => {
    if (notesRoomId) openRoom(notesRoomId, null);
  }, [notesRoomId]);

  useEffect(() => {
    if (notesRoomId) return;
    let alive = true;
    setError(null);
    fetchNotesRoom()
      .then((id) => {
        if (alive) openRoom(id, null);
      })
      .catch((err) => {
        if (alive) setError(errorMessage(err, 'notes.loadFailed'));
      });
    return () => {
      alive = false;
    };
    // Only on mount and on retry; a room arriving meanwhile is handled above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <ContentHeader title={t('nav.notes')} icon="fa-note-sticky" />
      {error ? (
        <EmptyState
          size="page"
          icon="fa-solid fa-note-sticky"
          title={error}
          action={<Button title={t('common.retry')} variant="outline" onPress={() => setAttempt((n) => n + 1)} />}
        />
      ) : (
        <View style={styles.center}>
          <Spinner />
          <Text tone="muted">{t('notes.loading')}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
});
