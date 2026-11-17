/**
 * `katex` on mobile: the web's lib/latex loads it with import('katex'); the app has no KaTeX
 * and that specifier resolves to the stand-in (Metro and jest/resolver.js both read the
 * manifest), which leaves the web's code on a clean path: renderLatex() gets the formula's
 * source in the web's own fallback markup, never an error.
 *
 * jest cannot run the web's import() itself (no --experimental-vm-modules), so the bare
 * specifier is required here instead; the real bundle is checked by `expo export`.
 */
import { describe, expect, test } from '@jest/globals';
import * as stub from '../katex';

const { PACKAGE_OVERRIDES } = require('../../manifest') as { PACKAGE_OVERRIDES: Record<string, string> };

describe('katex stand-in', () => {
  test('the manifest sends katex to the stand-in, and the bare specifier resolves to it', () => {
    expect(PACKAGE_OVERRIDES.katex).toBe('src/platform/overrides/packages/katex.ts');
    const katex = require('katex') as typeof stub;
    expect(katex.version).toBe('mobile-source-fallback');
    // lib/latex reads `mod.default ?? mod`.
    expect(katex.default.renderToString).toBe(stub.renderToString);
  });

  test('renderToString gives the escaped source in the web\'s fallback markup and never throws', () => {
    // lib/latex calls it with throwOnError first, then without; both must return.
    expect(stub.renderToString('a<b & \\frac{1}{2}', { displayMode: false, throwOnError: true })).toBe(
      '<code class="latex-source">a&#60;b &#38; \\frac{1}{2}</code>',
    );
    expect(stub.renderToString('"x" \'y\'', { displayMode: true, throwOnError: false })).toBe(
      '<code class="latex-source latex-block">&#34;x&#34; &#39;y&#39;</code>',
    );
    expect(stub.renderToString('\\left(', { throwOnError: true })).toBe('<code class="latex-source">\\left(</code>');
  });
});
