/**
 * Signed-in navigator. The shell is the index route; everything else (a thread, a profile,
 * settings, the call) is pushed over it as a card. The hosts that present sheets or push
 * routes on behalf of shared code are mounted here, under the router and inside UiProvider:
 * room (profile, report, E2EE prompts, external links), nav (add people, invites), voice
 * (incoming call, call sheets) and the media viewer.
 */
import { Stack } from 'expo-router';
import { useLaunchAuthLink } from '@/features/auth';
import { NavHosts } from '@/features/nav';
import { RoomHosts } from '@/features/room';
import { VoiceHosts } from '@/features/voice';
import { MediaViewerHost } from '@/features/chat';
import { useTheme } from '@/theme';
import { useHorizontalSafePadding } from '@/ui';
import { dismissKeyboard } from '@/ui/keyboard';

/**
 * A screen reached directly by a deep link (an invite, a thread, a profile) still gets the
 * shell beneath it, so its back button and every "back to the conversation" have somewhere to
 * go - without this, a cold start straight into /invite/x had nothing under it.
 */
export const unstable_settings = { initialRouteName: 'index' };

export default function MainLayout() {
  const theme = useTheme();
  // An email link that cold-started the app while signed in: its screen waits for start-up
  // to settle before redeeming anything, and the boot gate leaves it meanwhile, so it is
  // reopened from here once the app is up (as the sign-in screen does when signed out).
  useLaunchAuthLink();
  // Every screen is kept clear of the cutout and a side navigation bar in landscape (the app
  // draws edge to edge, and each screen pads only its top and bottom) - except the media
  // viewer, whose pages are the window's width and which is meant to fill the screen.
  const sides = useHorizontalSafePadding();
  return (
    <>
      {/* Leaving a screen for another (a thread, a profile, settings) puts the keyboard away, so
          Android has no focused field to bring it back for on the way back. */}
      <Stack screenListeners={{ blur: () => dismissKeyboard() }} screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.colors.background, ...sides } }}>
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
