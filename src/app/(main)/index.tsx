/**
 * The app shell: rails ⟷ conversation ⟷ members, moved between by swiping
 * (src/shell/SwipeShell.tsx), with the in-call bar under it when a call is live.
 *
 * - nav: the space rail, the room list of the selected space (or PMs on Home) and the
 *   Home / Notifications / You tabs (src/features/nav).
 * - content: whatever the shell's view is - a conversation, Friends, Notes, the home landing
 *   (src/features/room ConversationPanel).
 * - members: the member drawer of the open conversation (src/features/room MembersPanel).
 *
 * Each panel sits in its own ErrorBoundary: a render error in one remounts that panel (or,
 * if it keeps failing, shows a Retry there) while the other two and the app keep running.
 *
 * The in-call bar is the bottom of the screen while it shows, so the system inset (navigation
 * bar, home indicator) goes under the bar and the shell above it reserves none - its tab bar
 * and composer would otherwise leave a dead band, and the bar's buttons would sit behind the
 * navigation bar. While the keyboard is up the bar steps aside: the composer measures the
 * keyboard from the bottom of the screen, which the shell then reaches again. (A sheet opened
 * from inside the shell covers the whole window, and goes by the window's insets instead:
 * src/ui/safeArea useWindowInsets.)
 */
import { useMemo } from 'react';
import { View } from 'react-native';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavPanel } from '@/features/nav';
import { ConversationPanel, MembersPanel } from '@/features/room';
import { VoiceDock, useVoiceDockVisible } from '@/features/voice';
import { SwipeShell } from '@/shell/SwipeShell';
import { ErrorBoundary } from '@/ui';

export default function Shell() {
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardState((k) => k.isVisible);
  const dock = useVoiceDockVisible() && !keyboardVisible;
  const shellInsets = useMemo(() => (dock ? { ...insets, bottom: 0 } : insets), [dock, insets]);
  return (
    <View style={{ flex: 1 }}>
      {/* Always rendered, dock or not: a provider that came and went would remount the shell. */}
      <SafeAreaInsetsContext.Provider value={shellInsets}>
        <SwipeShell
          nav={
            <ErrorBoundary name="nav-panel">
              <NavPanel />
            </ErrorBoundary>
          }
          content={
            <ErrorBoundary name="conversation-panel">
              <ConversationPanel />
            </ErrorBoundary>
          }
          members={
            <ErrorBoundary name="members-panel">
              <MembersPanel />
            </ErrorBoundary>
          }
        />
      </SafeAreaInsetsContext.Provider>
      {dock ? <VoiceDock style={{ marginBottom: insets.bottom + 4 }} /> : null}
    </View>
  );
}
