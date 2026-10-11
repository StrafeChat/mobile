/**
 * /call - the call screen (src/features/voice/CallScreen.tsx). `roomId` / `spaceId` name the
 * room to show (a voice room's Join page, a PM call); without them it shows the call this
 * device is in. Opened through openCallScreen / joinVoiceFromUi, never stacked twice.
 *
 * A card that slides up rather than a native modal: the app's sheets and dialogs are drawn
 * by root-level hosts, and an iOS modal would sit above them.
 */
import { Stack, useLocalSearchParams } from 'expo-router';
import { CallScreen } from '@/features/voice';
import { useReduceMotion } from '@/ui';

export default function CallRoute() {
  const params = useLocalSearchParams<{ roomId?: string; spaceId?: string }>();
  const reduce = useReduceMotion();
  return (
    <>
      <Stack.Screen
        options={{
          animation: reduce ? 'none' : 'slide_from_bottom',
          gestureEnabled: true,
          gestureDirection: 'vertical',
        }}
      />
      <CallScreen roomId={typeof params.roomId === 'string' ? params.roomId : null} spaceId={typeof params.spaceId === 'string' ? params.spaceId : null} />
    </>
  );
}
