#!/usr/bin/env node
/**
 * Every mobile override must export what the web module it replaces exports - the rest of
 * the web code imports those names, and a missing one is undefined at runtime, not a
 * build error. Run after bumping the web submodule: npm run check:overrides
 *
 * Uses the TypeScript checker to list each module's exports (values and types), so
 * `export *` from '@web-original/...' wrappers are resolved properly.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_SRC = path.join(ROOT, 'web', 'src');
const { WEB_MODULE_OVERRIDES, OMITTED_EXPORTS = {} } = require(path.join(ROOT, 'src/platform/overrides/manifest.js'));

function resolveWeb(rel) {
  for (const ext of ['.ts', '.tsx', '/index.ts']) {
    const p = path.join(WEB_SRC, rel + ext);
    if (ts.sys.fileExists(p)) return p;
  }
  return null;
}

const pairs = [];
for (const [rel, file] of Object.entries(WEB_MODULE_OVERRIDES)) {
  const original = resolveWeb(rel);
  if (!original) {
    console.warn(`? ${rel}: no such web module (stale override?)`);
    continue;
  }
  pairs.push({ rel, original, override: path.join(ROOT, file) });
}

const configPath = path.join(ROOT, 'tsconfig.json');
const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => undefined });
const program = ts.createProgram({
  rootNames: pairs.flatMap((p) => [p.original, p.override]),
  options: { ...parsed.options, noEmit: true },
});
const checker = program.getTypeChecker();

function exportsOf(file) {
  const sf = program.getSourceFile(file);
  if (!sf) return null;
  const sym = checker.getSymbolAtLocation(sf);
  if (!sym) return new Set();
  return new Set(checker.getExportsOfModule(sym).map((s) => s.getName()));
}

let failed = 0;
for (const { rel, original, override } of pairs) {
  const want = exportsOf(original);
  const have = exportsOf(override);
  if (!want || !have) {
    console.error(`✗ ${rel}: could not read ${!want ? original : override}`);
    failed++;
    continue;
  }
  const omitted = new Set(OMITTED_EXPORTS[rel] ?? []);
  const missing = [...want].filter((n) => !have.has(n) && !omitted.has(n));
  if (missing.length) {
    console.error(`✗ ${rel}: override is missing ${missing.join(', ')}`);
    failed++;
  } else {
    console.log(`✓ ${rel}`);
  }
}
if (failed) process.exit(1);
console.log(`${pairs.length} overrides export everything their web modules do`);
