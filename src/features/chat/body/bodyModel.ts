/**
 * The message body as the native renderer needs it: the web's parse tree (lib/utils/markdown,
 * unchanged, quirks included), cached, and cut into the runs React Native can lay out.
 *
 * On the web the tree renders as nested inline elements with a few block <div>s among them;
 * the browser flows it all. React Native flows text only inside one <Text>, so the top-level
 * nodes are grouped: consecutive inline nodes become one run (one <Text>, wrapping
 * naturally), and each block node - heading, subtext, quote, list item, code block - and each
 * link that carries an embed (invite card, inline media) becomes a block of its own, as the
 * web's block <div>s already break the line there.
 */
import { parseMessageContent, walkSegments, type MessageSegment } from '@web/lib/utils/markdown';
import { mediaKind, type MediaKind } from '@web/lib/gif/providers';
import { extractSpaceInviteCodeFromUrl } from '@web/lib/utils/spaceInviteLink';

export type LinkSegment = Extract<MessageSegment, { type: 'link' }>;

// ---- parse cache --------------------------------------------------------------------------------

const CACHE_MAX = 500;
const cache = new Map<string, readonly MessageSegment[]>();

/** parseMessageContent, memoised by text (rows are recycled and re-render often). */
export function parseBody(text: string): readonly MessageSegment[] {
  const hit = cache.get(text);
  if (hit) {
    // Refresh recency: Map keeps insertion order, so the oldest entry is first.
    cache.delete(text);
    cache.set(text, hit);
    return hit;
  }
  const parsed = parseMessageContent(text);
  cache.set(text, parsed);
  if (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return parsed;
}

// ---- whole-message shapes -------------------------------------------------------------------------

/** Discord's jumbo emoji: a message of only emoji (whitespace allowed), 1 to 10 of them. */
export const JUMBO_MAX = 10;

export function isJumbo(segments: readonly MessageSegment[]): boolean {
  let count = 0;
  for (const s of segments) {
    if (s.type === 'emoji' || s.type === 'customEmoji') count++;
    else if (s.type === 'text' && s.content.trim() === '') continue;
    else return false;
  }
  return count > 0 && count <= JUMBO_MAX;
}

/** A message whose only content is one unsuppressed GIF link renders as just the animation. */
export function loneGif(segments: readonly MessageSegment[]): string | null {
  let found: string | null = null;
  for (const s of segments) {
    if (s.type === 'link') {
      if (s.suppressed) return null;
      if (mediaKind(s.href) !== 'gif' || found) return null;
      found = s.href;
    } else if (s.type === 'text' && s.content.trim() === '') {
      continue;
    } else {
      return null;
    }
  }
  return found;
}

// ---- links ------------------------------------------------------------------------------------------

export type LinkEmbed = { kind: 'invite'; code: string } | { kind: 'media'; media: MediaKind };

/** What renders under a link: an invite card, inline media, or nothing. `<url>` suppresses both. */
export function linkEmbedOf(seg: LinkSegment): LinkEmbed | null {
  if (seg.suppressed) return null;
  const code = extractSpaceInviteCodeFromUrl(seg.href);
  if (code) return { kind: 'invite', code };
  const media = mediaKind(seg.href);
  return media ? { kind: 'media', media } : null;
}

// ---- runs and blocks --------------------------------------------------------------------------------

const BLOCK_TYPES = new Set<MessageSegment['type']>(['heading', 'subtext', 'quote', 'listItem', 'codeBlock']);

export function isBlockSegment(seg: MessageSegment): boolean {
  return BLOCK_TYPES.has(seg.type);
}

export type BodyBlock =
  /** Inline nodes laid out as one paragraph; `embeds` are the cards of links nested inside
   * styling (a top-level embed link is a block of its own), shown under the run. */
  | { kind: 'run'; nodes: MessageSegment[]; embeds: { href: string; embed: LinkEmbed }[] }
  | { kind: 'block'; node: MessageSegment }
  | { kind: 'embedLink'; node: LinkSegment; embed: LinkEmbed };

/** Strip one newline at the edge of a run that touches a block: the browser swallows it there,
 * a <Text> would show it as an empty line. */
function trimEdge(nodes: MessageSegment[], side: 'start' | 'end'): void {
  const i = side === 'start' ? 0 : nodes.length - 1;
  const n = nodes[i];
  if (!n || n.type !== 'text') return;
  const content = side === 'start' ? n.content.replace(/^\n/, '') : n.content.replace(/\n$/, '');
  if (content === '') nodes.splice(i, 1);
  else nodes[i] = { ...n, content };
}

function nestedEmbeds(nodes: readonly MessageSegment[]): { href: string; embed: LinkEmbed }[] {
  const out: { href: string; embed: LinkEmbed }[] = [];
  walkSegments(nodes as MessageSegment[], (s) => {
    if (s.type !== 'link') return;
    const embed = linkEmbedOf(s);
    if (embed) out.push({ href: s.href, embed });
  });
  return out;
}

/** Group a node list (the top level, or a quote's children) into runs and blocks. */
export function groupBlocks(nodes: readonly MessageSegment[]): BodyBlock[] {
  const out: BodyBlock[] = [];
  let run: MessageSegment[] = [];
  let afterBlock = false;
  const flush = (beforeBlock: boolean) => {
    if (run.length === 0) return;
    if (afterBlock) trimEdge(run, 'start');
    if (beforeBlock) trimEdge(run, 'end');
    if (run.length > 0) out.push({ kind: 'run', nodes: run, embeds: nestedEmbeds(run) });
    run = [];
  };
  for (const node of nodes) {
    if (isBlockSegment(node)) {
      flush(true);
      out.push({ kind: 'block', node });
      afterBlock = true;
      continue;
    }
    if (node.type === 'link') {
      const embed = linkEmbedOf(node);
      if (embed) {
        flush(true);
        out.push({ kind: 'embedLink', node, embed });
        afterBlock = true;
        continue;
      }
    }
    run.push(node);
  }
  flush(false);
  // A run that ended up only whitespace between two blocks adds nothing.
  return out.filter((b) => b.kind !== 'run' || b.nodes.some((n) => n.type !== 'text' || n.content.trim() !== ''));
}

/** Plain text of a subtree (a hidden spoiler is drawn as this, in the background colour). */
export function segmentsPlainText(nodes: readonly MessageSegment[]): string {
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text':
      case 'code':
        out += n.content;
        break;
      case 'link':
        out += n.text;
        break;
      case 'emoji':
        out += n.emoji;
        break;
      case 'customEmoji':
        out += `:${n.name}:`;
        break;
      case 'everyone':
        out += n.text;
        break;
      case 'mention':
        out += '@user';
        break;
      case 'roleMention':
        out += '@role';
        break;
      case 'channelMention':
        out += '#room';
        break;
      case 'timestamp':
        out += '00:00';
        break;
      case 'codeBlock':
        out += n.content;
        break;
      default:
        if ('children' in n) out += segmentsPlainText(n.children);
    }
  }
  return out;
}

/** Last path segment of a URL (a name for the viewer and the player). */
export function mediaFilename(href: string): string {
  try {
    const name = new URL(href).pathname.split('/').pop();
    return name ? decodeURIComponent(name) : href;
  } catch {
    return href;
  }
}
