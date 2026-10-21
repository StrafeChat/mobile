/**
 * Mobile replacement for web/src/stores/userProfilePopover.ts.
 *
 * Same store, minus the geometry: on the web the card is a popover placed against the clicked
 * element's on-screen rect, on a phone it is a bottom sheet (src/platform/presenters/
 * profileSheet.ts), which needs no anchor. The open functions keep the web's signatures - an
 * `anchor` is accepted and ignored - so shared code calling them presents the sheet.
 *
 * Mobile UI should use presentProfileSheet / presentProfileSheetForParticipant from the
 * presenter: TypeScript resolves `@web/stores/userProfilePopover` to the web original, which
 * requires an HTMLElement anchor.
 */
import type { RoomParticipant } from '@web-original/api/rooms';
import type { SpaceRole } from '@web-original/api/spaces';
import type { SpaceMemberRoleEditContext, UserProfilePopoverSubject } from '@web-original/stores/userProfilePopover';
import {
  dismissProfileSheet,
  presentProfileSheet,
  presentProfileSheetForParticipant,
  profileSheet,
  setProfileSheet,
} from '../../presenters/profileSheet';

export type { ProfileRole, SpaceMemberRoleEditContext, UserProfilePopoverSubject } from '@web-original/stores/userProfilePopover';

export { profileSheet as userProfilePopover, setProfileSheet as setUserProfilePopover };

export function closeUserProfilePopover(): void {
  dismissProfileSheet();
}

/** A sheet sizes itself; there is nothing to re-place once the card has been measured. */
export function remeasureUserProfilePopover(_height: number): void {
  /* nothing to do */
}

export function openUserProfilePopover(opts: {
  anchor?: unknown;
  subject: UserProfilePopoverSubject;
  currentUserId?: string;
  onMessageUser?: (userId: string) => void;
  spaceRoleContext?: SpaceMemberRoleEditContext | null;
}): void {
  presentProfileSheet(opts);
}

export function openUserProfileFromParticipant(opts: {
  participant: RoomParticipant;
  anchor?: unknown;
  currentUserId?: string;
  onMessageUser?: (userId: string) => void;
  spaceRoles?: SpaceRole[];
  spaceRoleContext?: SpaceMemberRoleEditContext | null;
  /** The space the participant is shown in, so the card carries their space profile. */
  spaceId?: string;
}): void {
  presentProfileSheetForParticipant(opts);
}
