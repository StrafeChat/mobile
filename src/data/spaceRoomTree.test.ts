import { expect, test } from '@jest/globals';
import { buildSpaceRoomTree, threadsUnder, type SpaceRoomTreeItem, type TreeRoom } from './spaceRoomTree';

function room(id: string, type: number, position: number, extra: Partial<TreeRoom> = {}): TreeRoom {
  return { id, type, position, created_at: '2026-10-01T00:00:00.000Z', ...extra };
}

const short = (items: SpaceRoomTreeItem[]) =>
  items.map((i) => {
    switch (i.kind) {
      case 'section':
        return `[${i.sectionId}${i.collapsed ? ' closed' : ''}${i.hasUnread ? ' •' : ''}]`;
      case 'channel':
        return i.roomId;
      case 'thread':
        return `  ↳${i.roomId}`;
      case 'voiceUser':
        return `  @${i.userId}`;
    }
  });

const SPACE = [
  room('general', 3, 1),
  room('lobby', 4, 0),
  room('secS', 5, 2),
  room('secA', 5, 1),
  room('a-text', 3, 1, { parent_id: 'secA' }),
  room('a-voice', 4, 0, { parent_id: 'secA' }),
  room('s-text', 3, 0, { parent_id: 'secS' }),
  // A channel whose parent is not a section (stale/unknown) is top-level.
  room('orphan', 3, 5, { parent_id: 'gone' }),
  // Threads under #general.
  room('th-old', 6, 0, { parent_id: 'general', thread: { joined: true, last_active_at: '2026-10-02T00:00:00.000Z' } }),
  room('th-new', 6, 0, { parent_id: 'general', thread: { joined: true, last_active_at: '2026-10-05T00:00:00.000Z' } }),
  room('th-unjoined', 6, 0, { parent_id: 'general', thread: { joined: false } }),
  room('th-archived', 6, 0, { parent_id: 'general', thread: { joined: true, archived: true } }),
];

const base = {
  rooms: SPACE,
  canView: () => true,
  collapsedSectionIds: new Set<string>(),
  activeRoomId: null,
  hasUnreadOrMention: () => false,
};

test('top-level channels by position, then sections by position with their children', () => {
  expect(short(buildSpaceRoomTree(base))).toEqual([
    'lobby',
    'general',
    '  ↳th-new',
    '  ↳th-old',
    'orphan',
    '[secA]',
    'a-voice',
    'a-text',
    '[secS]',
    's-text',
  ]);
});

test('an unjoined thread shows only while it is the open room', () => {
  expect(threadsUnder(SPACE, 'general', 'th-unjoined').map((r) => r.id)).toEqual(['th-new', 'th-old', 'th-unjoined']);
  expect(threadsUnder(SPACE, 'general', 'th-archived').map((r) => r.id)).toEqual(['th-new', 'th-old']);
});

test('rooms and sections the viewer cannot see are left out', () => {
  const hidden = new Set(['secS', 'a-text', 'orphan']);
  const items = buildSpaceRoomTree({ ...base, canView: (r) => !hidden.has(r.id) });
  expect(short(items)).toEqual(['lobby', 'general', '  ↳th-new', '  ↳th-old', '[secA]', 'a-voice']);
});

test('a collapsed section hides its children and rolls their unread up onto the header', () => {
  const unread = new Set(['s-text']);
  const items = buildSpaceRoomTree({
    ...base,
    collapsedSectionIds: new Set(['secS', 'secA']),
    hasUnreadOrMention: (r) => unread.has(r.id),
  });
  expect(short(items).slice(-2)).toEqual(['[secA closed]', '[secS closed •]']);
});

test('the open channel and voice rooms never light a collapsed header', () => {
  const items = buildSpaceRoomTree({
    ...base,
    collapsedSectionIds: new Set(['secS', 'secA']),
    activeRoomId: 's-text',
    hasUnreadOrMention: () => true,
  });
  // secA: a-text (text, not active) counts; a-voice never would.
  expect(short(items).slice(-2)).toEqual(['[secA closed •]', '[secS closed]']);
});

test('the dot is only computed for collapsed sections', () => {
  const asked: string[] = [];
  buildSpaceRoomTree({ ...base, hasUnreadOrMention: (r) => (asked.push(r.id), false) });
  expect(asked).toEqual([]);
});

test('voice occupants follow their room, before its threads', () => {
  const items = buildSpaceRoomTree({ ...base, voiceUserIds: (id) => (id === 'lobby' ? ['u1', 'u2'] : []) });
  expect(short(items).slice(0, 3)).toEqual(['lobby', '  @u1', '  @u2']);
  const keys = items.map((i) => i.key);
  expect(new Set(keys).size).toBe(keys.length);
});
