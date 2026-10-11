/**
 * Metro for a React Native app whose logic comes from the web client.
 *
 * `web/` is the web client (git submodule, pinned). Its stores, API layer, E2EE service and
 * helpers are imported as they are - see AGENTS.md. Two things make that work:
 *
 * 1. **Overrides.** A web module bound to the browser (DOM, IndexedDB, WASM, Tauri, Web
 *    Audio...) is swapped for a mobile implementation with the same exports. Overrides are
 *    keyed by the module's path under web/src, so they apply however the module is reached -
 *    by a mobile import or by another web module's relative import. Bare packages the web
 *    imports that cannot run on Hermes are swapped the same way.
 * 2. **No web UI.** Importing a web `.tsx` (a Solid component) is an error at bundle time:
 *    the UI is native and lives in src/. Catching it here is cheaper than a red screen.
 */
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');
const { WEB_MODULE_OVERRIDES, PACKAGE_OVERRIDES } = require('./src/platform/overrides/manifest');

const ROOT = __dirname;
const WEB_SRC = path.join(ROOT, 'web', 'src');

const config = getDefaultConfig(ROOT);

// The E2EE engine's wasm ships as an asset the crypto WebView is fed (src/platform/crypto).
config.resolver.assetExts.push('wasm');

const webOverrides = new Map(
  Object.entries(WEB_MODULE_OVERRIDES).map(([rel, file]) => [rel, path.join(ROOT, file)]),
);
const packageOverrides = new Map(
  Object.entries(PACKAGE_OVERRIDES).map(([name, file]) => [name, path.join(ROOT, file)]),
);

/** solid-js must resolve to its client build: the server build's signals do not react. */
const SOLID_CLIENT = {
  'solid-js': 'node_modules/solid-js/dist/solid.js',
  'solid-js/store': 'node_modules/solid-js/store/dist/store.js',
};

function webRelative(filePath) {
  if (!filePath.startsWith(WEB_SRC + path.sep)) return null;
  return path.relative(WEB_SRC, filePath).split(path.sep).join('/').replace(/\.(tsx?|jsx?|mjs)$/, '');
}

/**
 * `@web-original/<path>` reaches the real web module even when it is overridden, so an
 * override can wrap it: re-export everything and replace one or two functions.
 */
const ORIGINAL_PREFIX = '@web-original/';

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith(ORIGINAL_PREFIX)) {
    return context.resolveRequest(context, path.join(WEB_SRC, moduleName.slice(ORIGINAL_PREFIX.length)), platform);
  }
  if (SOLID_CLIENT[moduleName]) {
    return { type: 'sourceFile', filePath: path.join(ROOT, SOLID_CLIENT[moduleName]) };
  }
  const pkg = packageOverrides.get(moduleName);
  if (pkg) return { type: 'sourceFile', filePath: pkg };

  const res = context.resolveRequest(context, moduleName, platform);
  if (res.type !== 'sourceFile') return res;
  const rel = webRelative(res.filePath);
  if (rel === null) return res;
  const override = webOverrides.get(rel);
  if (override) return { type: 'sourceFile', filePath: override };
  if (res.filePath.endsWith('.tsx') || res.filePath.endsWith('.jsx')) {
    throw new Error(
      `web UI module ${rel} was imported from ${path.relative(ROOT, context.originModulePath)}; ` +
        'the mobile UI is native - import a store/lib module, or add an override in src/platform/overrides/manifest.js',
    );
  }
  return res;
};

module.exports = config;
