/** Route: Space Profiles (?space=<space id> opens it on that space) */
import { useLocalSearchParams } from 'expo-router';
import { SpaceProfileScreen } from '@/features/settings/user/SpaceProfileScreen';

export default function SpaceProfilesRoute() {
  const { space } = useLocalSearchParams<{ space?: string }>();
  return <SpaceProfileScreen initialSpaceId={typeof space === 'string' && space ? space : null} />;
}
