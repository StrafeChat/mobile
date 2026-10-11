#!/usr/bin/env node
/**
 * TypeScript over the app, failing only on errors in mobile code.
 *
 * tsc follows imports into the web submodule, and some web modules import Solid components
 * that never reach the app: Metro swaps them through the override manifest, which tsc knows
 * nothing about (web/src/i18n/index.ts re-exporting AuthLanguageSwitcher.tsx is the usual
 * path). Those files are type-checked by the web repository's own CI under its own config;
 * here they are noise. Errors inside web/ are listed as a count, errors anywhere else fail.
 */
import { spawnSync } from 'node:child_process';

const res = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.json'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lines = `${res.stdout ?? ''}${res.stderr ?? ''}`.split('\n');

// An error starts with "path(line,col): error TS…"; continuation lines belong to it.
const blocks = [];
for (const line of lines) {
  if (/^\S.*\(\d+,\d+\): error TS\d+/.test(line) || /^error TS\d+/.test(line)) blocks.push([line]);
  else if (blocks.length && line.startsWith(' ')) blocks[blocks.length - 1].push(line);
}
const ours = blocks.filter((b) => !b[0].startsWith('web/'));
const theirs = blocks.length - ours.length;

for (const b of ours) console.error(b.join('\n'));
if (theirs) console.log(`(${theirs} error(s) inside web/ ignored: Solid files reached through imports Metro overrides)`);
if (ours.length) {
  console.error(`\n${ours.length} type error(s) in mobile code`);
  process.exit(1);
}
console.log('typecheck ok');
