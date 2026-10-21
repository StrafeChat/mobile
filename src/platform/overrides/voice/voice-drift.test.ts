/**
 * The voice overrides were written against specific versions of the web files (the voice
 * area of ../upstream.json). A web change to any of them must be ported by hand - stores/voice.ts
 * above all, which is a copy - so a submodule bump that changes one fails here. The checks
 * are ../check-drift.cjs's, which `npm run check:voice-drift` runs too.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { checkCoverage, checkHashes } from '../check-drift.cjs';

describe('voice overrides vs web sources', () => {
  for (const result of checkHashes('voice')) {
    it(`web/src/${result.rel} is the version the override was written against`, () => {
      if (!result.ok) throw new Error(`${result.message} (stores/voice.ts keeps its M1-M9 list)`);
      expect(result.ok).toBe(true);
    });
  }

  it('every voice override is pinned', () => {
    expect(checkCoverage('voice')).toEqual([]);
  });

  it('the voice store override still marks every mobile change', () => {
    const src = readFileSync(path.join(__dirname, 'stores/voice.ts'), 'utf8');
    for (const tag of ['M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8', 'M9']) {
      expect(src).toContain(`MOBILE (${tag})`);
    }
    // No DOM left in the copy's code (comments may still describe what was removed).
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/\bdocument\./);
    expect(code).not.toMatch(/\.attach\(/);
    expect(code).not.toMatch(/webAudioMix/);
  });
});
