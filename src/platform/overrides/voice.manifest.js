/**
 * Voice/video overrides (see ./manifest.js for the format).
 *
 * stores/voice is a faithful copy of the web store with a short, listed set of mobile
 * changes (its header; drift is caught by ./check-drift.cjs). The lib/voice leaves are
 * replaced so anything else reaching them - the settings page's mic test, say - gets the
 * native implementations rather than Web Audio, WASM and Vite worker imports.
 */
module.exports = {
  WEB_MODULE_OVERRIDES: {
    'stores/voice': 'src/platform/overrides/voice/stores/voice.ts',
    'lib/voice/e2ee': 'src/platform/overrides/voice/lib/voice/e2ee.ts',
    'lib/voice/micPipeline': 'src/platform/overrides/voice/lib/voice/micPipeline.ts',
    'lib/voice/rnnoise': 'src/platform/overrides/voice/lib/voice/rnnoise.ts',
    'lib/voice/ringtone': 'src/platform/overrides/voice/lib/voice/ringtone.ts',
  },
  PACKAGE_OVERRIDES: {},
};
