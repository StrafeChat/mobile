/**
 * The app shell: rails ⟷ conversation ⟷ members, moved between by swiping
 * (src/shell/SwipeShell.tsx), with the in-call bar on top when a call is live.
 *
 * - nav: the space rail, the room list of the selected space (or PMs on Home) and the
 *   Home / Notifications / You tabs (src/features/nav).
 * - content: whatever the shell's view is - a conversation, Friends, Notes, the home landing
 *   (src/features/room ConversationPanel).
 * - members: the member drawer of the open conversation (src/features/room MembersPanel).
 */
import { View } from 'react-native';
import { NavPanel } from '@/features/nav';
import { ConversationPanel, MembersPanel } from '@/features/room';
import { VoiceDock } from '@/features/voice';
import { SwipeShell } from '@/shell/SwipeShell';

export default function Shell() {
  return (
    <View style={{ flex: 1 }}>
      <SwipeShell nav={<NavPanel />} content={<ConversationPanel />} members={<MembersPanel />} />
      <VoiceDock />
    </View>
  );
}
