/**
 * The room area's root-mounted hosts: everything that shared web code (or any area) opens
 * through a store and that has to be on screen wherever the person is.
 *
 * - the profile sheet (src/platform/presenters profileSheet - the web's popover);
 * - the full profile and safety numbers: the web's userProfileFullModal and
 *   safetyNumberModal stores become pushed screens;
 * - the report sheet (presenters reportSheet - the web's openReportDialog);
 * - the key-backup prompts (stores/recoveryPrompt) and the encryption-store reset dialog;
 * - "Leaving Strafe" for external links (stores/externalLink);
 * - the room area's own sheets: create thread, members over a pushed screen, the one-line
 *   text prompt (notification settings are the settings area's page) and "Change Nickname"
 *   (nicknameSheet - the web's NicknameDialog).
 *
 * Mount once, inside the UI provider (bottom sheets) and the router.
 */
import { useEffect, useRef } from 'react';
import { closeSafetyNumberModal, safetyNumberModal } from '@web/stores/safetyNumberModal';
import { userProfileFullModal } from '@web/stores/userProfileFullModal';
import { useSolid } from '@/bridge/solid';
import { TextPromptHost } from './TextPromptHost';
import { E2eeEnvironmentHost } from './e2ee/E2eeEnvironmentHost';
import { RecoveryHost } from './e2ee/RecoveryHost';
import { ExternalLinkHost } from './links/ExternalLinkHost';
import { MembersSheetHost } from './members/MembersPanel';
import { NicknameSheetHost } from './members/NicknameSheet';
import { openProfileScreen, openSafetyScreen } from './navigation';
import { ProfileSheetHost } from './profile/ProfileSheetHost';
import { ReportSheetHost } from './report/ReportSheetHost';
import { CreateThreadSheetHost } from './threads/CreateThreadSheet';

/** stores/userProfileFullModal -> the full profile screen (which reads the hand-over). */
function FullProfileBridge() {
  const subject = useSolid(() => (userProfileFullModal.open ? userProfileFullModal.subject : null));
  const shown = useRef<unknown>(null);
  useEffect(() => {
    if (!subject) {
      shown.current = null;
      return;
    }
    if (shown.current === subject) return;
    shown.current = subject;
    // The space it was opened in (the profile sheet hands it over), so the screen's own
    // subject - built when the hand-over is gone - shows the same space profile.
    const spaceId = (subject as { spaceId?: string }).spaceId;
    openProfileScreen(subject.userId, spaceId ? { spaceId } : {});
  }, [subject]);
  return null;
}

/** stores/safetyNumberModal -> the safety numbers screen. */
function SafetyBridge() {
  const subject = useSolid(() => (safetyNumberModal.open ? safetyNumberModal.subject : null));
  useEffect(() => {
    if (!subject) return;
    openSafetyScreen(subject.userId, subject.displayName);
    closeSafetyNumberModal();
  }, [subject]);
  return null;
}

export function RoomHosts() {
  return (
    <>
      <ProfileSheetHost />
      <ReportSheetHost />
      <CreateThreadSheetHost />
      <MembersSheetHost />
      <TextPromptHost />
      <NicknameSheetHost />
      <RecoveryHost />
      <ExternalLinkHost />
      <E2eeEnvironmentHost />
      <FullProfileBridge />
      <SafetyBridge />
    </>
  );
}
