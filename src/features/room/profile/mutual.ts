/**
 * Spaces you share with someone. The server has no mutual-spaces endpoint, so this reads the
 * member lists this device already holds (each space's list is fetched when one of its rooms
 * is opened, and kept for the gateway session) - it can miss a shared space whose members
 * were never loaded, and it never asks the server about anyone.
 */
import { spaces } from '@web/stores/spaces';
import { spaceMembers } from '@web/stores/spaceMembers';
import { sameArray, useDerived } from '@/data';

export function mutualSpaceIds(userId: string, viewerId: string | null | undefined): string[] {
  if (!userId || userId === viewerId) return [];
  return spaces.spaces.filter((s) => spaceMembers.bySpaceId[s.id]?.some((m) => m.id === userId)).map((s) => s.id);
}

export function useMutualSpaceIds(userId: string, viewerId: string | null | undefined): string[] {
  return useDerived(`room:mutualSpaces:${userId}:${viewerId ?? ''}`, () => mutualSpaceIds(userId, viewerId), sameArray);
}
