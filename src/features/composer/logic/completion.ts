/**
 * The composer's autocomplete: which `@` / `#` / `:` completion is open for the text before
 * the caret, and what it offers. A port of the candidate computation inside the web's
 * RoomMessageInput (same triggers, boundaries, ordering and caps), as one pure function so it
 * can be tested and both clients stay in step.
 *
 * Rules (web):
 * - the trigger is the last '@', ':' or '#' before the caret ('#' only where the room has
 *   space channels to offer);
 * - it must start a word: "email@" and "10:30" never open the list;
 * - the query after it holds no whitespace;
 * - ':' needs two characters, then custom emoji whose name contains the query (max 6), then
 *   Unicode emoji (max 8, the viewer's skin tone applied);
 * - '#' offers text channels whose name starts with the query;
 * - '@' offers people (yourself included, labelled You), mentionable roles, and @everyone /
 *   @here where the viewer may use them; a person matches by the start of their nickname,
 *   display name or username, and is shown by their space profile (name and face) - but the
 *   inserted text is always `@username`, the only form serializeDraft turns into a mention, so
 *   a nickname that copies someone's username can never take their mentions;
 * - at most 12 rows; picking replaces [trigger, caret) with the insert text.
 */
import { t } from '@web/i18n/t';
import { spaceRoleColorHex } from '@web/lib/spacePermissions';
import { searchEmoji, withSkinTone, type EmojiCatalog } from '@web/lib/emoji/data';
import { resolveProfile, type SpaceProfileFields } from '@/data/spaceProfileCore';

export interface CompletionPerson extends SpaceProfileFields {
  id: string;
  username: string;
  display_name?: string;
  avatar?: string;
  bot?: boolean;
}

export interface CompletionRole {
  id: string;
  name: string;
  color: number;
  mentionable: boolean;
}

export interface CompletionRoom {
  id: string;
  name: string;
  type: number;
}

export interface CompletionEmoji {
  id: string;
  name: string;
  url: string;
}

export interface CompletionContext {
  participants: readonly CompletionPerson[];
  roles: readonly CompletionRole[];
  /** The space's rooms; empty outside a space (no '#' completion then). */
  rooms: readonly CompletionRoom[];
  canMentionEveryone: boolean;
  currentUserId?: string | null;
  customEmojis: readonly CompletionEmoji[];
  emojiCatalog: EmojiCatalog | null;
  skinTone: number;
}

export type Candidate =
  | { kind: 'user'; key: string; label: string; sublabel: string; insertText: string; userId: string; avatar?: string; bot: boolean }
  | { kind: 'role'; key: string; label: string; sublabel: string; colorHex: string; insertText: string }
  | { kind: 'channel'; key: string; label: string; sublabel: string; insertText: string }
  | { kind: 'special'; key: string; label: string; sublabel: string; insertText: string }
  | { kind: 'emoji'; key: string; label: string; sublabel: string; insertText: string; unicode?: string; customUrl?: string };

export interface Completion {
  /** Index of the trigger character. */
  queryStart: number;
  /** The caret: the replaced range is [queryStart, cursorEnd). */
  cursorEnd: number;
  list: Candidate[];
}

export const MAX_COMPLETIONS = 12;
const MAX_CUSTOM_EMOJI = 6;
const MAX_UNICODE_EMOJI = 8;
const EVERYONE_ROLE_NAME = '@everyone';
const ROOM_TYPE_TEXT = 3;
const SPECIALS: { token: 'everyone' | 'here'; sublabelKey: string }[] = [
  { token: 'everyone', sublabelKey: 'composer.mentionEveryone' },
  { token: 'here', sublabelKey: 'composer.mentionHere' },
];

export function isWordChar(c: string | undefined): boolean {
  return c != null && /[\p{L}\p{N}_]/u.test(c);
}

/** The open completion for `draft` with the caret at `caret`, or null. */
export function computeCompletion(draft: string, caret: number, ctx: CompletionContext): Completion | null {
  const pos = Math.max(0, Math.min(caret, draft.length));
  const textBefore = draft.slice(0, pos);
  const atIndex = textBefore.lastIndexOf('@');
  const hashIndex = ctx.rooms.length ? textBefore.lastIndexOf('#') : -1;
  const colonIndex = textBefore.lastIndexOf(':');
  const triggerIndex = Math.max(atIndex, hashIndex, colonIndex);
  if (triggerIndex === -1) return null;
  const trigger = textBefore[triggerIndex]!;
  if (triggerIndex > 0 && isWordChar(textBefore[triggerIndex - 1])) return null;
  const query = textBefore.slice(triggerIndex + 1);
  if (/\s/.test(query)) return null;
  const q = query.toLowerCase();

  const candidates: Candidate[] = [];
  if (trigger === ':') {
    if (q.length < 2) return null;
    for (const c of ctx.customEmojis) {
      if (!c.name.toLowerCase().includes(q)) continue;
      candidates.push({
        kind: 'emoji',
        key: `custom:${c.id}`,
        label: `:${c.name}:`,
        sublabel: t('composer.customEmoji'),
        insertText: `:${c.name}: `,
        customUrl: c.url,
      });
      if (candidates.length >= MAX_CUSTOM_EMOJI) break;
    }
    if (ctx.emojiCatalog) {
      for (const e of searchEmoji(ctx.emojiCatalog, q, MAX_UNICODE_EMOJI)) {
        const unicode = withSkinTone(e, ctx.skinTone);
        candidates.push({ kind: 'emoji', key: `u:${e.hexcode}`, label: `:${e.shortcode}:`, sublabel: e.label, insertText: `${unicode} `, unicode });
      }
    }
  } else if (trigger === '#') {
    for (const r of ctx.rooms) {
      if (r.type !== ROOM_TYPE_TEXT || !r.name) continue;
      if (q !== '' && !r.name.toLowerCase().startsWith(q)) continue;
      candidates.push({ kind: 'channel', key: `channel:${r.id}`, label: r.name, sublabel: t('composer.room'), insertText: `#${r.name} ` });
    }
  } else {
    for (const p of ctx.participants) {
      const username = p.username ?? '';
      if (!username) continue;
      const view = resolveProfile(p, p);
      if (q !== '' && ![view.nick, p.display_name, username].some((n) => !!n && n.toLowerCase().startsWith(q))) continue;
      const isSelf = !!ctx.currentUserId && p.id === ctx.currentUserId;
      candidates.push({
        kind: 'user',
        key: `user:${p.id}`,
        label: view.name,
        sublabel: isSelf ? t('common.you') : `@${username}`,
        insertText: `@${username} `,
        userId: p.id,
        ...(view.avatar ? { avatar: view.avatar } : {}),
        bot: p.bot === true,
      });
    }
    for (const r of ctx.roles) {
      if (r.name === EVERYONE_ROLE_NAME || !r.mentionable) continue;
      if (q !== '' && !r.name.toLowerCase().startsWith(q)) continue;
      candidates.push({
        kind: 'role',
        key: `role:${r.id}`,
        label: r.name,
        sublabel: t('composer.role'),
        colorHex: spaceRoleColorHex(r.color),
        insertText: `@${r.name} `,
      });
    }
    if (ctx.canMentionEveryone) {
      for (const s of SPECIALS) {
        if (q !== '' && !s.token.startsWith(q)) continue;
        candidates.push({ kind: 'special', key: `special:${s.token}`, label: `@${s.token}`, sublabel: t(s.sublabelKey), insertText: `@${s.token} ` });
      }
    }
  }
  if (candidates.length === 0) return null;
  return { queryStart: triggerIndex, cursorEnd: pos, list: candidates.slice(0, MAX_COMPLETIONS) };
}

/** Replace [start, end) of `text` with `insert`; returns the new text and the caret after it. */
export function spliceText(text: string, start: number, end: number, insert: string): { text: string; caret: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  return { text: before + insert + after, caret: before.length + insert.length };
}
