/**
 * Overrides owned by the boot / session area (merged by ./manifest.js).
 *
 * stores/instance: when GET / fails the web store stays unloaded and resolves at once, so
 * whatever awaited it (the E2EE engine, which names this account's identity from the
 * instance's domain) fails until something asks again. A phone starts offline all the time;
 * the wrapper keeps the web store and its parsing, and makes a signed-in caller wait for the
 * answer instead, retrying as the network allows. See the file.
 */
module.exports = {
  WEB_MODULE_OVERRIDES: {
    'stores/instance': 'src/platform/overrides/runtime/instance.ts',
  },
  PACKAGE_OVERRIDES: {},
};
