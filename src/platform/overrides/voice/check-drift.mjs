#!/usr/bin/env node
/**
 * Fails when a web voice module the mobile overrides replace has changed since the
 * override was written. stores/voice.ts is overridden by a copy (see its M1-M9 header), so
 * a web fix to it does not reach the app until someone ports it; this makes a submodule
 * bump say so instead of drifting silently. Hashes live in ./upstream.json.
 *
 * Run: node src/platform/overrides/voice/check-drift.mjs   (also run by voice-drift.test.ts)
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(here, '../../../../web/src');
const { files } = JSON.parse(readFileSync(path.join(here, 'upstream.json'), 'utf8'));

let drifted = 0;
for (const [rel, expected] of Object.entries(files)) {
  const actual = createHash('sha256').update(readFileSync(path.join(webSrc, rel))).digest('hex');
  if (actual !== expected) {
    drifted++;
    console.error(`web/src/${rel} changed since the mobile override was written (sha256 ${actual.slice(0, 12)}, expected ${expected.slice(0, 12)}).`);
  }
}
if (drifted) {
  console.error('Port the web change into src/platform/overrides/voice (see upstream.json), then update the hash.');
  process.exit(1);
}
console.log(`voice overrides in step with web (${Object.keys(files).length} files)`);
