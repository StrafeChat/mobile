/**
 * Mobile replacement for web/src/lib/profileRichText.ts - the profile bio, for native rendering.
 *
 * The web renders a bio (Markdown plus limited HTML) with marked, sanitises the HTML with
 * DOMPurify and sets it as innerHTML. There is no DOM here and nothing renders HTML, so
 * parseBio() turns the same Markdown, lexed by the same marked with the same options (GFM,
 * single newlines are line breaks), into a node tree a renderer maps to <Text> and <View>.
 * It keeps what the web's sanitiser keeps and drops what it drops:
 *
 * - images are dropped, as the web forbids <img> - an image in a bio is a tracking pixel that
 *   would report every viewer's IP address to its author;
 * - links keep only http(s) and mailto targets (a relative one resolves against the instance);
 *   anything else (javascript:...) is plain text, as DOMPurify strips the href;
 * - HTML is understood for the text-level tags (b/strong, i/em, u/ins, s/del/strike,
 *   code/kbd, a, br); block tags become line breaks, other tags vanish but keep their text,
 *   and script/style-like elements vanish with their content. Markdown inside an HTML block
 *   stays literal, as marked leaves it.
 *
 * Node shapes:
 *
 *   BioDocument = BioBlock[]
 *   BioBlock =
 *     | { type: 'paragraph'; children: BioInline[] }
 *     | { type: 'heading'; depth: 1..6; children: BioInline[] }
 *     | { type: 'blockquote'; children: BioBlock[] }
 *     | { type: 'list'; ordered: boolean; start: number; items: { checked: boolean | null;
 *                                                                children: BioBlock[] }[] }
 *         // checked: null = plain item, true/false = GFM task item
 *     | { type: 'code'; lang: string; text: string }   // a fenced/indented block, verbatim
 *     | { type: 'hr' }
 *     | { type: 'table'; align: ('left'|'center'|'right'|null)[];
 *         header: BioInline[][]; rows: BioInline[][][] }  // cells are inline runs
 *   BioInline =
 *     | { type: 'text'; text: string }                  // entities already decoded
 *     | { type: 'br' }
 *     | { type: 'strong' | 'em' | 'del' | 'u' | 'code'; children: BioInline[] }
 *     | { type: 'link'; href: string; children: BioInline[] } // open via externalLink
 *
 * The web's export name is kept (markdownAndHtmlToSanitizedBioHtml) for anything shared that
 * calls it; on mobile it returns the bio as HTML-escaped plain text. Mobile UI uses parseBio(),
 * imported from this file (TypeScript resolves `@web/lib/profileRichText` to the web original).
 */
import { Lexer, type Token, type Tokens } from 'marked';

export type BioInline =
  | { type: 'text'; text: string }
  | { type: 'br' }
  | { type: 'strong' | 'em' | 'del' | 'u' | 'code'; children: BioInline[] }
  | { type: 'link'; href: string; children: BioInline[] };

export type BioTableAlign = 'left' | 'center' | 'right' | null;

export interface BioListItem {
  checked: boolean | null;
  children: BioBlock[];
}

export type BioBlock =
  | { type: 'paragraph'; children: BioInline[] }
  | { type: 'heading'; depth: 1 | 2 | 3 | 4 | 5 | 6; children: BioInline[] }
  | { type: 'blockquote'; children: BioBlock[] }
  | { type: 'list'; ordered: boolean; start: number; items: BioListItem[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'hr' }
  | { type: 'table'; align: BioTableAlign[]; header: BioInline[][]; rows: BioInline[][][] };

export type BioDocument = BioBlock[];

/** The web's marked options (marked.setOptions in the original). */
const LEX_OPTIONS = { gfm: true, breaks: true } as const;

// ---- text --------------------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Character references in Markdown text, which the browser would have resolved. */
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, ref: string) => {
    if (ref[0] === '#') {
      const code = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? whole;
  });
}

function htmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** http(s) and mailto only; a relative link resolves against the instance's origin. */
function safeHref(raw: string): string | null {
  const href = decodeEntities(raw.trim());
  if (/^mailto:/i.test(href)) return href;
  try {
    const origin = (globalThis as { location?: { origin?: string } }).location?.origin;
    const u = origin ? new URL(href, origin) : new URL(href);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---- inline HTML -------------------------------------------------------------------------------

type MarkType = 'strong' | 'em' | 'del' | 'u' | 'code';

const MARK_TAGS: Record<string, MarkType> = {
  b: 'strong',
  strong: 'strong',
  i: 'em',
  em: 'em',
  cite: 'em',
  u: 'u',
  ins: 'u',
  s: 'del',
  del: 'del',
  strike: 'del',
  code: 'code',
  kbd: 'code',
  samp: 'code',
  tt: 'code',
};

/** Elements the sanitiser removes together with their content (DOMPurify's FORBID_CONTENTS). */
const DROP_WITH_CONTENT = new Set([
  'script', 'style', 'template', 'title', 'textarea', 'noscript', 'iframe', 'noembed', 'noframes',
  'plaintext', 'xmp', 'svg', 'math', 'audio', 'video', 'select', 'option', 'object', 'head',
]);

/** Block-level tags: on the web they start a new line. */
const BLOCK_TAGS = new Set([
  'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'dl', 'dt', 'dd', 'blockquote',
  'pre', 'section', 'article', 'aside', 'header', 'footer', 'nav', 'main', 'figure', 'figcaption',
  'table', 'tr', 'hr', 'details', 'summary', 'center', 'address',
]);

interface ParsedTag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: string;
}

function parseTag(raw: string): ParsedTag | null {
  const m = /^<\s*(\/)?\s*([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/)?\s*>$/.exec(raw.trim());
  if (!m) return null;
  return { name: m[2]!.toLowerCase(), closing: !!m[1], selfClosing: !!m[4] || m[2]!.toLowerCase() === 'br', attrs: m[3] ?? '' };
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : null;
}

// ---- inline conversion -------------------------------------------------------------------------

interface Frame {
  /** The HTML tag that opened this frame; null for the token list's own root. */
  tag: string | null;
  children: BioInline[];
}

interface InlineContext {
  /** Text from an HTML block: whitespace collapses, as it does in HTML. */
  collapseWhitespace: boolean;
}

function pushBreak(children: BioInline[]): void {
  const last = children[children.length - 1];
  if (children.length > 0 && last?.type !== 'br') children.push({ type: 'br' });
}

function pushText(children: BioInline[], text: string): void {
  if (!text) return;
  const last = children[children.length - 1];
  if (last?.type === 'text') last.text += text;
  else children.push({ type: 'text', text });
}

/** Append a node, merging adjacent text so a run of text is one node. */
function append(children: BioInline[], node: BioInline): void {
  if (node.type === 'text') pushText(children, node.text);
  else children.push(node);
}

function inlineFrom(tokens: Token[] | undefined, ctx: InlineContext): BioInline[] {
  const root: Frame = { tag: null, children: [] };
  const stack: Frame[] = [root];
  let dropDepth = 0;
  const top = () => stack[stack.length - 1]!.children;

  const openContainer = (tag: string, node: BioInline & { children: BioInline[] }) => {
    top().push(node);
    stack.push({ tag, children: node.children });
  };

  for (const token of tokens ?? []) {
    if (token.type === 'html') {
      const html = (token as Tokens.Tag).text;
      if (/^<!--/.test(html.trim())) continue;
      const tag = parseTag(html);
      if (!tag) continue;
      if (DROP_WITH_CONTENT.has(tag.name)) {
        if (!tag.selfClosing) dropDepth = Math.max(0, dropDepth + (tag.closing ? -1 : 1));
        continue;
      }
      if (dropDepth > 0) continue;
      if (tag.name === 'br') {
        top().push({ type: 'br' });
        continue;
      }
      if (BLOCK_TAGS.has(tag.name)) {
        pushBreak(top());
        continue;
      }
      if (tag.closing) {
        // Close back to the matching opener, if there is one; a stray closer is ignored.
        const at = stack.map((f) => f.tag).lastIndexOf(tag.name);
        if (at > 0) stack.length = at;
        continue;
      }
      if (tag.selfClosing) continue;
      const mark = MARK_TAGS[tag.name];
      if (mark) {
        openContainer(tag.name, { type: mark, children: [] });
      } else if (tag.name === 'a') {
        const href = safeHref(attr(tag.attrs, 'href') ?? '');
        if (href) openContainer('a', { type: 'link', href, children: [] });
        else stack.push({ tag: 'a', children: top() }); // a link without a usable target: just its text
      } else {
        stack.push({ tag: tag.name, children: top() }); // span, small, sup...: transparent
      }
      continue;
    }
    if (dropDepth > 0) continue;

    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text;
        if (t.tokens?.length) {
          for (const child of inlineFrom(t.tokens, ctx)) append(top(), child);
        } else {
          // Escaped or not, the browser would have resolved its character references.
          const text = decodeEntities(t.text);
          pushText(top(), ctx.collapseWhitespace ? text.replace(/\s+/g, ' ') : text);
        }
        break;
      }
      case 'escape':
        pushText(top(), decodeEntities((token as Tokens.Escape).text));
        break;
      case 'codespan':
        top().push({ type: 'code', children: [{ type: 'text', text: (token as Tokens.Codespan).text }] });
        break;
      case 'br':
        top().push({ type: 'br' });
        break;
      case 'strong':
      case 'em':
      case 'del': {
        const t = token as Tokens.Strong | Tokens.Em | Tokens.Del;
        top().push({ type: t.type, children: inlineFrom(t.tokens, ctx) });
        break;
      }
      case 'link': {
        const t = token as Tokens.Link;
        // Autolinks are literal: their text is not entity-decoded.
        const children = t.autolink ? [{ type: 'text' as const, text: t.text }] : inlineFrom(t.tokens, ctx);
        const href = safeHref(t.href);
        if (href) top().push({ type: 'link', href, children });
        else for (const child of children) append(top(), child);
        break;
      }
      case 'image':
        // Dropped, as on the web: a bio image is a tracking pixel.
        break;
      default: {
        const generic = token as Tokens.Generic;
        if (Array.isArray(generic.tokens)) for (const child of inlineFrom(generic.tokens, ctx)) append(top(), child);
        else if (typeof generic.text === 'string') pushText(top(), decodeEntities(generic.text));
      }
    }
  }
  return prune(root.children);
}

/**
 * Drop empty containers, whitespace that touches a line break (a renderer would draw it at
 * the start or end of a line), and leading/trailing line breaks.
 */
function prune(nodes: BioInline[]): BioInline[] {
  const out: BioInline[] = [];
  for (const n of nodes) {
    if ('children' in n) {
      const children = prune(n.children);
      if (children.length > 0) out.push({ ...n, children });
    } else {
      out.push(n);
    }
  }
  for (let i = 0; i < out.length; i++) {
    const n = out[i]!;
    if (n.type !== 'text') continue;
    let text = n.text;
    if (out[i - 1]?.type === 'br') text = text.replace(/^[ \t]+/, '');
    if (out[i + 1]?.type === 'br') text = text.replace(/[ \t]+$/, '');
    if (text !== n.text) out[i] = { type: 'text', text };
  }
  const kept = out.filter((n) => n.type !== 'text' || n.text !== '');
  while (kept[0]?.type === 'br') kept.shift();
  while (kept[kept.length - 1]?.type === 'br') kept.pop();
  return kept;
}

// ---- blocks ------------------------------------------------------------------------------------

const MARKDOWN: InlineContext = { collapseWhitespace: false };
const HTML_BLOCK: InlineContext = { collapseWhitespace: true };

/** A paragraph of `children`, without whitespace at its start and end; null when empty. */
function paragraph(children: BioInline[]): BioBlock | null {
  const out = [...children];
  const first = out[0];
  if (first?.type === 'text') out[0] = { type: 'text', text: first.text.replace(/^\s+/, '') };
  const last = out[out.length - 1];
  if (last?.type === 'text') out[out.length - 1] = { type: 'text', text: last.text.replace(/\s+$/, '') };
  const kept = out.filter((n) => n.type !== 'text' || n.text !== '');
  return kept.length ? { type: 'paragraph', children: kept } : null;
}

/**
 * An HTML block. marked passes it through untouched - no Markdown inside it is processed - so
 * it is split into tags and literal text here, and read by the same inline rules as inline
 * HTML (tags understood or dropped, script-like content removed, whitespace collapsed).
 */
function htmlBlock(raw: string): BioBlock | null {
  const tokens: Token[] = [];
  const re = /<!--[\s\S]*?(?:-->|$)|<\/?[a-zA-Z][^>]*>|[^<]+|</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const piece = m[0];
    if (piece.startsWith('<!--')) continue;
    if (/^<\/?[a-zA-Z]/.test(piece)) tokens.push({ type: 'html', raw: piece, text: piece, block: false, inLink: false, inRawBlock: false });
    else tokens.push({ type: 'text', raw: piece, text: piece });
  }
  return paragraph(inlineFrom(tokens, HTML_BLOCK));
}

function blocksFrom(tokens: Token[] | undefined): BioBlock[] {
  const out: BioBlock[] = [];
  const push = (b: BioBlock | null) => {
    if (b) out.push(b);
  };
  for (const token of tokens ?? []) {
    switch (token.type) {
      case 'paragraph':
        push(paragraph(inlineFrom((token as Tokens.Paragraph).tokens, MARKDOWN)));
        break;
      case 'text': {
        // Loose text at block level (the content of a tight list item).
        const t = token as Tokens.Text;
        push(paragraph(t.tokens?.length ? inlineFrom(t.tokens, MARKDOWN) : [{ type: 'text', text: decodeEntities(t.text) }]));
        break;
      }
      case 'heading': {
        const t = token as Tokens.Heading;
        const children = inlineFrom(t.tokens, MARKDOWN);
        if (children.length) out.push({ type: 'heading', depth: Math.min(6, Math.max(1, t.depth)) as 1 | 2 | 3 | 4 | 5 | 6, children });
        break;
      }
      case 'blockquote': {
        const children = blocksFrom((token as Tokens.Blockquote).tokens);
        if (children.length) out.push({ type: 'blockquote', children });
        break;
      }
      case 'list': {
        const t = token as Tokens.List;
        const items: BioListItem[] = t.items.map((item) => ({
          checked: item.task ? !!item.checked : null,
          children: blocksFrom(item.tokens.filter((x) => x.type !== 'checkbox')),
        }));
        if (items.length) out.push({ type: 'list', ordered: t.ordered, start: typeof t.start === 'number' ? t.start : 1, items });
        break;
      }
      case 'code': {
        const t = token as Tokens.Code;
        out.push({ type: 'code', lang: (t.lang ?? '').trim(), text: t.text });
        break;
      }
      case 'hr':
        out.push({ type: 'hr' });
        break;
      case 'table': {
        const t = token as Tokens.Table;
        out.push({
          type: 'table',
          align: t.align,
          header: t.header.map((cell) => inlineFrom(cell.tokens, MARKDOWN)),
          rows: t.rows.map((row) => row.map((cell) => inlineFrom(cell.tokens, MARKDOWN))),
        });
        break;
      }
      case 'html':
        push(htmlBlock((token as Tokens.HTML).text));
        break;
      default:
        // space, def: nothing to show.
        break;
    }
  }
  return out;
}

// ---- public API --------------------------------------------------------------------------------

/** The bio as a node tree for native rendering (shapes above). Empty bio: []. */
export function parseBio(src: string): BioDocument {
  const text = src.trim();
  if (!text) return [];
  try {
    return blocksFrom(new Lexer(LEX_OPTIONS).lex(text));
  } catch {
    // marked never throws on input it was given as text, but a bio is not worth a crash.
    return [{ type: 'paragraph', children: [{ type: 'text', text }] }];
  }
}

function inlinePlain(nodes: BioInline[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.text : n.type === 'br' ? '\n' : inlinePlain(n.children))).join('');
}

/** The bio's text without formatting, blocks separated by blank lines (previews, a11y labels). */
export function bioPlainText(doc: BioDocument): string {
  const block = (b: BioBlock): string => {
    switch (b.type) {
      case 'paragraph':
      case 'heading':
        return inlinePlain(b.children);
      case 'blockquote':
        return b.children.map(block).join('\n');
      case 'list':
        return b.items.map((item) => item.children.map(block).join('\n')).join('\n');
      case 'code':
        return b.text;
      case 'hr':
        return '';
      case 'table':
        return [b.header, ...b.rows].map((row) => row.map(inlinePlain).join('\t')).join('\n');
    }
  };
  return doc.map(block).filter(Boolean).join('\n\n');
}

/**
 * The web's export, for anything shared that calls it. Nothing on mobile renders HTML, so
 * this is the bio's plain text, HTML-escaped - still safe wherever HTML is expected. Render
 * bios with parseBio().
 */
export function markdownAndHtmlToSanitizedBioHtml(src: string): string {
  return htmlEscape(bioPlainText(parseBio(src)));
}
