/**
 * /invite/:code - an invite's preview and Join (deep links from any instance land here; a
 * federated `code@domain` may arrive percent-encoded).
 */
import { useLocalSearchParams } from 'expo-router';
import { InviteScreen, decodeInviteParam } from '@/features/nav/invite/InviteScreen';

export default function InviteRoute() {
  const { code } = useLocalSearchParams<{ code: string }>();
  return <InviteScreen code={decodeInviteParam(code)} />;
}
