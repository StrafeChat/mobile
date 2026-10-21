#!/usr/bin/env node
/**
 * Fails when a web module that a mobile override copies, or wraps with changed behaviour,
 * has changed since the override was brought in step with it. Such an override is a second
 * implementation: a web fix to the original - a security fix above all - does not reach the
 * app until someone ports it. check:overrides only compares exports, so without this a
 * submodule bump drifts silently (one did: a web key-backup fix was missed by a bump and
 * caught by hand on the next).
 *
 * ./upstream.json lists, per area, the sha256 of each pinned web file and the mobile files a
 * change to it is ported into. Each area also `covers` web path prefixes, and every override
 * of a module under them - a manifest entry, or an `@web-original/` import outside tests -
 * must be pinned, so a new copy cannot be added without one.
 *
 * Run: node src/platform/overrides/check-drift.cjs [area...]   (no area: all of them)
 *      npm run check:drift | check:voice-drift | check:e2ee-drift
 * The areas' *-drift.test.ts run the same checks under jest.
 *
 * Plain CommonJS, like manifest.js: the CLI and the jest tests share it.
 */
const { createHash } = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../..');
const WEB_SRC = path.join(ROOT, 'web', 'src');
const UPSTREAM_FILE = path.join(__dirname, 'upstream.json');
/** Where mobile code that could import `@web-original/...` lives. */
const SCAN_DIRS = ['src', 'crypto-host/src', 'modules'];
const SKIP_DIRS = new Set(['node_modules', 'android', 'ios', 'build', '.build', '__tests__']);

/**
 * @typedef {{ sha256: string, port: string[] }} Pin
 * @typedef {{ note?: string, covers: string[], unpinned?: Record<string, string>, files: Record<string, Pin> }} Area
 * @typedef {{ web: string, areas: Record<string, Area> }} Upstream
 * @typedef {{ rel: string, ok: boolean, message: string }} FileResult
 */

/** @returns {Upstream} */
function loadUpstream() {
  return JSON.parse(fs.readFileSync(UPSTREAM_FILE, 'utf8'));
}

/** @param {string} file */
function sha256Of(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** `lib/e2ee/machine.ts` and `lib/e2ee/machine` name the same module. */
function moduleKey(rel) {
  return rel.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '');
}

function listing(files) {
  return files.length > 1 ? `${files.slice(0, -1).join(', ')} and ${files[files.length - 1]}` : files[0];
}

/**
 * One result per pinned file of `areaName`: does the web file still hash to its pin?
 * @param {string} areaName
 * @param {{ upstream?: Upstream, webSrc?: string }} [opts]
 * @returns {FileResult[]}
 */
function checkHashes(areaName, opts = {}) {
  const upstream = opts.upstream || loadUpstream();
  const webSrc = opts.webSrc || WEB_SRC;
  const area = upstream.areas[areaName];
  if (!area) throw new Error(`no area "${areaName}" in upstream.json (have: ${Object.keys(upstream.areas).join(', ')})`);
  return Object.entries(area.files).map(([rel, pin]) => {
    const file = path.join(webSrc, rel);
    if (!fs.existsSync(file)) {
      return {
        rel,
        ok: false,
        message: `web/src/${rel} no longer exists: the web moved or removed what ${listing(pin.port)} replaces. Follow it, then re-pin it in upstream.json.`,
      };
    }
    const actual = sha256Of(file);
    if (actual === pin.sha256) return { rel, ok: true, message: `web/src/${rel} in step` };
    return {
      rel,
      ok: false,
      message:
        `web/src/${rel} changed since the ${areaName} override was written. ` +
        `See git -C web diff ${upstream.web.slice(0, 12)} HEAD -- src/${rel}, port the change into ${listing(pin.port)}, ` +
        `then set its sha256 to ${actual} and "web" to the new submodule commit in src/platform/overrides/upstream.json.`,
    };
  });
}

/**
 * Every `@web-original/<module>` import in mobile code outside tests, as module -> files.
 * @param {string} [root]
 * @returns {Map<string, string[]>}
 */
function findWebOriginalImports(root = ROOT) {
  /** @type {Map<string, string[]>} */
  const found = new Map();
  const pattern = /(?:\bfrom|\bimport|\brequire\()\s*['"]@web-original\/([^'"]+)['"]/g;
  const walk = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(entry.name) || /\.test\.[jt]sx?$/.test(entry.name)) continue;
      const source = fs.readFileSync(full, 'utf8');
      for (const m of source.matchAll(pattern)) {
        const key = moduleKey(m[1]);
        const rel = path.relative(root, full).split(path.sep).join('/');
        const files = found.get(key) || [];
        if (!files.includes(rel)) files.push(rel);
        found.set(key, files);
      }
    }
  };
  for (const dir of SCAN_DIRS) walk(path.join(root, dir));
  return found;
}

/**
 * Is every override of a module this area covers pinned, and does every pin name files that
 * exist - its manifest override among them?
 * @param {string} areaName
 * @param {{ upstream?: Upstream, overrides?: Record<string, string>, webOriginalImports?: Map<string, string[]>, root?: string }} [opts]
 * @returns {string[]} problems, empty when the area is covered
 */
function checkCoverage(areaName, opts = {}) {
  const upstream = opts.upstream || loadUpstream();
  const root = opts.root || ROOT;
  const overrides = opts.overrides || require('./manifest.js').WEB_MODULE_OVERRIDES;
  const imports = opts.webOriginalImports || findWebOriginalImports(root);
  const area = upstream.areas[areaName];
  if (!area) throw new Error(`no area "${areaName}" in upstream.json (have: ${Object.keys(upstream.areas).join(', ')})`);

  const problems = [];
  const pins = new Map(Object.entries(area.files).map(([rel, pin]) => [moduleKey(rel), { rel, pin }]));
  const unpinned = area.unpinned || {};
  const covered = (key) => area.covers.some((prefix) => key.startsWith(prefix)) && !(key in unpinned);

  for (const { rel, pin } of pins.values()) {
    for (const file of pin.port) {
      if (!fs.existsSync(path.join(root, file))) problems.push(`upstream.json ${areaName} ${rel}: port file ${file} does not exist.`);
    }
  }

  /** @param {string} key @param {string} file @param {'override' | 'wrapper'} kind */
  const requirePinned = (key, file, kind) => {
    const entry = pins.get(key);
    if (!entry) {
      problems.push(
        `web/src/${key} has a mobile ${kind} (${file}) but is not pinned in the ${areaName} area of src/platform/overrides/upstream.json. ` +
          `Add its sha256 with ${file} under \`port\`, so a web change to it fails this check instead of drifting silently ` +
          '(a wrapper that only re-exports goes under `unpinned`, with the reason).',
      );
    } else if (!entry.pin.port.includes(file)) {
      problems.push(`upstream.json ${areaName} ${entry.rel}: its ${kind} ${file} is missing from \`port\`.`);
    }
  };

  for (const [key, file] of Object.entries(overrides)) {
    if (covered(key)) requirePinned(key, file, 'override');
  }
  for (const [key, files] of imports) {
    if (!covered(key)) continue;
    for (const file of files) requirePinned(key, file, 'wrapper');
  }
  return problems;
}

/** @param {string[]} argv */
function main(argv) {
  const upstream = loadUpstream();
  const names = argv.length ? argv : Object.keys(upstream.areas);
  const unknown = names.filter((n) => !upstream.areas[n]);
  if (unknown.length) {
    console.error(`unknown area(s): ${unknown.join(', ')} (upstream.json has: ${Object.keys(upstream.areas).join(', ')})`);
    return 2;
  }
  const webOriginalImports = findWebOriginalImports();
  let failed = 0;
  for (const name of names) {
    const results = checkHashes(name, { upstream });
    const problems = [...results.filter((r) => !r.ok).map((r) => r.message), ...checkCoverage(name, { upstream, webOriginalImports })];
    for (const p of problems) console.error(`${name}: ${p}`);
    if (problems.length) failed++;
    else console.log(`${name} overrides in step with web (${results.length} file${results.length === 1 ? '' : 's'})`);
  }
  return failed ? 1 : 0;
}

module.exports = { loadUpstream, checkHashes, checkCoverage, findWebOriginalImports, UPSTREAM_FILE, WEB_SRC };

if (require.main === module) process.exitCode = main(process.argv.slice(2));
