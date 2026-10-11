import { describe, expect, it } from '@jest/globals';
import { bioPlainText, markdownAndHtmlToSanitizedBioHtml, parseBio, type BioBlock } from './profileRichText';

const para = (doc: BioBlock[], i = 0) => {
  const b = doc[i];
  if (b?.type !== 'paragraph') throw new Error(`block ${i} is ${b?.type}`);
  return b.children;
};

describe('parseBio', () => {
  it('is empty for an empty bio', () => {
    expect(parseBio('   ')).toEqual([]);
  });

  it('reads Markdown inline formatting, with single newlines as breaks', () => {
    expect(para(parseBio('Hi **bold** _it_ ~~gone~~ `a<b`\nnext & more'))).toEqual([
      { type: 'text', text: 'Hi ' },
      { type: 'strong', children: [{ type: 'text', text: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'it' }] },
      { type: 'text', text: ' ' },
      { type: 'del', children: [{ type: 'text', text: 'gone' }] },
      { type: 'text', text: ' ' },
      { type: 'code', children: [{ type: 'text', text: 'a<b' }] },
      { type: 'br' },
      { type: 'text', text: 'next & more' },
    ]);
  });

  it('decodes character references in text but not in code', () => {
    const doc = parseBio('a &amp; b &lt;3 &#x1F600; `&amp;`');
    expect(para(doc)).toEqual([
      { type: 'text', text: 'a & b <3 \u{1F600} ' },
      { type: 'code', children: [{ type: 'text', text: '&amp;' }] },
    ]);
  });

  it('keeps http(s) and mailto links and turns any other target into text', () => {
    const doc = parseBio('[ok](https://ok.example "t") [bad](javascript:alert(1)) [mail](mailto:a@b.c) https://auto.example');
    expect(para(doc)).toEqual([
      { type: 'link', href: 'https://ok.example/', children: [{ type: 'text', text: 'ok' }] },
      { type: 'text', text: ' bad ' },
      { type: 'link', href: 'mailto:a@b.c', children: [{ type: 'text', text: 'mail' }] },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://auto.example/', children: [{ type: 'text', text: 'https://auto.example' }] },
    ]);
  });

  it('drops images, as the web sanitiser does', () => {
    expect(para(parseBio('before ![pixel](https://tracker.example/p.png) after'))).toEqual([{ type: 'text', text: 'before  after' }]);
  });

  it('understands the text-level HTML tags and drops script content', () => {
    const doc = parseBio('<b>bold</b> <u>under</u> <a href="https://a.example">x</a><br>y <span>kept</span><script>alert(1)</script>');
    expect(para(doc)).toEqual([
      { type: 'strong', children: [{ type: 'text', text: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'u', children: [{ type: 'text', text: 'under' }] },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://a.example/', children: [{ type: 'text', text: 'x' }] },
      { type: 'br' },
      { type: 'text', text: 'y kept' },
    ]);
  });

  it('turns an HTML block into a paragraph with line breaks and collapsed whitespace', () => {
    const doc = parseBio('<div>first   line\n<p>second <i>it</i></p><style>p{}</style></div>');
    expect(doc).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'text', text: 'first line' },
          { type: 'br' },
          { type: 'text', text: 'second ' },
          { type: 'em', children: [{ type: 'text', text: 'it' }] },
        ],
      },
    ]);
  });

  it('leaves Markdown inside an HTML block literal, as marked does', () => {
    expect(para(parseBio('<div>**not bold** &amp; <b>bold</b></div>'))).toEqual([
      { type: 'text', text: '**not bold** & ' },
      { type: 'strong', children: [{ type: 'text', text: 'bold' }] },
    ]);
  });

  it('builds headings, quotes, lists with tasks, code, rules and tables', () => {
    const doc = parseBio('# Me\n> quoted\n\n- [x] done\n- plain\n\n3. three\n\n```js\nlet x;\n```\n\n---\n\n| a | b |\n|:-|-:|\n| 1 | **2** |');
    expect(doc.map((b) => b.type)).toEqual(['heading', 'blockquote', 'list', 'list', 'code', 'hr', 'table']);
    expect(doc[0]).toEqual({ type: 'heading', depth: 1, children: [{ type: 'text', text: 'Me' }] });
    expect(doc[1]).toEqual({ type: 'blockquote', children: [{ type: 'paragraph', children: [{ type: 'text', text: 'quoted' }] }] });
    expect(doc[2]).toEqual({
      type: 'list',
      ordered: false,
      start: 1,
      items: [
        { checked: true, children: [{ type: 'paragraph', children: [{ type: 'text', text: 'done' }] }] },
        { checked: null, children: [{ type: 'paragraph', children: [{ type: 'text', text: 'plain' }] }] },
      ],
    });
    expect(doc[3]).toMatchObject({ type: 'list', ordered: true, start: 3 });
    expect(doc[4]).toEqual({ type: 'code', lang: 'js', text: 'let x;' });
    expect(doc[6]).toEqual({
      type: 'table',
      align: ['left', 'right'],
      header: [[{ type: 'text', text: 'a' }], [{ type: 'text', text: 'b' }]],
      rows: [[[{ type: 'text', text: '1' }], [{ type: 'strong', children: [{ type: 'text', text: '2' }] }]]],
    });
  });
});

describe('plain text', () => {
  it('flattens the tree, blocks separated by blank lines', () => {
    expect(bioPlainText(parseBio('**Hi** there\nline two\n\n- a\n- b'))).toBe('Hi there\nline two\n\na\nb');
  });

  it('keeps the web export safe wherever HTML is expected', () => {
    expect(markdownAndHtmlToSanitizedBioHtml('<b>x</b> & "y" <script>z</script>')).toBe('x &amp; &quot;y&quot;');
  });
});
