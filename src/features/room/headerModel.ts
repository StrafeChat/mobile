/**
 * Which buttons a conversation's header carries, by kind of room and screen width. A phone
 * gets the two or three that matter for the room (Discord mobile's choice); everything else
 * lives in the room's info sheet. A tablet has room for the web header's full set.
 */
import type { RoomInfo } from '@/data';

export type HeaderActionKey = 'call' | 'video' | 'threads' | 'pins' | 'notify' | 'search' | 'members';

export function headerActionKeys(
  info: Pick<RoomInfo, 'kind' | 'callable' | 'hasMemberList' | 'spaceId'>,
  opts: { wide: boolean; voiceEnabled: boolean },
): HeaderActionKey[] {
  const canCall = info.callable && opts.voiceEnabled;
  const has: Record<HeaderActionKey, boolean> = {
    call: canCall,
    video: canCall,
    threads: info.kind === 'text' && !!info.spaceId,
    pins: true,
    notify: true,
    search: true,
    members: info.hasMemberList,
  };
  const order = (...keys: HeaderActionKey[]) => keys.filter((k) => has[k]);
  if (opts.wide) return order('call', 'video', 'threads', 'pins', 'notify', 'search', 'members');
  switch (info.kind) {
    case 'pm':
      return order('call', 'video', 'search');
    case 'group':
      return order('call', 'video', 'members');
    case 'notes':
      return order('pins', 'search');
    case 'text':
      return order('threads', 'search', 'members');
    case 'thread':
      return order('search', 'members');
    default:
      return order('search');
  }
}
