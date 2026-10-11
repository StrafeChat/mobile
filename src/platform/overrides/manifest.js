/**
 * Which web modules and packages the mobile app replaces, and with what.
 *
 * WEB_MODULE_OVERRIDES: path under web/src without extension -> mobile file (repo-relative).
 * Each replacement must export everything the original exports that anything reachable from
 * mobile imports - `npm run check:overrides` compares them after a web submodule bump.
 *
 * PACKAGE_OVERRIDES: bare import specifier -> mobile file. For packages the web imports that
 * cannot run on Hermes (WASM, Tauri, DOM-only widgets).
 *
 * Areas keep their entries in `<area>.manifest.js` beside this file (crypto, media, voice...)
 * and this file merges them, so each area owns its list. A path claimed twice is an error.
 *
 * Plain CommonJS: metro.config.js reads it at startup.
 */
const fs = require('fs');
const path = require('path');

const WEB_MODULE_OVERRIDES = {
  // "Is this a native shell rather than a browser tab?" - yes. Every logic-layer use of
  // isDesktop() means exactly that (instance from the account, native notifications,
  // external links in the system browser).
  'desktop/env': 'src/platform/overrides/desktop/env.ts',
  // The desktop shell's native hooks, implemented with Expo modules.
  'desktop/native': 'src/platform/overrides/desktop/native.ts',
  // App updates come from the stores, not from a version.json poll.
  'stores/updateAvailable': 'src/platform/overrides/stores/updateAvailable.ts',
  // i18n's index re-exports Solid components; the mobile one exports only t() & config.
  'i18n/index': 'src/platform/overrides/i18n/index.ts',
};

const PACKAGE_OVERRIDES = {
  // desktop/accounts.ts (reused as-is) keeps its account list through invoke().
  '@tauri-apps/api/core': 'src/platform/overrides/packages/tauri-core.ts',
};

for (const file of fs.readdirSync(__dirname).sort()) {
  if (!file.endsWith('.manifest.js')) continue;
  const area = require(path.join(__dirname, file));
  for (const [kind, target] of [
    ['WEB_MODULE_OVERRIDES', WEB_MODULE_OVERRIDES],
    ['PACKAGE_OVERRIDES', PACKAGE_OVERRIDES],
  ]) {
    for (const [key, value] of Object.entries(area[kind] || {})) {
      if (target[key] && target[key] !== value) {
        throw new Error(`override ${key} claimed by both ${target[key]} and ${value} (${file})`);
      }
      target[key] = value;
    }
  }
}

module.exports = { WEB_MODULE_OVERRIDES, PACKAGE_OVERRIDES };
