/**
 * The full-screen media viewer route, opened by openMedia() (src/features/chat) or by any
 * shared code that opens the web's stores/mediaViewer (MediaViewerHost pushes it then).
 */
import { Stack } from 'expo-router';
import { MediaViewerScreen } from '@/features/chat/viewer/MediaViewerScreen';

export default function MediaRoute() {
  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
          presentation: 'transparentModal',
          animation: 'fade',
          contentStyle: { backgroundColor: 'transparent' },
          gestureEnabled: false,
        }}
      />
      <MediaViewerScreen />
    </>
  );
}
