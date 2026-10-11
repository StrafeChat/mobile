/**
 * Who and what the composer of a room can reference: the people for @mentions (a PM's
 * participants, or the space members who can see the channel - SpacePage's visibleMembers),
 * the space's mentionable roles and text rooms, and the custom emoji the viewer may use here.
 * Plus the MentionCatalog that serializeDraft turns `@name` / `#room` / `:emoji:` into wire
 * syntax with, built exactly as the web pages build it.
 */
import { useMemo } from 'react';
import { buildMentionCatalog, type MentionCatalog } from '@web/lib/utils/mentions';
import type { RoomParticipant } from '@web/api/rooms';
import type { SpaceRole, SpaceRoom } from '@web/api/spaces';
import type { CustomEmoji } from '@web/api/emojis';
import { spaces, spaceRoles } from '@web/stores/spaces';
import { deepEqual, useDerived } from '@/data/derived';
import { sourceMembers } from '@/data/members';
import { findPmRoom, findSpaceRoom } from '@/data/rooms';
import { useCustomEmojiList } from '@/data/reactions';
import type { CompletionPerson, CompletionRole, CompletionRoom } from '../logic/completion';

export interface ComposerContextData {
  /** Set for a space channel or thread. */
  spaceId: string | null;
  participants: CompletionPerson[];
  roles: CompletionRole[];
  rooms: CompletionRoom[];
}

function person(p: RoomParticipant): CompletionPerson {
  return {
    id: p.id,
    username: p.username,
    ...(p.display_name ? { display_name: p.display_name } : {}),
    ...(p.avatar ? { avatar: p.avatar } : {}),
    ...(p.bot ? { bot: true } : {}),
  };
}

export function composerContextData(roomId: string, spaceId?: string | null): ComposerContextData {
  const pm = findPmRoom(roomId);
  const found = pm ? undefined : findSpaceRoom(roomId, spaceId);
  if (!found) {
    return { spaceId: null, participants: (pm?.participants ?? []).map(person), roles: [], rooms: [] };
  }
  const sid = found.spaceId;
  const roles = (spaceRoles(sid) ?? spaces.spaces.find((s) => s.id === sid)?.roles ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    mentionable: r.mentionable,
  }));
  const spaceRooms = (spaces.spaceRoomsBySpaceId[sid] ?? []).map((r) => ({ id: r.id, name: r.name, type: r.type }));
  return {
    spaceId: sid,
    participants: sourceMembers({ spaceId: sid, roomId }).map(person),
    roles,
    rooms: spaceRooms,
  };
}

export interface ComposerContext extends ComposerContextData {
  customEmojis: CustomEmoji[];
  catalog: MentionCatalog;
}

/**
 * The composer's reference data. `onlyEmojiSpaceId` restricts custom emoji to one space (the
 * viewer lacks Use External Emojis in this channel); both completion and serialization use the
 * same restricted list, so an emoji the viewer may not use stays plain text.
 */
export function useComposerContext(roomId: string, spaceId: string | null | undefined, onlyEmojiSpaceId?: string): ComposerContext {
  const data = useDerived(`composerContext:${roomId}:${spaceId ?? ''}`, () => composerContextData(roomId, spaceId), deepEqual);
  const customEmojis = useCustomEmojiList(onlyEmojiSpaceId);
  const catalog = useMemo(
    () =>
      buildMentionCatalog({
        participants: data.participants as unknown as RoomParticipant[],
        roles: data.roles as unknown as SpaceRole[],
        channels: data.rooms as unknown as SpaceRoom[],
        emojis: customEmojis,
      }),
    [data, customEmojis],
  );
  return useMemo(() => ({ ...data, customEmojis, catalog }), [data, customEmojis, catalog]);
}
