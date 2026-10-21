/**
 * The profile sheet: someone's profile card, presented as a bottom sheet.
 *
 * The web shows it as a popover anchored to whatever was clicked (an avatar, a member row) and
 * computes its position from the anchor's on-screen rect (web/src/stores/userProfilePopover.ts).
 * A phone shows it as a sheet from the bottom edge, so the state is the web store's without the
 * geometry, and the web's open functions (overrides/stores/userProfilePopover.ts) present it
 * here whatever anchor they are given.
 *
 * State, read field by field with useSolid (e.g. `useSolid(() => profileSheet.subject)`):
 *
 *   {
 *     open: boolean;
 *     subject: MobileProfileSubject | null;      // who: names, avatar, banner, about me, roles,
 *                                                //   badges... built by lib/userProfilePopoverHelpers;
 *                                                //   in a space also spaceId, and globalName under
 *                                                //   a nickname (the space profile on top)
 *     currentUserId: string | undefined;         // the viewer, to tell "this is you" apart
 *     onMessageUser: ((userId) => void) | undefined; // offer "Message" when set
 *     spaceRoleContext: SpaceMemberRoleEditContext | null; // role toggles, when permitted
 *   }
 *
 * Build subjects only through the helpers in lib/userProfilePopoverHelpers
 * (popoverSubjectFromParticipant / popoverSubjectFromSender) so the same person looks the same
 * from every surface. "View full profile" is the web's stores/userProfileFullModal, reused as is.
 */
import { createStore } from 'solid-js/store';
import { popoverSubjectFromParticipant } from '@web/lib/userProfilePopoverHelpers';
import type { RoomParticipant } from '@web/api/rooms';
import type { SpaceRole } from '@web/api/spaces';
import type { SpaceMemberRoleEditContext } from '@web/stores/userProfilePopover';
import { overlayProfileSubject, type MobileProfileSubject, type SpaceProfileFields } from '@/data/spaceProfileCore';

export interface ProfileSheetState {
  open: boolean;
  subject: MobileProfileSubject | null;
  currentUserId: string | undefined;
  onMessageUser: ((userId: string) => void) | undefined;
  spaceRoleContext: SpaceMemberRoleEditContext | null;
}

export interface PresentProfileOptions {
  subject: MobileProfileSubject;
  currentUserId?: string;
  onMessageUser?: (userId: string) => void;
  spaceRoleContext?: SpaceMemberRoleEditContext | null;
}

export const [profileSheet, setProfileSheet] = createStore<ProfileSheetState>({
  open: false,
  subject: null,
  currentUserId: undefined,
  onMessageUser: undefined,
  spaceRoleContext: null,
});

export function presentProfileSheet(opts: PresentProfileOptions): void {
  setProfileSheet({
    open: true,
    subject: opts.subject,
    currentUserId: opts.currentUserId,
    onMessageUser: opts.onMessageUser,
    spaceRoleContext: opts.spaceRoleContext ?? null,
  });
}

/**
 * For a member row or a voice tile: the subject is built from the room participant. In a space
 * (`spaceId`, else the role context's) the participant is the member row, so its space profile
 * goes on top - the pinned web builder reads only the global one. The overlay is also what
 * sets subject.spaceId: at the web bump pass `{ spaceId }` (the same spaceId as here) to
 * popoverSubjectFromParticipant before dropping the overlay, or the sheet loses the space.
 */
export function presentProfileSheetForParticipant(opts: {
  participant: RoomParticipant;
  currentUserId?: string;
  onMessageUser?: (userId: string) => void;
  spaceRoles?: SpaceRole[];
  spaceRoleContext?: SpaceMemberRoleEditContext | null;
  spaceId?: string | null;
}): void {
  const spaceId = opts.spaceId ?? opts.spaceRoleContext?.spaceId ?? null;
  const subject = popoverSubjectFromParticipant(opts.participant, opts.spaceRoles);
  presentProfileSheet({
    subject: overlayProfileSubject(subject, spaceId ? (opts.participant as RoomParticipant & SpaceProfileFields) : null, spaceId),
    currentUserId: opts.currentUserId,
    onMessageUser: opts.onMessageUser,
    spaceRoleContext: opts.spaceRoleContext,
  });
}

export function dismissProfileSheet(): void {
  setProfileSheet({
    open: false,
    subject: null,
    onMessageUser: undefined,
    spaceRoleContext: null,
  });
}
