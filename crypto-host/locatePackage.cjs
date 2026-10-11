/**
 * Where @matrix-org/matrix-sdk-crypto-wasm is installed, for the host build and the engine
 * integration test. The package's "exports" map only exposes its entry (which fetches the
 * .wasm by URL), so both need the directory to reach pkg/ directly.
 *
 * MATRIX_SDK_CRYPTO_WASM_DIR overrides the lookup - for a checkout whose node_modules does
 * not have the package yet.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PKG = '@matrix-org/matrix-sdk-crypto-wasm';

function locateMatrixSdkCryptoWasm() {
  const candidates = [
    process.env.MATRIX_SDK_CRYPTO_WASM_DIR,
    path.join(ROOT, 'node_modules', PKG),
    path.join(ROOT, 'web', 'node_modules', PKG),
  ].filter(Boolean);
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'pkg', 'matrix_sdk_crypto_wasm_bg.wasm'))) {
      const version = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version;
      return {
        dir,
        version,
        bindingsEsm: path.join(dir, 'pkg', 'matrix_sdk_crypto_wasm_bg.js'),
        bindingsCjs: path.join(dir, 'pkg', 'matrix_sdk_crypto_wasm_bg.cjs'),
        wasm: path.join(dir, 'pkg', 'matrix_sdk_crypto_wasm_bg.wasm'),
      };
    }
  }
  return null;
}

module.exports = { locateMatrixSdkCryptoWasm, PKG };
