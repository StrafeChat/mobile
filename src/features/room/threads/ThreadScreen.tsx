/**
 * A thread as its own screen, pushed over its channel (Discord's thread screen): the same
 * conversation view - list, typing, composer - for the thread's room id, with the thread's
 * header (its channel as the second line, its actions in the info sheet), the archived
 * banner, and the members list as a sheet. A thread the live room list does not hold
 * (archived, a deep link) is fetched first.
 */
import { useLocalSearchParams } from 'expo-router';
import { RoomView } from '../RoomView';

export function ThreadScreen() {
  const params = useLocalSearchParams<{ threadId: string; spaceId?: string }>();
  const threadId = String(params.threadId ?? '');
  const spaceId = typeof params.spaceId === 'string' && params.spaceId ? params.spaceId : undefined;
  return <RoomView key={threadId} roomId={threadId} spaceId={spaceId} mode="screen" />;
}
