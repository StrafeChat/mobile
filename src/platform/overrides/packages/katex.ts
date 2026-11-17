/**
 * Stand-in for `katex` on mobile.
 *
 * The web parses math in messages (lib/latex, reached through lib/utils/markdown, which the
 * app reuses as-is) and renders it with KaTeX, loaded on demand through `import('katex')`.
 * KaTeX renders to HTML for the DOM; the app has no DOM and draws a formula natively as its
 * TeX source (src/features/chat/body: the `latex` and `latexDocument` pieces), so the package
 * is not installed. Metro resolves every `import()` at bundle time. Today an unresolvable
 * `import('katex')` happens to bundle anyway - Expo turns on allowOptionalDependencies and the
 * web chains a .catch() onto it, so Metro writes a null module that rejects when loaded - but
 * that rests on the shape of the web's code (an `await import()` without try/catch would fail
 * the bundle), and a checkout with web/node_modules installed would bundle the real KaTeX,
 * unused. Hence the specifier is pinned here.
 *
 * Nothing in the app calls lib/latex's loadKatex() or renderLatex(); if
 * something ever does, the web's code still takes a clean path: renderToString never throws
 * and returns the very fallback the web's LatexMath shows while KaTeX is loading - the source,
 * escaped, in `<code class="latex-source">` - so renderLatex() yields that markup and no error.
 */

/** The subset of KaTeX's options lib/latex passes that this stand-in reads. */
export interface KatexOptions {
  displayMode?: boolean;
  [option: string]: unknown;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function renderToString(tex: string, options?: KatexOptions): string {
  const cls = options?.displayMode ? 'latex-source latex-block' : 'latex-source';
  return `<code class="${cls}">${escapeHtml(String(tex))}</code>`;
}

/** Not KaTeX: lets a caller tell the stand-in from the real renderer. */
export const version = 'mobile-source-fallback';

const katex = { renderToString, version };
export default katex;
