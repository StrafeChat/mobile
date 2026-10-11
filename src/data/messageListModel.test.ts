import { describe, expect, test } from '@jest/globals';
import './testing/webMocks';
import {
  MESSAGE_GROUP_THRESHOLD_MS,
  buildMessageList,
  e2eeDividerIndices,
  firstUnreadIndex,
  type BuildMessageListInput,
  type ListMessage,
  type MessageListItem,
} from './messageListModel';

// Local-time dates, so day boundaries are the device's (as toDateString is).
const day1 = (h: number, m = 0) => new Date(2026, 9, 10, h, m).toISOString();
const day2 = (h: number, m = 0) => new Date(2026, 9, 11, h, m).toISOString();

const ME = '1';
const ALICE = '2';
const BOB = '3';

function msg(id: string, sender: string, created: string, extra: Partial<ListMessage> = {}): ListMessage {
  return { id, sender_id: sender, created_at: created, ...extra };
}

function buildBase(messages: ListMessage[], over: Partial<BuildMessageListInput> = {}) {
  return buildMessageList({
    messages,
    currentUserId: ME,
    isBlocked: () => false,
    lastReadMessageId: null,
    maxMessageIdWhenEntered: null,
    // Structural tests leave the NEW divider out; its own tests turn it back on.
    newHeaderDismissed: true,
    hasMoreOlder: false,
    hasMoreNewer: false,
    ...over,
  });
}

const build = buildBase;

const kinds = (items: MessageListItem[]) =>
  items.map((i) => (i.kind === 'message' ? `m:${i.id}${i.showHeader ? '*' : ''}` : i.kind === 'dateDivider' ? `date${i.newMessages ? '+new' : ''}` : i.kind));

describe('grouping', () => {
  test('a header on sender change, after the 5-minute gap, and on every reply', () => {
    const list = [
      msg('10', ALICE, day1(9, 0)),
      msg('11', ALICE, day1(9, 4)), // same sender, 4 min: continuation
      msg('12', BOB, day1(9, 5)), // new sender
      msg('13', BOB, day1(9, 5), { reply_to_id: '10' }), // reply always breaks
      msg('14', BOB, day1(9, 6)),
      msg('15', BOB, new Date(new Date(day1(9, 6)).getTime() + MESSAGE_GROUP_THRESHOLD_MS + 1).toISOString()),
    ];
    expect(kinds(build(list).items)).toEqual(['intro', 'date', 'm:10*', 'm:11', 'm:12*', 'm:13*', 'm:14', 'm:15*']);
  });

  test('exactly 5 minutes is still the same group', () => {
    const t0 = new Date(day1(10)).getTime();
    const list = [msg('1', ALICE, new Date(t0).toISOString()), msg('2', ALICE, new Date(t0 + MESSAGE_GROUP_THRESHOLD_MS).toISOString())];
    expect(kinds(build(list).items)).toEqual(['intro', 'date', 'm:1*', 'm:2']);
  });

  test('groupStart marks header rows below another row', () => {
    const items = build([msg('1', ALICE, day1(9)), msg('2', BOB, day1(9, 1))]).items.filter((i) => i.kind === 'message');
    expect(items.map((i) => i.kind === 'message' && i.groupStart)).toEqual([false, true]);
  });
});

describe('day dividers', () => {
  test('before the first row and at each new local day', () => {
    const list = [msg('1', ALICE, day1(23, 58)), msg('2', ALICE, day2(0, 1))];
    // Within 5 minutes of the row above, so still a continuation: the divider is its own row
    // and grouping only looks at sender, time and replies (as on the web).
    expect(kinds(build(list).items)).toEqual(['intro', 'date', 'm:1*', 'date', 'm:2']);
  });
});

describe('NEW divider', () => {
  const build = (messages: ListMessage[], over: Partial<BuildMessageListInput> = {}) =>
    buildBase(messages, { newHeaderDismissed: false, ...over });
  const list = [
    msg('100', ALICE, day1(9)),
    msg('101', ME, day1(9, 1)),
    msg('102', ALICE, day1(9, 2)),
    msg('103', BOB, day1(9, 3)),
    msg('104', ALICE, day1(9, 4)),
  ];

  test('above the first message from someone else after the entry cursor', () => {
    const r = build(list, { lastReadMessageId: '101', maxMessageIdWhenEntered: '104' });
    expect(r.firstUnreadId).toBe('102');
    expect(kinds(r.items)).toEqual(['intro', 'date', 'm:100*', 'm:101*', 'newDivider', 'm:102*', 'm:103*', 'm:104*']);
  });

  test('own messages never count, and with no cursor the first other message is unread', () => {
    const r = build([msg('101', ME, day1(9)), msg('102', ALICE, day1(9, 1))], { lastReadMessageId: null, maxMessageIdWhenEntered: '102' });
    expect(r.firstUnreadId).toBe('102');
  });

  test('messages that arrived while viewing are not "new"', () => {
    const r = build(list, { lastReadMessageId: '102', maxMessageIdWhenEntered: '102' });
    expect(r.firstUnreadId).toBeNull();
    expect(r.items.some((i) => i.kind === 'newDivider')).toBe(false);
  });

  test('dismissed hides it', () => {
    expect(build(list, { lastReadMessageId: '101', maxMessageIdWhenEntered: '104', newHeaderDismissed: true }).firstUnreadId).toBeNull();
  });

  test('temp (optimistic) ids are skipped', () => {
    const r = build([msg('temp-1-a', ALICE, day1(9)), msg('105', ALICE, day1(9, 1))], { lastReadMessageId: '100', maxMessageIdWhenEntered: '105' });
    expect(r.firstUnreadId).toBe('105');
  });

  test('merges into the day divider on the same row', () => {
    const r = build([msg('100', ALICE, day1(9)), msg('101', ALICE, day2(9))], { lastReadMessageId: '100', maxMessageIdWhenEntered: '101' });
    expect(kinds(r.items)).toEqual(['intro', 'date', 'm:100*', 'date+new', 'm:101*']);
  });

  test('ids compare as snowflakes, not strings', () => {
    // '9' > '10' as strings; as numbers 10 is newer.
    expect(firstUnreadIndex([msg('9', ALICE, day1(9)), msg('10', ALICE, day1(9, 1))], {
      currentUserId: ME,
      lastReadMessageId: '9',
      maxMessageIdWhenEntered: '10',
      dismissed: false,
    })).toBe(1);
  });
});

describe('E2EE dividers', () => {
  test('"no longer encrypted" only after encrypted history, "now encrypted" after plaintext', () => {
    const list = [
      msg('1', ALICE, day1(9)),
      msg('2', ALICE, day1(9, 1), { notEncrypted: true }),
      msg('3', ALICE, day1(9, 2), { notEncrypted: true }),
      msg('4', ALICE, day1(9, 3)),
    ];
    expect(e2eeDividerIndices(list)).toEqual({ firstPlaintext: 1, firstEncryptedAfterPlaintext: 3 });
    const items = build(list).items.filter((i) => i.kind === 'e2eeDivider');
    expect(items.map((i) => i.kind === 'e2eeDivider' && i.encrypted)).toEqual([false, true]);
  });

  test('a room that was always plaintext announces nothing', () => {
    const list = [msg('1', ALICE, day1(9), { notEncrypted: true }), msg('2', ALICE, day1(9, 1), { notEncrypted: true })];
    expect(e2eeDividerIndices(list)).toEqual({ firstPlaintext: -1, firstEncryptedAfterPlaintext: -1 });
  });

  test('system and temp rows are ignored', () => {
    const list = [
      msg('1', ALICE, day1(9)),
      msg('2', ALICE, day1(9, 1), { system_type: 'member_added' }),
      msg('temp-9', ME, day1(9, 2), { notEncrypted: true }),
      msg('3', ALICE, day1(9, 3), { notEncrypted: true }),
    ];
    expect(e2eeDividerIndices(list)).toEqual({ firstPlaintext: 3, firstEncryptedAfterPlaintext: -1 });
  });
});

describe('blocked senders, mentions, edges', () => {
  test('blocked senders are not rendered and do not break grouping', () => {
    const list = [msg('1', ALICE, day1(9)), msg('2', BOB, day1(9, 1)), msg('3', ALICE, day1(9, 2))];
    const r = build(list, { isBlocked: (id) => id === BOB });
    expect(r.visibleIds).toEqual(['1', '3']);
    expect(kinds(r.items)).toEqual(['intro', 'date', 'm:1*', 'm:3']);
  });

  test('a blocked message is never the NEW row', () => {
    const list = [msg('1', BOB, day1(9)), msg('2', ALICE, day1(9, 1))];
    const r = build(list, { isBlocked: (id) => id === BOB, maxMessageIdWhenEntered: '2', newHeaderDismissed: false });
    expect(r.firstUnreadId).toBe('2');
  });

  test('mentionsMe from mention_everyone or a direct mention', () => {
    const list = [
      msg('1', ALICE, day1(9), { mention_everyone: true }),
      msg('2', ALICE, day1(9, 1), { mentions: [ME] }),
      msg('3', ALICE, day1(9, 2), { mentions: [BOB] }),
    ];
    const flags = build(list).items.flatMap((i) => (i.kind === 'message' ? [i.mentionsMe] : []));
    expect(flags).toEqual([true, true, false]);
  });

  test('intro only once history is exhausted; edges while there is more', () => {
    const list = [msg('1', ALICE, day1(9))];
    expect(kinds(build(list, { hasMoreOlder: true, hasMoreNewer: true }).items)).toEqual(['historyEdge', 'date', 'm:1*', 'historyEdge']);
    // Unknown counts as "maybe more" (the web's `?? true`).
    expect(kinds(build(list, { hasMoreOlder: undefined }).items)[0]).toBe('historyEdge');
    expect(kinds(build([], { hasMoreOlder: true }).items)).toEqual(['intro']);
  });
});
