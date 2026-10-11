import { describe, expect, it } from '@jest/globals';
import {
  canonicalCodeLanguage,
  highlightCode,
  highlightCodeLines,
  tokensFromHighlightHtml,
  type CodeLine,
} from './codeHighlight';

/** The line as text, to check nothing was lost or reordered. */
const lineText = (line: CodeLine) => line.map((t) => t.text).join('');

describe('canonicalCodeLanguage', () => {
  it('maps the web aliases and refuses what it does not carry', () => {
    expect(canonicalCodeLanguage('ts')).toBe('typescript');
    expect(canonicalCodeLanguage(' JS ')).toBe('javascript');
    expect(canonicalCodeLanguage('c++')).toBe('cpp');
    expect(canonicalCodeLanguage('html')).toBe('xml');
    expect(canonicalCodeLanguage('toml')).toBe('ini');
    expect(canonicalCodeLanguage('rust')).toBe('rust');
    expect(canonicalCodeLanguage('cobol')).toBe('');
    expect(canonicalCodeLanguage('')).toBe('');
    // Not a key of the table's prototype either.
    expect(canonicalCodeLanguage('constructor')).toBe('');
  });
});

describe('highlightCodeLines', () => {
  it('returns null unless a carried language was named', () => {
    expect(highlightCodeLines('let x = 1', '')).toBeNull();
    expect(highlightCodeLines('let x = 1', 'brainfuck')).toBeNull();
    expect(highlightCodeLines('', 'js')).toBeNull();
  });

  it('splits into lines of runs without losing text', () => {
    const src = 'const a = "hi"; // note\n\nfunction f(x) {\n  return 42;\n}';
    const out = highlightCodeLines(src, 'js')!;
    expect(out.language).toBe('javascript');
    expect(out.lines.map(lineText)).toEqual(src.split('\n'));
    expect(out.lines[1]).toEqual([]);
    for (const line of out.lines) for (const tok of line) expect(tok.text).not.toContain('\n');
  });

  it('gives each run its scope and the web stylesheet role', () => {
    const { lines } = highlightCodeLines('const a = "hi"; // note', 'javascript')!;
    const find = (text: string) => lines[0]!.find((t) => t.text === text);
    expect(find('const')).toMatchObject({ scope: 'keyword', role: 'keyword' });
    expect(find('"hi"')).toMatchObject({ scope: 'string', role: 'string' });
    expect(find('// note')).toMatchObject({ scope: 'comment', role: 'comment', italic: true });
    // Plain text between tokens carries no scope and the foreground colour.
    expect(lines[0]!.find((t) => t.text.includes('a ='))).toMatchObject({ scope: null, role: null });
  });

  it('applies tiered scopes and the more specific rule, as the CSS does', () => {
    const { lines } = highlightCodeLines('function greet(name) { return this; }', 'js')!;
    const greet = lines[0]!.find((t) => t.text === 'greet');
    expect(greet).toMatchObject({ scope: 'title.function', role: 'title' });
    // .hljs-variable.language_ beats .hljs-variable: literal, not attr.
    expect(lines[0]!.find((t) => t.text === 'this')).toMatchObject({ scope: 'variable.language', role: 'literal' });
    // .hljs-params is a type colour.
    expect(lines[0]!.find((t) => t.text === 'name')).toMatchObject({ role: 'type' });
  });

  it('unescapes what highlight.js escaped', () => {
    const { lines } = highlightCodeLines('if (a < b && c > "d") {}', 'js')!;
    expect(lineText(lines[0]!)).toBe('if (a < b && c > "d") {}');
  });

  it('caches and freezes the result', () => {
    const a = highlightCodeLines('x = 1', 'python')!;
    const b = highlightCodeLines('x = 1', 'py')!;
    expect(b.lines).toBe(a.lines);
    expect(Object.isFrozen(a.lines)).toBe(true);
    expect(Object.isFrozen(a.lines[0])).toBe(true);
  });

  it('marks diff additions and deletions', () => {
    const { lines } = highlightCodeLines('+added\n-removed', 'diff')!;
    expect(lines[0]![0]).toMatchObject({ role: 'addition', text: '+added' });
    expect(lines[1]![0]).toMatchObject({ role: 'deletion', text: '-removed' });
  });
});

describe('tokensFromHighlightHtml', () => {
  it('inherits the parent colour into unstyled nested spans and resolves descendant rules', () => {
    const html =
      '<span class="hljs-string">&quot;a<span class="hljs-subst">${x}</span>&quot;</span>' +
      '<span class="hljs-class"> <span class="hljs-title">Foo</span></span>' +
      '<span class="hljs-meta">#!<span class="hljs-string">sh</span></span>';
    const [line] = tokensFromHighlightHtml(html);
    expect(line).toEqual([
      { text: '"a', scope: 'string', role: 'string' },
      // .hljs-subst has no rule: the string colour carries through.
      { text: '${x}', scope: 'subst', role: 'string' },
      { text: '"', scope: 'string', role: 'string' },
      { text: ' ', scope: 'class', role: null },
      // .hljs-class .hljs-title is a type colour.
      { text: 'Foo', scope: 'title', role: 'type' },
      { text: '#!', scope: 'meta', role: 'muted' },
      { text: 'sh', scope: 'string', role: 'string' },
    ]);
  });

  it('treats a sub-language container as transparent', () => {
    const [line] = tokensFromHighlightHtml('<span class="language-css"><span class="hljs-attribute">color</span>: red</span>');
    expect(line).toEqual([
      { text: 'color', scope: 'attribute', role: 'attr' },
      { text: ': red', scope: null, role: null },
    ]);
  });
});

describe('highlightCode (web-compatible)', () => {
  it('resolves the web shape plus lines', async () => {
    const res = await highlightCode('SELECT 1', 'sql');
    expect(res?.language).toBe('sql');
    expect(res?.html).toContain('<span class="hljs-keyword">SELECT</span>');
    expect(res?.lines[0]?.[0]).toMatchObject({ text: 'SELECT', role: 'keyword' });
    await expect(highlightCode('x', 'nope')).resolves.toBeNull();
  });
});
