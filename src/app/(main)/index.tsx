/**
 * The app shell: rails ⟷ conversation ⟷ members, moved between by swiping
 * (src/shell/SwipeShell.tsx), with the in-call bar on top when a call is live.
 *
 * - nav: the space rail, the room list of the selected space (or PMs on Home) and the
 *   Home / Notifications / You tabs (src/features/nav).
 * - content: whatever the shell's view is - a conversation, Friends, Notes, the home landing
 *   (src/features/room ConversationPanel).
 * - members: the member drawer of the open conversation (src/features/room MembersPanel).
 *
 * Each panel sits in its own ErrorBoundary: a render error in one remounts that panel (or,
 * if it keeps failing, shows a Retry there) while the other two and the app keep running.
 */
import { View } from 'react-native';
import { NavPanel } from '@/features/nav';
import { ConversationPanel, MembersPanel } from '@/features/room';
import { VoiceDock } from '@/features/voice';
import { SwipeShell } from '@/shell/SwipeShell';
import { ErrorBoundary } from '@/ui';

export default function Shell() {
  return (
    <View style={{ flex: 1 }}>
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
      <VoiceDock />
    </View>
  );
}
