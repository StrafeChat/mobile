/**
 * Store-connected presence: the web's PresenceDot (which takes a user id and reads
 * `presence.byUser`) and an Avatar that carries it.
 *
 * Kept apart from the pure PresenceDot/Avatar so those stay usable anywhere (and testable)
 * without pulling in the presence store. Each instance subscribes to exactly one user's status
 * - a member list of hundreds re-renders only the row whose user changed.
 *
 * presence.byUser is the only source the dot reads (see the web's presence handler): rows must
 * not pass a status they derived elsewhere, or the dot and the online grouping disagree.
 */
import { presence } from '@web/stores/presence';
import { useSolid } from '@/bridge/solid';
import { Avatar, avatarPixels, type AvatarProps } from './Avatar';
import { PresenceDot, type PresenceDotProps, type PresenceStatus } from './PresenceDot';

/** A user's live status ('offline' when unknown), subscribed narrowly. */
export function useUserStatus(userId: string | null | undefined): PresenceStatus {
  return useSolid(() => (userId ? presence.byUser[userId]?.status : undefined) ?? 'offline', [userId]);
}

/** A user's custom status text, if any. */
export function useUserCustomStatus(userId: string | null | undefined): string | undefined {
  return useSolid(() => (userId ? presence.byUser[userId]?.custom_status : undefined) || undefined, [userId]);
}

export interface UserPresenceDotProps extends Omit<PresenceDotProps, 'status'> {
  userId: string;
}

export function UserPresenceDot({ userId, ...rest }: UserPresenceDotProps) {
  const status = useUserStatus(userId);
  return <PresenceDot status={status} {...rest} />;
}

export interface UserAvatarProps extends Omit<AvatarProps, 'status' | 'overlay'> {
  userId: string;
  /** Hide the presence dot (a message author avatar, where Discord shows none). */
  hideStatus?: boolean;
}

export function UserAvatar({ userId, hideStatus, ringColor, size = 'lg', ...rest }: UserAvatarProps) {
  const px = avatarPixels(size);
  return (
    <Avatar
      size={size}
      ringColor={ringColor}
      overlay={
        hideStatus ? undefined : (
          <UserPresenceDot userId={userId} size={Math.max(8, Math.round(px * 0.3))} ringColor={ringColor} />
        )
      }
      {...rest}
    />
  );
}
