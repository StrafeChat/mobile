/**
 * Overrides owned by the boot / session area (merged by ./manifest.js).
 *
 * stores/instance: the web store marks instance info "loaded" (every feature off, no
 * federation domain) when GET / fails, and never asks again. A browser tab cannot start
 * offline, so on the web that is a cosmetic gap; a phone starts offline all the time, and
 * the E2EE engine names this account's identity from that domain. The wrapper keeps the
 * web store and its parsing, and only changes what a failure means. See the file.
 */
module.exports = {
  WEB_MODULE_OVERRIDES: {
    'stores/instance': 'src/platform/overrides/runtime/instance.ts',
  },
  PACKAGE_OVERRIDES: {},
};
