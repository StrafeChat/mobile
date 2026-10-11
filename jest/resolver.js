/**
 * Jest resolution with the same overrides Metro applies (metro.config.js): a web module listed
 * in src/platform/overrides/manifest.js resolves to its mobile replacement however it is
 * reached, `@web-original/<path>` reaches the real one, and overridden packages resolve to
 * their mobile files. Without this, a test that imports a store would load the browser
 * modules (Tauri, livekit-client's worker, the WASM engine) the app never runs.
 */
const path = require('path');
const { WEB_MODULE_OVERRIDES, PACKAGE_OVERRIDES } = require('../src/platform/overrides/manifest');

const ROOT = path.resolve(__dirname, '..');
const WEB_SRC = path.join(ROOT, 'web', 'src');
const webOverrides = new Map(Object.entries(WEB_MODULE_OVERRIDES).map(([rel, file]) => [rel, path.join(ROOT, file)]));
const packageOverrides = new Map(Object.entries(PACKAGE_OVERRIDES).map(([name, file]) => [name, path.join(ROOT, file)]));

const ORIGINAL_MARKER = path.join(ROOT, 'jest', '__web-original__') + path.sep;

module.exports = (request, options) => {
  // The original web module, never redirected (see moduleNameMapper in jest.config.js).
  if (request.startsWith('@web-original/')) {
    return options.defaultResolver(path.join(WEB_SRC, request.slice('@web-original/'.length)), options);
  }
  if (request.startsWith(ORIGINAL_MARKER)) {
    return options.defaultResolver(path.join(WEB_SRC, request.slice(ORIGINAL_MARKER.length)), options);
  }
  const pkg = packageOverrides.get(request);
  if (pkg) return pkg;
  const resolved = options.defaultResolver(request, options);
  if (resolved.startsWith(WEB_SRC + path.sep)) {
    const rel = path.relative(WEB_SRC, resolved).split(path.sep).join('/').replace(/\.(tsx?|jsx?|mjs)$/, '');
    const override = webOverrides.get(rel);
    // A test of an override itself imports the original through @web-original, handled above.
    if (override) return override;
  }
  return resolved;
};
