/**
 * Default avatars: the picture a person has until they upload one, as the web shows it.
 *
 * The images are the web client's own (`web/public/avatars/default/0.png` … `7.png`),
 * bundled into the app from the submodule rather than copied, so a person looks the same in
 * both and nothing is fetched to draw them. Which one a person gets is the web's rule
 * (`@web/lib/defaultAvatar`, `defaultAvatarIndex`): it follows the id their *home* instance
 * knows them by, so someone from another instance has the same colour here as at home. A
 * payload that carries `origin_id` says so directly; otherwise the federation identity
 * registry (`homeUserId`), which every store that ingests users fills, does - the same lookup
 * the web's `userDefaultAvatarUrl` makes.
 *
 * Spaces, rooms and applications have no default avatar: they keep their initial.
 */
import { DEFAULT_AVATAR_COUNT, defaultAvatarIndex } from '@web/lib/defaultAvatar';
import { homeUserId } from '@web/stores/federationIds';
import { toAvatarSubject, type AvatarUser } from './avatarRef';

export type { AvatarUser };

/**
 * The eight images, in the contract's order (index = position). Metro needs each require
 * spelled out; the count is checked against DEFAULT_AVATAR_COUNT by the tests.
 */
export const DEFAULT_AVATAR_IMAGES: readonly number[] = [
  require('../../web/public/avatars/default/0.png') as number,
  require('../../web/public/avatars/default/1.png') as number,
  require('../../web/public/avatars/default/2.png') as number,
  require('../../web/public/avatars/default/3.png') as number,
  require('../../web/public/avatars/default/4.png') as number,
  require('../../web/public/avatars/default/5.png') as number,
  require('../../web/public/avatars/default/6.png') as number,
  require('../../web/public/avatars/default/7.png') as number,
];

/**
 * 0 … 7: which default avatar a person gets here. The home id from the payload when it has
 * one, else from the registry, else their own id; an unknown person (null) gets 0.
 */
export function userDefaultAvatarIndex(user: AvatarUser): number {
  const subject = toAvatarSubject(user);
  const origin = subject.origin_id || (typeof subject.id === 'string' ? homeUserId(subject.id) : undefined);
  return defaultAvatarIndex({ id: subject.id, origin_id: origin });
}

/** The bundled image (an `expo-image` / `Image` source) for a person's default avatar. */
export function userDefaultAvatarSource(user: AvatarUser): number {
  return DEFAULT_AVATAR_IMAGES[userDefaultAvatarIndex(user)] ?? DEFAULT_AVATAR_IMAGES[0]!;
}

/** Re-exported so callers and tests needn't reach into the web lib for it. */
export { DEFAULT_AVATAR_COUNT };
