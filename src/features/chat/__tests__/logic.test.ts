/**
 * The chat area's pure rules: how a body is cut into runs and blocks, jumbo / lone-GIF
 * detection, the list's landing / jump / ack / paging decisions, the quick-reaction strip,
 * in-app link targets, the viewer's zoom steps and the audio speed cycle.
 */
import '@/ui/__tests__/setup';
import '@/data/testing/webMocks';
import { describe, expect, jest, test } from '@jest/globals';
import type { MessageListItem } from '@/data';
import { groupBlocks, isJumbo, linkEmbedOf, loneGif, mediaFilename, parseBody, segmentsPlainText } from '../body/bodyModel';
import {
  EDGE_LOAD_MARGIN_PX,
  bottomVisibleMessageId,
  buildRows,
  chooseLanding,
  distanceToBottom,
  edgesToLoad,
  itemType,
  resolveJumpRow,
  sameRow,
  topVisibleMessage,
  type ListRow,
} from '../list/listLogic';
import { quickReactions, reactionKeyOf, recentKeyOf, DEFAULT_QUICK_REACTIONS } from '../reactions/recents';
import { contentWidth, videoBox } from '../layout';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, canDismiss: () => false } }));
jest.mock('expo-audio', () => ({ useAudioPlayer: jest.fn(), useAudioPlayerStatus: jest.fn() }));
jest.mock('@/platform/media', () => ({ playExclusive: jest.fn(), useExclusivePlayback: jest.fn() }));
jest.mock('@web/stores/externalLink', () => ({ isExternalLink: () => true, requestOpenExternalLink: jest.fn() }));

// After the mocks: these import modules that touch native code at load.
 
const { internalTarget } = require('../navigation') as typeof import('../navigation');
const { stepZoom } = require('../viewer/zoom') as typeof import('../viewer/zoom');
const { nextRate, isAtEnd } = require('../media/useMessageAudio') as typeof import('../media/useMessageAudio');
 

function msg(id: string, extra: Partial<Extract<MessageListItem, { kind: 'message' }>> = {}): MessageListItem {
  return { kind: 'message', key: id, id, senderId: 'a', showHeader: true, groupStart: false, mentionsMe: false, system: false, pending: false, ...extra };
}

describe('body model', () => {
  test('inline nodes share one run; blocks break it, and the newline next to a block goes', () => {
    const blocks = groupBlocks(parseBody('hello **world**\n# Title\nafter'));
    expect(blocks.map((b) => b.kind)).toEqual(['run', 'block', 'run']);
    const first = blocks[0]!;
    expect(first.kind === 'run' && first.nodes.map((n) => n.type)).toEqual(['text', 'bold']);
    // "hello " then **world** - the newline before the heading is dropped.
    expect(first.kind === 'run' && first.nodes[0]!.type === 'text' && first.nodes[0]!.content).toBe('hello ');
    const last = blocks[2]!;
    expect(last.kind === 'run' && last.nodes[0]!.type === 'text' && last.nodes[0]!.content).toBe('after');
  });

  test('a top-level media or invite link is its own block with its embed', () => {
    const blocks = groupBlocks(parseBody('look https://example.com/cat.png nice'));
    expect(blocks.map((b) => b.kind)).toEqual(['run', 'embedLink', 'run']);
    const link = blocks[1]!;
    expect(link.kind === 'embedLink' && link.embed).toEqual({ kind: 'media', media: 'image' });
  });

  test('a suppressed link has no embed', () => {
    const [seg] = parseBody('<https://example.com/cat.png>');
    expect(seg?.type).toBe('link');
    expect(seg?.type === 'link' ? linkEmbedOf(seg) : 'x').toBeNull();
  });

  test('an embed link nested in styling stays inline, its card listed under the run', () => {
    const [run] = groupBlocks(parseBody('**https://example.com/a.gif**'));
    expect(run?.kind).toBe('run');
    expect(run?.kind === 'run' && run.embeds).toEqual([{ href: 'https://example.com/a.gif', embed: { kind: 'media', media: 'gif' } }]);
  });

  test('quotes and lists are blocks', () => {
    const blocks = groupBlocks(parseBody('> quoted\n- item\ntext'));
    expect(blocks.map((b) => (b.kind === 'block' ? b.node.type : b.kind))).toEqual(['quote', 'listItem', 'run']);
  });

  test('jumbo: 1 to 10 emoji and nothing else', () => {
    expect(isJumbo(parseBody('😀 🎉'))).toBe(true);
    expect(isJumbo(parseBody('😀 hi'))).toBe(false);
    expect(isJumbo(parseBody('😀'.repeat(11)))).toBe(false);
    expect(isJumbo(parseBody('<:wave:123>'))).toBe(true);
  });

  test('lone GIF: one unsuppressed GIF link only', () => {
    expect(loneGif(parseBody(' https://media.giphy.com/a/b.gif '))).toBe('https://media.giphy.com/a/b.gif');
    expect(loneGif(parseBody('https://x.com/a.gif and text'))).toBeNull();
    expect(loneGif(parseBody('<https://x.com/a.gif>'))).toBeNull();
    expect(loneGif(parseBody('https://x.com/a.png'))).toBeNull();
  });

  test('parse results are cached per text', () => {
    expect(parseBody('same text')).toBe(parseBody('same text'));
  });

  test('a hidden spoiler is drawn from its plain text', () => {
    const [spoiler] = parseBody('||secret **bold** <@1>||');
    expect(spoiler?.type).toBe('spoiler');
    expect(spoiler && 'children' in spoiler ? segmentsPlainText(spoiler.children) : '').toBe('secret bold @user');
  });

  test('media filename is the last path segment', () => {
    expect(mediaFilename('https://x.com/a/b/c%20d.png?x=1')).toBe('c d.png');
    expect(mediaFilename('not a url')).toBe('not a url');
  });
});

describe('list logic', () => {
  const items: MessageListItem[] = [
    { kind: 'intro', key: 'intro' },
    { kind: 'dateDivider', key: 'd:10', date: '2026-10-10T00:00:00Z', newMessages: false },
    msg('10'),
    msg('20'),
    { kind: 'newDivider', key: 'n:30' },
    msg('30'),
    msg('temp-1', { pending: true }),
  ];

  test('landing priority: jump > saved (not at bottom) > first unread on first view > bottom', () => {
    const base = { items, jumpTargetId: null, saved: undefined, firstView: true, firstUnreadId: '30' };
    expect(chooseLanding({ ...base, jumpTargetId: '20' })).toEqual({ kind: 'jump', targetId: '20' });
    expect(chooseLanding({ ...base, saved: { anchorId: '20', top: -12, atBottom: false } })).toEqual({ kind: 'saved', index: 3, top: -12 });
    // A saved position at the bottom, or whose row is gone, falls through.
    expect(chooseLanding({ ...base, saved: { anchorId: '20', top: 0, atBottom: true } })).toEqual({ kind: 'unread', index: 5 });
    expect(chooseLanding({ ...base, saved: { anchorId: '99', top: 0, atBottom: false } })).toEqual({ kind: 'unread', index: 5 });
    expect(chooseLanding({ ...base, firstView: false })).toEqual({ kind: 'bottom' });
    expect(chooseLanding({ ...base, firstUnreadId: null })).toEqual({ kind: 'bottom' });
  });

  test('a jump lands on its row, else the next newer, else the last', () => {
    expect(resolveJumpRow(items, '20')).toEqual({ index: 3, id: '20', exact: true });
    expect(resolveJumpRow(items, '25')).toEqual({ index: 5, id: '30', exact: false });
    expect(resolveJumpRow(items, '99')).toEqual({ index: 6, id: 'temp-1', exact: false });
    expect(resolveJumpRow([{ kind: 'intro', key: 'intro' }], '1')).toBeNull();
  });

  test('the ack target is the bottom-most visible real message', () => {
    const tok = (index: number, isViewable = true) => ({ index, isViewable, item: items[index]! });
    expect(bottomVisibleMessageId([tok(2), tok(3), tok(5), tok(6)])).toBe('30');
    expect(bottomVisibleMessageId([tok(2), tok(5, false)])).toBe('10');
    expect(bottomVisibleMessageId([tok(0), tok(1)])).toBeNull();
    expect(topVisibleMessage([tok(1), tok(3), tok(2)])).toEqual({ index: 2, id: '10' });
  });

  const geometry = { viewport: 600, content: 5000, moving: false, source: 'scroll' as const, unprompted: 0 };

  test('paging: older near the top while more exists; newer only in a jumped-to window', () => {
    const base = { ...geometry, offset: 1000, distanceToBottom: 1000, hasMessages: true, hasMoreOlder: undefined, loadingOlder: false, hasMoreNewer: false, loadingNewer: false };
    expect(edgesToLoad(base)).toEqual({ older: false, newer: false });
    expect(edgesToLoad({ ...base, offset: 100 })).toEqual({ older: true, newer: false });
    expect(edgesToLoad({ ...base, offset: 100, hasMoreOlder: false })).toEqual({ older: false, newer: false });
    expect(edgesToLoad({ ...base, offset: 100, loadingOlder: true })).toEqual({ older: false, newer: false });
    expect(edgesToLoad({ ...base, distanceToBottom: 50, hasMoreNewer: true })).toEqual({ older: false, newer: true });
    expect(edgesToLoad({ ...base, offset: 0, hasMessages: false })).toEqual({ older: false, newer: false });
    expect(distanceToBottom(1000, 400, 500)).toBe(100);
  });

  test('paging never fires on an unmeasured list or mid-landing (offset 0 is not "at the top" then)', () => {
    const base = { ...geometry, offset: 0, distanceToBottom: 0, hasMessages: true, hasMoreOlder: true, loadingOlder: false, hasMoreNewer: true, loadingNewer: false };
    expect(edgesToLoad({ ...base, viewport: 0 })).toEqual({ older: false, newer: false });
    expect(edgesToLoad({ ...base, content: 0 })).toEqual({ older: false, newer: false });
    expect(edgesToLoad({ ...base, moving: true })).toEqual({ older: false, newer: false });
    expect(edgesToLoad(base)).toEqual({ older: true, newer: true });
  });

  test('regression: checks the reader did not prompt never chain pages on a full list', () => {
    // #files-test: the list sat "near the top" after every page (its position was not kept),
    // and each page's arrival paged again - 44 requests, back to the room's first message.
    const atTop = { ...geometry, offset: 120, distanceToBottom: 4000, hasMessages: true, hasMoreOlder: true, loadingOlder: false, hasMoreNewer: false, loadingNewer: false };
    expect(edgesToLoad({ ...atTop, source: 'settle', unprompted: 0 }).older).toBe(true);
    expect(edgesToLoad({ ...atTop, source: 'settle', unprompted: 1 }).older).toBe(false);
    expect(edgesToLoad({ ...atTop, source: 'settle', unprompted: 7 }).older).toBe(false);
    // The reader's own scroll at the top always pages.
    expect(edgesToLoad({ ...atTop, source: 'scroll', unprompted: 7 }).older).toBe(true);
    // A list too short to scroll past the margin keeps filling itself.
    expect(edgesToLoad({ ...atTop, source: 'settle', unprompted: 3, content: 600 + EDGE_LOAD_MARGIN_PX - 1 }).older).toBe(true);
  });

  test('rows: dividers fold into the message below them, edges become header / footer', () => {
    const model: MessageListItem[] = [
      { kind: 'historyEdge', key: 'edge:older', side: 'older' },
      { kind: 'dateDivider', key: 'd:10', date: '2026-10-10T00:00:00Z', newMessages: false },
      msg('10'),
      { kind: 'newDivider', key: 'n:20' },
      { kind: 'e2eeDivider', key: 'e:20', encrypted: true },
      msg('20'),
      { kind: 'historyEdge', key: 'edge:newer', side: 'newer' },
    ];
    const { rows, olderEdge, newerEdge } = buildRows(model);
    expect(olderEdge).toBe(true);
    expect(newerEdge).toBe(true);
    // The top row is always a message keyed by its own id - what the list anchors a prepend on.
    expect(rows.map((r) => r.key)).toEqual(['10', '20']);
    expect(rows[1]!.kind === 'message' && rows[1]!.dividers.map((d) => d.key)).toEqual(['n:20', 'e:20']);
    expect(buildRows([{ kind: 'intro', key: 'intro' }, msg('1')]).rows.map((r) => r.kind)).toEqual(['intro', 'message']);
  });

  test('rows compare by value, so unchanged rows do not re-render on a structural change', () => {
    const a = buildRows([{ kind: 'dateDivider', key: 'd:1', date: 'x', newMessages: false }, msg('1')]).rows[0]!;
    const same = buildRows([{ kind: 'dateDivider', key: 'd:1', date: 'x', newMessages: false }, msg('1')]).rows[0]!;
    const newDivider = buildRows([{ kind: 'dateDivider', key: 'd:1', date: 'x', newMessages: true }, msg('1')]).rows[0]!;
    const grouped = buildRows([msg('1', { showHeader: false })]).rows[0]!;
    expect(sameRow(a, same)).toBe(true);
    expect(sameRow(a, newDivider)).toBe(false);
    expect(sameRow(a, grouped)).toBe(false);
  });

  test('rows recycle by shape', () => {
    const row = (m: MessageListItem): ListRow => buildRows([m]).rows[0]!;
    expect(itemType(row(msg('1')))).toBe('message');
    expect(itemType(row(msg('1', { showHeader: false })))).toBe('continuation');
    expect(itemType(row(msg('1', { system: true })))).toBe('system');
    expect(itemType({ kind: 'intro', key: 'intro' })).toBe('intro');
  });
});

describe('quick reactions', () => {
  test('recent first, then the defaults, no duplicates, custom only when allowed', () => {
    const picks = quickReactions(['u:🔥', 'c:7', 'c:8', 'u:👍', 'u:🔥'], (id) => id === '7');
    expect(picks).toEqual([{ unicode: '🔥' }, { customId: '7' }, { unicode: '👍' }, { unicode: '❤️' }, { unicode: '😂' }, { unicode: '😮' }]);
    expect(quickReactions([], () => true).map((p) => ('unicode' in p ? p.unicode : ''))).toEqual(DEFAULT_QUICK_REACTIONS);
  });

  test('keys: the server reaction key and the recents key', () => {
    expect(reactionKeyOf({ unicode: '👍' })).toBe('👍');
    expect(reactionKeyOf({ customId: '9' })).toBe('custom:9');
    expect(recentKeyOf({ unicode: '👍' })).toBe('u:👍');
    expect(recentKeyOf({ customId: '9' })).toBe('c:9');
  });
});

describe('links, viewer, players, sizing', () => {
  test('a thread opens with its space when the caller knows it', () => {
    const { openThread } = require('../navigation') as typeof import('../navigation');
    const { router } = require('expo-router') as { router: { push: jest.Mock } };
    openThread('t1', 's1');
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/thread/[threadId]', params: { threadId: 't1', spaceId: 's1' } });
    openThread('t2', null);
    expect(router.push).toHaveBeenLastCalledWith({ pathname: '/thread/[threadId]', params: { threadId: 't2' } });
  });

  test('in-app link targets', () => {
    expect(internalTarget('https://chat.example/rooms/12')).toEqual({ kind: 'room', roomId: '12', spaceId: null });
    expect(internalTarget('https://chat.example/spaces/3/rooms/4')).toEqual({ kind: 'room', roomId: '4', spaceId: '3' });
    expect(internalTarget('https://chat.example/invite/abc%40other.host')).toEqual({ kind: 'invite', code: 'abc@other.host' });
    expect(internalTarget('https://chat.example/settings')).toBeNull();
  });

  test('zoom steps (1, 1.5, 2, 3, 4)', () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1.5, 1)).toBe(2);
    expect(stepZoom(4, 1)).toBe(4);
    expect(stepZoom(2.5, -1)).toBe(2);
    expect(stepZoom(1.5, -1)).toBe(1);
    expect(stepZoom(1, -1)).toBe(1);
  });

  test('speed cycle and the end of a clip', () => {
    expect(nextRate(1)).toBe(1.25);
    expect(nextRate(2)).toBe(0.5);
    expect(nextRate(1.1)).toBe(0.5);
    expect(isAtEnd(9.99, 10, false)).toBe(true);
    expect(isAtEnd(3, 10, false)).toBe(false);
    expect(isAtEnd(0, 0, true)).toBe(true);
  });

  test('media fits the content column and the web caps', () => {
    expect(contentWidth(390, false, false)).toBe(390 - 32 - 52);
    expect(contentWidth(390, true, false)).toBe(390 - 32);
    expect(contentWidth(1024, false, true)).toBe(1024 - 340 - 280 - 32 - 52);
    expect(videoBox(undefined, undefined, 300)).toEqual({ width: 300, height: 169 });
    expect(videoBox(1920, 1080, 1000)).toEqual({ width: 400, height: 225 });
    // A tall, narrow clip keeps the controls' minimum width.
    expect(videoBox(100, 1000, 1000).width).toBe(232);
  });
});
