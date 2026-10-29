/**
 * Game activity ("Playing X") on a phone: shown, never detected or reported.
 *
 * The web reports the game from stores/activity.ts, which only desktop/boot starts (replaced
 * here by an inert module) and which listens through desktop/native's game wrappers (inert
 * here too). These tests hold both ends:
 * - the inert wrappers answer "no games" and never call back;
 * - nothing the app bundles reaches stores/activity.ts, or a Tauri package the app does not
 *   replace (@tauri-apps/api/event among them). That is walked over the real import graph,
 *   from the entry and every route, with the override manifest applied as Metro applies it -
 *   so a web change that imports the activity store from a store the app runs fails here,
 *   with the chain that reaches it, instead of reporting games from a phone.
 */
import { describe, expect, jest, test } from '@jest/globals';
import fs from 'fs';
import path from 'path';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() } }));
jest.mock('expo-notifications', () => ({ getPermissionsAsync: jest.fn(), requestPermissionsAsync: jest.fn(), setBadgeCountAsync: jest.fn() }));
jest.mock('../../reload', () => ({ reloadApp: jest.fn() }));
jest.mock('../../notifications', () => ({ showLocalNotification: jest.fn() }));

describe('desktop/native games (inert on a phone)', () => {
  test('no games, nothing playing, no programs; writes refuse; the listener never fires', async () => {
    const native = require('./native') as typeof import('./native');
    await expect(native.gamesAvailable()).resolves.toBe(false);
    await expect(native.gamesGetState()).resolves.toEqual({ share: false, account: null, current: null, games: [] });
    await expect(native.gamesRunningPrograms()).resolves.toEqual([]);
    await expect(native.gamesSetShare(true, 'a.example:1')).rejects.toThrow();
    await expect(native.gamesSetHidden('steam:1', true)).rejects.toThrow();
    await expect(native.gamesRename('steam:1', 'X')).rejects.toThrow();
    await expect(native.gamesAdd('p1', 'X')).rejects.toThrow();
    await expect(native.gamesRemove('user:1')).rejects.toThrow();
    const cb = jest.fn();
    const off = await native.onActivityChanged(cb);
    expect(typeof off).toBe('function');
    off();
    expect(cb).not.toHaveBeenCalled();
  });
});

// ---- the import graph the app bundles -------------------------------------------------------

const ROOT = path.resolve(__dirname, '../../../..');
const WEB_SRC = path.join(ROOT, 'web', 'src');
const SRC = path.join(ROOT, 'src');
const { WEB_MODULE_OVERRIDES, PACKAGE_OVERRIDES } = require('../manifest') as {
  WEB_MODULE_OVERRIDES: Record<string, string>;
  PACKAGE_OVERRIDES: Record<string, string>;
};

const CODE = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const PLATFORMS = ['', '.native', '.android', '.ios'];

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** A path as Metro finds it: as written, or with a platform and code extension, or its index. */
function resolveFile(base: string): string | null {
  // The web writes some imports with .js for a .ts file (components/settings/index.ts).
  for (const b of [base, base.replace(/\.(?:js|jsx|mjs|cjs)$/, '')]) {
    if (isFile(b)) return b;
    for (const dir of [b, path.join(b, 'index')]) {
      for (const p of PLATFORMS) {
        for (const e of CODE) if (isFile(dir + p + e)) return dir + p + e;
      }
    }
  }
  return null;
}

function webRelative(file: string): string | null {
  if (!file.startsWith(WEB_SRC + path.sep)) return null;
  return path.relative(WEB_SRC, file).split(path.sep).join('/').replace(/\.(?:tsx?|jsx?|mjs|cjs)$/, '');
}

/** The file Metro bundles for `file`: its override, for a web module the manifest replaces. */
function withOverride(file: string): string {
  const rel = webRelative(file);
  const override = rel === null ? undefined : WEB_MODULE_OVERRIDES[rel];
  return override ? path.join(ROOT, override) : file;
}

type Resolved = { file: string } | { pkg: string } | null;

function resolveSpec(spec: string, from: string): Resolved {
  if (spec.startsWith('@web-original/')) {
    const f = resolveFile(path.join(WEB_SRC, spec.slice('@web-original/'.length)));
    return f ? { file: f } : null;
  }
  if (spec.startsWith('@web/')) {
    const f = resolveFile(path.join(WEB_SRC, spec.slice('@web/'.length)));
    return f ? { file: withOverride(f) } : null;
  }
  if (spec.startsWith('@/')) {
    const f = resolveFile(path.join(SRC, spec.slice(2)));
    return f ? { file: f } : null;
  }
  if (spec.startsWith('.')) {
    const f = resolveFile(path.resolve(path.dirname(from), spec));
    return f ? { file: withOverride(f) } : null;
  }
  if (PACKAGE_OVERRIDES[spec]) return { file: path.join(ROOT, PACKAGE_OVERRIDES[spec]) };
  return { pkg: spec };
}

/** Whether an import clause names types only (`type X`, `{ type A, type B }`): erased by Babel. */
function typeOnly(keyword: string, clause: string): boolean {
  if (/^type\s/.test(clause)) return true;
  const named = clause.match(/^\{([\s\S]*)\}\s*$/);
  if (!named || keyword !== 'import' && keyword !== 'export') return false;
  const specs = named[1].split(',').map((s) => s.trim()).filter(Boolean);
  return specs.length > 0 && specs.every((s) => s.startsWith('type '));
}

/** What a module imports at runtime: static imports and re-exports (type-only ones left out),
 * dynamic import() and require(). Comments are dropped first; URLs in strings are kept. */
function runtimeImports(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const out: string[] = [];
  const statics = /(?:^|[;\s])(import|export)\s+([^'"`;]*?)\s*from\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(statics)) {
    if (!typeOnly(m[1], m[2].trim())) out.push(m[3]);
  }
  for (const m of code.matchAll(/(?:^|[;\s])import\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of code.matchAll(/\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? listFiles(p) : CODE.some((x) => e.name.endsWith(x)) ? [p] : [];
  });
}

interface Graph {
  /** Every file reached, with the file that first imported it (null for the entry points). */
  parent: Map<string, string | null>;
  /** Bare package imports, with the files that import them. */
  packages: Map<string, string[]>;
}

/** The entry (shims, then expo-router) and every route expo-router loads, walked to the end. */
function bundleGraph(): Graph {
  const entries = [path.join(ROOT, 'index.ts'), ...listFiles(path.join(SRC, 'app'))];
  const parent = new Map<string, string | null>(entries.map((e) => [e, null]));
  const packages = new Map<string, string[]>();
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift()!;
    if (!CODE.some((x) => file.endsWith(x))) continue;
    for (const spec of runtimeImports(fs.readFileSync(file, 'utf8'))) {
      const r = resolveSpec(spec, file);
      if (!r) continue;
      if ('pkg' in r) {
        packages.set(r.pkg, [...(packages.get(r.pkg) ?? []), file]);
        continue;
      }
      if (parent.has(r.file)) continue;
      parent.set(r.file, file);
      queue.push(r.file);
    }
  }
  return { parent, packages };
}

function chain(g: Graph, file: string): string {
  const steps: string[] = [];
  for (let f: string | null | undefined = file; f; f = g.parent.get(f)) steps.unshift(path.relative(ROOT, f));
  return steps.join(' -> ');
}

describe('what the app bundles', () => {
  const graph = bundleGraph();
  const reached = (rel: string) => [...graph.parent.keys()].find((f) => webRelative(f) === rel);

  test('is the real graph: the presence store, the activity helper and the mobile overrides', () => {
    expect(graph.parent.size).toBeGreaterThan(300);
    expect(reached('stores/presence')).toBeDefined();
    expect(reached('lib/activity')).toBeDefined();
    expect(graph.parent.has(path.join(ROOT, WEB_MODULE_OVERRIDES['desktop/native']!))).toBe(true);
    // The web's desktop modules never: the override stands in for desktop/native wherever it
    // is imported from, and desktop/boot (which starts the activity store) is not imported at
    // all - its inert override is there for anything that ever does.
    expect(reached('desktop/native')).toBeUndefined();
    expect(reached('desktop/boot')).toBeUndefined();
  });

  test('sees the edges the web really has (so a pass below is not the walker missing them)', () => {
    const read = (rel: string) => runtimeImports(fs.readFileSync(path.join(WEB_SRC, rel), 'utf8'));
    expect(read('desktop/boot.ts')).toContain('../stores/activity');
    expect(read('desktop/native.ts')).toEqual(expect.arrayContaining(['@tauri-apps/api/core', '@tauri-apps/api/webviewWindow']));
    // Type-only imports are erased by Babel and bundle nothing.
    expect(runtimeImports("import type { A } from 'a';\nimport { type B, type C } from 'b';\nexport type { D } from 'd';")).toEqual([]);
    expect(runtimeImports("import { type B, c } from 'b';\nexport * from 'e';\nconst x = require('f');")).toEqual(['b', 'e', 'f']);
  });

  test('never reaches the store that reports the game being played', () => {
    const activity = reached('stores/activity');
    expect(activity ? chain(graph, activity) : null).toBeNull();
  });

  test('imports no Tauri package the app does not replace (the activity-changed listener among them)', () => {
    const tauri = [...graph.packages.entries()]
      .filter(([pkg]) => pkg.startsWith('@tauri-apps/'))
      .map(([pkg, from]) => `${pkg} <- ${from.map((f) => chain(graph, f)).join(' | ')}`);
    expect(tauri).toEqual([]);
  });
});
