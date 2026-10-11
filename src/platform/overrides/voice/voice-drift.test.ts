/**
 * The voice overrides were written against specific versions of the web files
 * (./upstream.json). A web change to any of them must be ported by hand - stores/voice.ts
 * above all, which is a copy - so a submodule bump that changes one fails here.
 */
import { describe, expect, it } from '@jest/globals';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const upstream = JSON.parse(readFileSync(path.join(__dirname, 'upstream.json'), 'utf8')) as { files: Record<string, string> };
const webSrc = path.resolve(__dirname, '../../../../web/src');

describe('voice overrides vs web sources', () => {
  for (const [rel, expected] of Object.entries(upstream.files)) {
    it(`web/src/${rel} is the version the override was written against`, () => {
      const actual = createHash('sha256').update(readFileSync(path.join(webSrc, rel))).digest('hex');
      if (actual !== expected) {
        throw new Error(
          `web/src/${rel} changed: port the change into src/platform/overrides/voice ` +
            '(stores/voice.ts keeps its M1-M9 list), then update upstream.json',
        );
      }
      expect(actual).toBe(expected);
    });
  }

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
