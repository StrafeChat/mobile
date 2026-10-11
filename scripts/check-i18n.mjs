#!/usr/bin/env node
/**
 * The six mobile locale files must define the same keys (with Arabic's extra plural forms
 * allowed), like the web's. Run: npm run check:i18n
 */
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const LOCALES = ['en', 'es', 'pt-BR', 'fr', 'de', 'ar'];
const PLURAL = /_(zero|one|two|few|many|other)$/;

function load(code) {
  const src = readFileSync(new URL(`../src/i18n/locales/${code}.ts`, import.meta.url), 'utf8');
  const js = transformSync(src, { loader: 'ts', format: 'cjs' }).code;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports.default;
}

function keys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object') out.push(...keys(v, path));
    else out.push(path);
  }
  return out;
}

const base = (k) => k.replace(PLURAL, '');
const sets = Object.fromEntries(LOCALES.map((l) => [l, new Set(keys(load(l)).map(base))]));
let failed = false;
for (const l of LOCALES) {
  for (const k of sets.en) if (!sets[l].has(k)) { console.error(`${l}: missing ${k}`); failed = true; }
  for (const k of sets[l]) if (!sets.en.has(k)) { console.error(`${l}: extra ${k} (not in en)`); failed = true; }
}
if (failed) process.exit(1);
console.log(`i18n ok: ${sets.en.size} mobile keys in ${LOCALES.length} locales`);
