/** /join-space - join a space with an invite link or code (or switch to creating one). */
import { CreateSpaceScreen } from '@/features/nav/create/CreateSpaceScreen';

export default function JoinSpaceRoute() {
  return <CreateSpaceScreen initialMode="join" />;
}
