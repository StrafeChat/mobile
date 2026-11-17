/**
 * Who an avatar pictures, in any of the shapes a person reaches one as - the user row
 * (`{ id, origin_id }`), the app's view models (`{ userId, originId }`) or the bare id - as
 * the web's lib/userAvatar takes them (`AvatarUser`). Pure, with no images, so the data layer
 * can turn a store row into a plain reference (`avatarRef`) without pulling in the bundled
 * default avatars (defaultAvatar.ts).
 */
import type { DefaultAvatarSubject } from '@web/lib/defaultAvatar';
import type { AvatarUser } from '@web/lib/userAvatar';

export type { AvatarUser };

/** The `{ id, origin_id }` the web's defaultAvatarIndex takes. */
export function toAvatarSubject(user: AvatarUser): DefaultAvatarSubject {
  if (user == null || typeof user !== 'object') return { id: user };
  if ('userId' in user || 'originId' in user) {
    const ref = user as { userId?: string | null; originId?: string | null };
    return { id: ref.userId, origin_id: ref.originId };
  }
  return user as DefaultAvatarSubject;
}

/** A person reference as plain data, safe to keep in a snapshot: a store row passed as
 * AvatarUser would otherwise carry a store proxy into React. */
export interface AvatarRef {
  userId: string | null;
  originId?: string;
}

function idText(v: string | number | bigint | null | undefined): string | null {
  return v == null || v === '' ? null : String(v);
}

export function avatarRef(user: AvatarUser): AvatarRef {
  const subject = toAvatarSubject(user);
  const originId = idText(subject.origin_id);
  return { userId: idText(subject.id), ...(originId ? { originId } : {}) };
}
