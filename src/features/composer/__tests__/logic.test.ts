/**
 * The composer's pure logic: autocomplete (the web's rules), edit-mode text round trips,
 * the typing throttle, slowmode's retry_after, the hold-to-record thresholds, and the emoji
 * grid model.
 */
import '@/ui/__tests__/setup';
import { describe, expect, test } from '@jest/globals';
import { buildMentionCatalog, serializeDraft } from '@web/lib/utils/mentions';
import { ApiError } from '@web/api/ApiError';
import type { EmojiCatalog, EmojiEntry } from '@web/lib/emoji/data';
import { computeCompletion, spliceText, type CompletionContext } from '../logic/completion';
import { readableToWire, wireToReadable } from '../logic/wireText';
import { createTypingEmitter, hasContent, retryAfterSeconds, sendErrorText, TYPING_PING_MS } from '../logic/sending';
import { CANCEL_DISTANCE, LOCK_DISTANCE, cancelProgress, classifyDrag, formatClock } from '../logic/recordGesture';
import { buildEmojiSections, headerIndex, recentKeyOf, searchEmojiCells, toGridRows } from '../logic/emojiGrid';
import { loadRecentEmoji, pushRecentEmoji, RECENT_KEY, RECENT_MAX } from '../logic/emojiRecent';

// The app's MMKV-backed localStorage, in memory.
const memory = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
  },
});

function entry(unicode: string, shortcode: string, group: number, extra: Partial<EmojiEntry> = {}): EmojiEntry {
  return {
    unicode,
    hexcode: unicode.codePointAt(0)!.toString(16),
    label: shortcode.replace(/_/g, ' '),
    shortcode,
    shortcodes: [shortcode],
    tags: [],
    group,
    order: 0,
    ...extra,
  };
}

function catalogOf(list: EmojiEntry[]): EmojiCatalog {
  const byGroup = new Map<number, EmojiEntry[]>();
  const byShortcode = new Map<string, EmojiEntry>();
  const byUnicode = new Map<string, EmojiEntry>();
  for (const e of list) {
    byGroup.set(e.group, [...(byGroup.get(e.group) ?? []), e]);
    for (const c of e.shortcodes) byShortcode.set(c, e);
    byUnicode.set(e.unicode, e);
  }
  return { all: list, byGroup, byShortcode, byUnicode };
}

const THUMBS = entry('👍', 'thumbs_up', 1, { skins: ['👍🏻', '👍🏼', '👍🏽', '👍🏾', '👍🏿'] });
const SMILE = entry('😄', 'smile', 0);
const CATALOG = catalogOf([SMILE, THUMBS]);

const ctx = (over: Partial<CompletionContext> = {}): CompletionContext => ({
  participants: [
    { id: '1', username: 'alice', display_name: 'Alice A' },
    { id: '2', username: 'bob', display_name: 'Bobby', bot: true },
    { id: '100', username: 'me', display_name: 'Myself' },
  ],
  roles: [
    { id: 'r1', name: 'Mods', color: 0xff0000, mentionable: true },
    { id: 'r2', name: 'Hidden', color: 0, mentionable: false },
    { id: 'r0', name: '@everyone', color: 0, mentionable: true },
  ],
  rooms: [
    { id: 'c1', name: 'general', type: 3 },
    { id: 'c2', name: 'gaming', type: 3 },
    { id: 'v1', name: 'garage', type: 4 },
  ],
  canMentionEveryone: false,
  currentUserId: '100',
  customEmojis: [{ id: 'e1', name: 'partyblob', url: 'https://cdn/e1.png' }],
  emojiCatalog: CATALOG,
  skinTone: 0,
  ...over,
});

describe('autocomplete', () => {
  test('@ offers people (display name or username prefix) and mentionable roles', () => {
    const c = computeCompletion('hi @b', 5, ctx())!;
    expect(c.queryStart).toBe(3);
    expect(c.cursorEnd).toBe(5);
    expect(c.list.map((x) => x.key)).toEqual(['user:2']);
    const all = computeCompletion('@', 1, ctx())!;
    expect(all.list.map((x) => x.key)).toEqual(['user:1', 'user:2', 'user:100', 'role:r1']);
    expect(all.list[2]!.sublabel).toBe('You');
    expect(all.list[0]!.insertText).toBe('@alice ');
  });

  test('@everyone / @here only where allowed', () => {
    expect(computeCompletion('@ev', 3, ctx())).toBeNull();
    const c = computeCompletion('@', 1, ctx({ canMentionEveryone: true }))!;
    expect(c.list.slice(-2).map((x) => x.insertText)).toEqual(['@everyone ', '@here ']);
  });

  test('# offers text rooms only, and only inside a space', () => {
    expect(computeCompletion('#g', 2, ctx())!.list.map((x) => x.label)).toEqual(['general', 'gaming']);
    expect(computeCompletion('#g', 2, ctx({ rooms: [] }))).toBeNull();
  });

  test(': needs two characters; custom emoji first, then Unicode with the skin tone', () => {
    expect(computeCompletion(':t', 2, ctx())).toBeNull();
    const c = computeCompletion(':th', 3, ctx({ skinTone: 2 }))!;
    expect(c.list.map((x) => x.insertText)).toEqual(['👍🏼 ']);
    const p = computeCompletion(':party', 6, ctx())!;
    expect(p.list[0]).toMatchObject({ kind: 'emoji', insertText: ':partyblob: ', customUrl: 'https://cdn/e1.png' });
  });

  test('word boundaries and whitespace close it (email@, 10:30, a space after the query)', () => {
    expect(computeCompletion('mail@al', 7, ctx())).toBeNull();
    expect(computeCompletion('at 10:30', 8, ctx())).toBeNull();
    expect(computeCompletion('@al ice', 7, ctx())).toBeNull();
    expect(computeCompletion('@al\n', 4, ctx())).toBeNull();
  });

  test('works on the text before the caret only', () => {
    expect(computeCompletion('@al and more', 3, ctx())!.list.map((x) => x.key)).toEqual(['user:1']);
  });

  test('caps the list at 12', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 10), username: `user${i}` }));
    expect(computeCompletion('@u', 2, ctx({ participants: many }))!.list).toHaveLength(12);
  });

  test('spliceText replaces the trigger range and puts the caret after the insert', () => {
    expect(spliceText('hi @al there', 3, 6, '@alice ')).toEqual({ text: 'hi @alice  there', caret: 10 });
  });
});

describe('edit mode text', () => {
  const catalog = buildMentionCatalog({
    participants: [
      { id: '1', username: 'alice', display_name: 'Alice' },
      { id: '2', username: 'bob', display_name: 'Bob' },
      { id: '3', username: 'bobby', display_name: 'Bobby' },
    ] as never,
    roles: [{ id: '9', name: 'Space Mods', color: 0 }] as never,
    channels: [{ id: '7', name: 'general', type: 3 }] as never,
    emojis: [{ id: '5', name: 'blob', animated: false }] as never,
  });

  test('wire tokens become readable and serialize back to the same wire text', () => {
    const wire = 'hey <@1> and <@3>, see <#7> <:blob:5> ask <@&9>';
    const readable = wireToReadable(wire, catalog);
    expect(readable).toBe('hey @alice and @bobby, see #general :blob: ask @Space Mods');
    expect(readableToWire(readable, catalog)).toBe(wire);
  });

  test('unknown ids, glued words and code spans stay as they are', () => {
    expect(wireToReadable('who is <@42>?', catalog)).toBe('who is <@42>?');
    expect(wireToReadable('<@1>abc', catalog)).toBe('<@1>abc');
    expect(wireToReadable('`<@1>` vs <@1>', catalog)).toBe('`<@1>` vs @alice');
  });

  test('a mention another name would shadow keeps its wire form', () => {
    // "@bob" followed by "by" would read back as @bobby, so <@2> must stay literal.
    const wire = '<@2>by';
    const readable = wireToReadable(wire, catalog);
    expect(serializeDraft(readable, catalog)).toBe(wire);
  });
});

describe('sending helpers', () => {
  test('typing is announced at most every 6 s, and a send resets the throttle', () => {
    let now = 1_000_000;
    const sent: number[] = [];
    const e = createTypingEmitter(() => sent.push(now), () => now);
    e.onInput();
    now += 1000;
    e.onInput();
    now += TYPING_PING_MS;
    e.onInput();
    expect(sent).toHaveLength(2);
    e.reset();
    e.onInput();
    expect(sent).toHaveLength(3);
  });

  test('retry_after from a 429 drives the slowmode wait', () => {
    expect(retryAfterSeconds(new ApiError('slow', 429, undefined, undefined, { retry_after: 7 }))).toBe(7);
    expect(retryAfterSeconds(new ApiError('no', 403, undefined, undefined, { retry_after: 7 }))).toBe(0);
    expect(retryAfterSeconds(new Error('x'))).toBe(0);
  });

  test('a failed send always explains itself', () => {
    expect(sendErrorText(new Error(''))).not.toBe('');
  });

  test('content is text or files', () => {
    expect(hasContent('  ', 0)).toBe(false);
    expect(hasContent('  ', 1)).toBe(true);
    expect(hasContent('a', 0)).toBe(true);
  });
});

describe('hold to record', () => {
  test('sliding towards the start edge cancels; up locks', () => {
    expect(classifyDrag(-CANCEL_DISTANCE, 0, false)).toBe('cancel');
    expect(classifyDrag(CANCEL_DISTANCE, 0, true)).toBe('cancel');
    expect(classifyDrag(CANCEL_DISTANCE, 0, false)).toBe('none');
    expect(classifyDrag(0, -LOCK_DISTANCE, false)).toBe('lock');
    expect(classifyDrag(-CANCEL_DISTANCE * 0.6, -LOCK_DISTANCE, false)).toBe('none');
    expect(classifyDrag(-10, -10, false)).toBe('none');
  });

  test('cancel progress and the clock', () => {
    expect(cancelProgress(-CANCEL_DISTANCE / 2, false)).toBeCloseTo(0.5);
    expect(cancelProgress(40, false)).toBe(0);
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65_400)).toBe('1:05');
  });
});

describe('emoji grid', () => {
  const spaces = [
    { spaceId: 's1', name: 'One', acronym: 'O', emojis: [{ id: 'e1', name: 'partyblob', url: 'u1', space_id: 's1' }] },
    { spaceId: 's2', name: 'Two', acronym: 'T', emojis: [{ id: 'e2', name: 'party', url: 'u2', space_id: 's2' }] },
  ];
  const byId = Object.fromEntries(spaces.flatMap((s) => s.emojis).map((e) => [e.id, e]));

  test('sections: recent (when any), each space, then the Unicode groups', () => {
    const sections = buildEmojiSections({ catalog: CATALOG, recent: ['u:👍', 'c:e2', 'c:gone'], spaces, customById: (id) => byId[id], tone: 1 });
    expect(sections.map((s) => s.id)).toEqual(['recent', 'space:s1', 'space:s2', 'group:0', 'group:1']);
    expect(sections[0]!.cells.map((c) => c.unicode ?? c.custom?.id)).toEqual(['👍🏻', 'e2']);
    expect(buildEmojiSections({ catalog: CATALOG, recent: [], spaces, customById: () => undefined, tone: 0 })[0]!.id).toBe('space:s1');
  });

  test('a space restriction hides the other spaces everywhere', () => {
    const sections = buildEmojiSections({ catalog: CATALOG, recent: ['c:e2'], spaces, onlySpaceId: 's1', customById: (id) => byId[id], tone: 0 });
    expect(sections.map((s) => s.id)).toEqual(['space:s1', 'group:0', 'group:1']);
    expect(searchEmojiCells('party', { catalog: CATALOG, spaces, onlySpaceId: 's1', tone: 0 }).map((c) => c.key)).toEqual(['c:e1']);
  });

  test('search: custom emoji first, then Unicode', () => {
    expect(searchEmojiCells('par', { catalog: CATALOG, spaces, tone: 0 }).map((c) => c.key)).toEqual(['c:e1', 'c:e2']);
    expect(searchEmojiCells('smi', { catalog: CATALOG, spaces, tone: 0 }).map((c) => c.label)).toEqual([':smile:']);
  });

  test('rows chunk by column count and the rail finds headers', () => {
    const sections = buildEmojiSections({ catalog: CATALOG, recent: [], spaces, customById: () => undefined, tone: 0 });
    const rows = toGridRows(sections, 1);
    expect(rows.filter((r) => r.kind === 'header')).toHaveLength(4);
    expect(headerIndex(rows, 'group:1')).toBe(6);
    expect(recentKeyOf({ key: 'x', unicode: '👍🏻', baseUnicode: '👍', label: '' })).toBe('u:👍');
  });

  test('recent list: newest first, deduplicated, capped (the web key)', () => {
    globalThis.localStorage.removeItem(RECENT_KEY);
    pushRecentEmoji('u:a');
    pushRecentEmoji('u:b');
    expect(pushRecentEmoji('u:a')).toEqual(['u:a', 'u:b']);
    for (let i = 0; i < 40; i++) pushRecentEmoji(`u:${i}`);
    expect(loadRecentEmoji()).toHaveLength(RECENT_MAX);
  });
});
