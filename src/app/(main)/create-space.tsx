/** /create-space - create a space (or switch to joining one with an invite). */
import { CreateSpaceScreen } from '@/features/nav/create/CreateSpaceScreen';

export default function CreateSpaceRoute() {
  return <CreateSpaceScreen initialMode="create" />;
}
