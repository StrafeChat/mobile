/**
 * Signed-in navigator. The shell is the index route; everything else (a thread, a profile,
 * settings, the call) is pushed over it as a card. The hosts that present sheets or push
 * routes on behalf of shared code are mounted here, under the router and inside UiProvider:
 * room (profile, report, E2EE prompts, external links), nav (add people, invites), voice
 * (incoming call, call sheets) and the media viewer.
 */
import { Stack } from 'expo-router';
import { NavHosts } from '@/features/nav';
import { RoomHosts } from '@/features/room';
import { VoiceHosts } from '@/features/voice';
import { MediaViewerHost } from '@/features/chat';
import { useTheme } from '@/theme';
import { dismissKeyboard } from '@/ui/keyboard';

/**
 * A screen reached directly by a deep link (an invite, a thread, a profile) still gets the
 * shell beneath it, so its back button and every "back to the conversation" have somewhere to
 * go - without this, a cold start straight into /invite/x had nothing under it.
 */
export const unstable_settings = { initialRouteName: 'index' };

export default function MainLayout() {
  const theme = useTheme();
  return (
    <>
      {/* Leaving a screen for another (a thread, a profile, settings) puts the keyboard away, so
          Android has no focused field to bring it back for on the way back. */}
      <Stack screenListeners={{ blur: () => dismissKeyboard() }} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="media" options={{ animation: 'fade', contentStyle: { backgroundColor: '#000' } }} />
        <Stack.Screen name="oauth2/authorize" options={{ presentation: 'modal' }} />
      </Stack>
      <RoomHosts />
      <NavHosts />
      <VoiceHosts />
      <MediaViewerHost />
    </>
  );
}
