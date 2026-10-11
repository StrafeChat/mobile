/**
 * Mobile replacement for web/src/lib/codeHighlight.ts.
 *
 * Same rules as the web: a code block is highlighted only when its author named a language
 * (never guessed), with the same grammars and the same fence aliases. What differs is the
 * output. The web renders highlight.js's HTML through innerHTML (sanitised by DOMPurify, which
 * cannot run without a DOM); a native <Text> needs runs instead. So highlightCodeLines()
 * returns, per line, the token runs of the very spans the web would render - read back from
 * highlight.js's own output - each with its highlight.js scope and the colour role the web's
 * stylesheet (web/src/index.css, `.hljs-*`) gives it, cascade and inheritance included, so
 * a block is coloured alike on both clients.
 *
 * Token run shape (CodeToken):
 *
 *   {
 *     text: string;               // never contains '\n' - lines are split
 *     scope: string | null;       // innermost highlight.js scope: 'keyword', 'title.function',
 *                                 //   'string', 'meta.prompt'...; null for plain text
 *     role: CodeTokenRole | null; // the colour: 'comment' | 'keyword' | 'string' | 'number' |
 *                                 //   'literal' | 'title' | 'attr' | 'type' | 'muted' |
 *                                 //   'deletion' | 'addition'; null = the code foreground
 *     italic?: true; bold?: true; underline?: true;
 *   }
 *
 * The roles match the web's --code-* colours one to one (--code-keyword, --code-string...).
 *
 * The grammars are imported statically: Metro has no lazy chunks, so the web's per-language
 * dynamic import() would bundle all of them anyway. Each is registered on a private
 * highlight.js instance the first time a block in that language is highlighted, so start-up
 * pays only for module evaluation.
 */
import hljsCore from 'highlight.js/lib/core';
import type { HLJSApi, LanguageFn } from 'highlight.js';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import lua from 'highlight.js/lib/languages/lua';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/** The web's set, under the same names. */
const LANGUAGES: Record<string, LanguageFn> = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  graphql,
  ini,
  java,
  javascript,
  json,
  kotlin,
  lua,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  shell,
  sql,
  swift,
  typescript,
  xml, // also HTML, Vue, SVG
  yaml,
};

/** What people write after a fence, mapped to the grammar that handles it (the web's table). */
const ALIASES: Record<string, string> = {
  'c++': 'cpp', 'c#': 'csharp', cs: 'csharp', console: 'shell', dockerfile: 'dockerfile',
  golang: 'go', htm: 'xml', html: 'xml', js: 'javascript', jsx: 'javascript', kt: 'kotlin',
  md: 'markdown', mjs: 'javascript', patch: 'diff', pl: 'php', py: 'python', rb: 'ruby',
  rs: 'rust', sh: 'bash', shell: 'shell', svg: 'xml', toml: 'ini', ts: 'typescript',
  tsx: 'typescript', vue: 'xml', yml: 'yaml', zsh: 'bash',
};

export type CodeTokenRole =
  | 'comment'
  | 'keyword'
  | 'string'
  | 'number'
  | 'literal'
  | 'title'
  | 'attr'
  | 'type'
  | 'muted'
  | 'deletion'
  | 'addition';

export interface CodeToken {
  text: string;
  scope: string | null;
  role: CodeTokenRole | null;
  italic?: true;
  bold?: true;
  underline?: true;
}

/** One line of a block. Results are shared between renders and frozen: never mutate them. */
export type CodeLine = readonly CodeToken[];

export interface HighlightedLines {
  /** The grammar actually used, for the label on the block. */
  language: string;
  lines: readonly CodeLine[];
}

export interface HighlightedCode extends HighlightedLines {
  /**
   * highlight.js's HTML, kept so this module's result has the web's shape. Nothing on mobile
   * renders HTML; it is not run through a sanitiser (there is no DOM for one) and must never
   * be given to a WebView. Its text is escaped by highlight.js and its only markup is
   * `<span class>` from grammar scopes.
   */
  html: string;
}

// ---- engine ----------------------------------------------------------------------------------

let engine: HLJSApi | null = null;
const registered = new Set<string>();

function hljsFor(language: string): HLJSApi {
  // A private instance: registering grammars here never changes anyone else's highlight.js.
  engine ??= hljsCore.newInstance();
  if (!registered.has(language)) {
    engine.registerLanguage(language, LANGUAGES[language]!);
    registered.add(language);
  }
  return engine;
}

/** The grammar name for what was written after the fence, or '' when we do not carry it. */
export function canonicalCodeLanguage(raw: string): string {
  const name = raw.trim().toLowerCase();
  if (!name) return '';
  const resolved = ALIASES[name] ?? name;
  return Object.prototype.hasOwnProperty.call(LANGUAGES, resolved) ? resolved : '';
}

// ---- the web stylesheet, as data -------------------------------------------------------------

/** One element of highlight.js's output: `<span class="hljs-title function_">` is title.function. */
interface ScopeElement {
  /** First tier of the scope ('title'), or null for a sub-language container. */
  base: string | null;
  /** Further tiers ('function'), from the `x_` / `y__` classes. */
  tiers: string[];
}

interface ColourRule {
  base: string;
  /** The element must also carry this tier (`.hljs-title.function_`). */
  tier?: string;
  /** The element must sit inside one with this base (`.hljs-class .hljs-title`). */
  within?: string;
  role: CodeTokenRole;
}

/**
 * web/src/index.css's `.hljs-*` colour rules, in source order. Where two rules match the same
 * element the more specific wins, then the later one - as in CSS.
 */
const COLOUR_RULES: ColourRule[] = [
  { base: 'comment', role: 'comment' },
  { base: 'quote', role: 'comment' },
  { base: 'keyword', role: 'keyword' },
  { base: 'selector-tag', role: 'keyword' },
  { base: 'doctag', role: 'keyword' },
  { base: 'formula', role: 'keyword' },
  { base: 'string', role: 'string' },
  { base: 'regexp', role: 'string' },
  { base: 'string', within: 'meta', role: 'string' },
  { base: 'number', role: 'number' },
  { base: 'symbol', role: 'number' },
  { base: 'bullet', role: 'number' },
  { base: 'literal', role: 'literal' },
  { base: 'built_in', role: 'literal' },
  { base: 'variable', tier: 'language', role: 'literal' },
  { base: 'title', role: 'title' },
  { base: 'title', tier: 'class', role: 'title' },
  { base: 'title', tier: 'function', role: 'title' },
  { base: 'section', role: 'title' },
  { base: 'name', role: 'title' },
  { base: 'attr', role: 'attr' },
  { base: 'attribute', role: 'attr' },
  { base: 'variable', role: 'attr' },
  { base: 'template-variable', role: 'attr' },
  { base: 'property', role: 'attr' },
  { base: 'type', role: 'type' },
  { base: 'title', within: 'class', role: 'type' },
  { base: 'params', role: 'type' },
  { base: 'meta', role: 'muted' },
  { base: 'punctuation', role: 'muted' },
  { base: 'operator', role: 'muted' },
  { base: 'deletion', role: 'deletion' },
  { base: 'addition', role: 'addition' },
];

/** The element's own colour, or undefined to inherit its parent's. */
function ownRole(el: ScopeElement, ancestors: ScopeElement[]): CodeTokenRole | undefined {
  let best: { role: CodeTokenRole; specificity: number } | undefined;
  for (const rule of COLOUR_RULES) {
    if (rule.base !== el.base) continue;
    if (rule.tier && !el.tiers.includes(rule.tier)) continue;
    if (rule.within && !ancestors.some((a) => a.base === rule.within)) continue;
    const specificity = 1 + (rule.tier ? 1 : 0) + (rule.within ? 1 : 0);
    // >= : a later rule of equal specificity wins, as in CSS.
    if (!best || specificity >= best.specificity) best = { role: rule.role, specificity };
  }
  return best?.role;
}

interface Computed {
  scope: string | null;
  role: CodeTokenRole | null;
  italic: boolean;
  bold: boolean;
  underline: boolean;
}

const ROOT: Computed = { scope: null, role: null, italic: false, bold: false, underline: false };

function compute(parent: Computed, el: ScopeElement, ancestors: ScopeElement[]): Computed {
  if (el.base === null) return parent; // a sub-language container has no style of its own
  const base = el.base;
  return {
    scope: [base, ...el.tiers].join('.'),
    role: ownRole(el, ancestors) ?? parent.role,
    italic: parent.italic || base === 'comment' || base === 'quote' || base === 'emphasis',
    bold: parent.bold || base === 'strong',
    underline: parent.underline || base === 'link',
  };
}

// ---- reading highlight.js's output back ------------------------------------------------------

function elementFromClasses(classes: string): ScopeElement {
  const parts = classes.trim().split(/\s+/);
  const first = parts[0] ?? '';
  if (first.startsWith('language-')) return { base: null, tiers: [] };
  return {
    base: first.startsWith('hljs-') ? first.slice('hljs-'.length) : first,
    tiers: parts.slice(1).map((p) => p.replace(/_+$/, '')),
  };
}

function unescapeHtml(s: string): string {
  return s.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, e: string) =>
    e === 'amp' ? '&' : e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : "'",
  );
}

function sameStyle(a: CodeToken, b: Computed): boolean {
  return a.scope === b.scope && a.role === b.role && !!a.italic === b.italic && !!a.bold === b.bold && !!a.underline === b.underline;
}

/**
 * highlight.js HTML (escaped text, `<span class>` and `</span>` only) to lines of runs. Its
 * spans are what the web paints, so reading them back keeps the two clients' tokens the same.
 */
export function tokensFromHighlightHtml(html: string): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  const elements: ScopeElement[] = [];
  const styles: Computed[] = [ROOT];
  const re = /<span class="([^"]*)">|<\/span>|[^<]+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined) {
      const el = elementFromClasses(m[1]);
      styles.push(compute(styles[styles.length - 1]!, el, elements));
      elements.push(el);
      continue;
    }
    if (m[0] === '</span>') {
      if (elements.length > 0) {
        elements.pop();
        styles.pop();
      }
      continue;
    }
    const style = styles[styles.length - 1]!;
    const pieces = unescapeHtml(m[0]).split('\n');
    pieces.forEach((text, i) => {
      if (i > 0) lines.push([]);
      if (!text) return;
      const line = lines[lines.length - 1]!;
      const last = line[line.length - 1];
      if (last && sameStyle(last, style)) {
        last.text += text;
        return;
      }
      line.push({
        text,
        scope: style.scope,
        role: style.role,
        ...(style.italic ? { italic: true as const } : {}),
        ...(style.bold ? { bold: true as const } : {}),
        ...(style.underline ? { underline: true as const } : {}),
      });
    });
  }
  return lines;
}

// ---- public API ------------------------------------------------------------------------------

/** Cache keyed by language and source: the same message re-renders on every store change. */
const cache = new Map<string, { html: string; lines: readonly CodeLine[] }>();
const CACHE_MAX = 200;

function highlightCached(code: string, language: string): { html: string; lines: readonly CodeLine[] } | null {
  const key = language + '\n\u0001\n' + code;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const { value } = hljsFor(language).highlight(code, { language, ignoreIllegals: true });
    // Frozen: every render of the block shares these arrays.
    const lines: readonly CodeLine[] = Object.freeze(
      tokensFromHighlightHtml(value).map((line) => Object.freeze(line.map((tok) => Object.freeze(tok)))),
    );
    const entry = { html: value, lines };
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(key, entry);
    return entry;
  } catch {
    return null;
  }
}

/**
 * Token runs per line for a code block, or null when the language is not named or not carried
 * (or highlighting failed): render the code as plain monospace text then. Synchronous.
 */
export function highlightCodeLines(code: string, lang: string): HighlightedLines | null {
  const language = canonicalCodeLanguage(lang);
  if (!language || !code) return null;
  const hit = highlightCached(code, language);
  return hit ? { language, lines: hit.lines } : null;
}

/** The web's API, for anything shared that calls it: the same result, plus `lines`. */
export async function highlightCode(code: string, lang: string): Promise<HighlightedCode | null> {
  const language = canonicalCodeLanguage(lang);
  if (!language || !code) return null;
  const hit = highlightCached(code, language);
  return hit ? { language, html: hit.html, lines: hit.lines } : null;
}
