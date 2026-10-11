/**
 * The rest of the web client's logic layer that is bound to the browser (merged by
 * ./manifest.js): notifications, the read cursor, menus and popovers, rich text, keyboard
 * plumbing and the desktop shell's leftovers. Each replacement keeps the original's exports;
 * where only one or two of them are browser-bound the file wraps the real module through
 * `@web-original/...` and replaces just those.
 *
 * The phone-shaped UI state behind three of them - the action sheet (contextMenu), the report
 * sheet (ReportDialog) and the profile sheet (userProfilePopover) - lives in
 * src/platform/presenters/, which the app's sheet hosts render.
 *
 * Checked and deliberately NOT overridden, because they run as they are on the shims:
 * - lib/openWindow: isDesktop() is true, so it calls desktop/native's openPopupWindow
 *   (overridden: the app's OAuth screen, or the in-app browser);
 * - stores/externalLink: opens through desktop/native's openExternalUrl (the in-app browser),
 *   reads the trusted domains from localStorage and compares origins with the URL polyfill and
 *   the location shim; the app renders its confirmation from `externalLink.pendingUrl`;
 * - lib/chatShortcuts: a CustomEvent on `window`, which the window shim provides.
 */
module.exports = {
  WEB_MODULE_OVERRIDES: {
    // Notification decisions: the web's own, with a visibility-only `document` for the call.
    'lib/notifications': 'src/platform/overrides/lib/notifications.ts',
    // Prefs store kept; system notifications through expo-notifications, the chime on them.
    'stores/notificationPrefs': 'src/platform/overrides/stores/notificationPrefs.ts',
    // The read cursor follows the message list's bottom row while the app is in front.
    'lib/viewportAck': 'src/platform/overrides/lib/viewportAck.ts',
    // Menus: the web's builders, presented as an action sheet; copy via expo-clipboard.
    'lib/userContextMenu': 'src/platform/overrides/lib/userContextMenu.ts',
    'stores/contextMenu': 'src/platform/overrides/stores/contextMenu.ts',
    // A Solid component on the web; openReportDialog presents the native report sheet.
    'components/ReportDialog': 'src/platform/overrides/components/ReportDialog.ts',
    // The profile popover without geometry: a bottom sheet.
    'stores/userProfilePopover': 'src/platform/overrides/stores/userProfilePopover.ts',
    // No window-level key events on a phone.
    'stores/keybinds': 'src/platform/overrides/stores/keybinds.ts',
    'lib/composerFocus': 'src/platform/overrides/lib/composerFocus.ts',
    // The web's mobile layout names, bound to the native shell's state.
    'stores/mobileShellLayout': 'src/platform/overrides/stores/mobileShellLayout.ts',
    // Token runs and node trees instead of DOMPurify'd HTML.
    'lib/codeHighlight': 'src/platform/overrides/lib/codeHighlight.ts',
    'lib/profileRichText': 'src/platform/overrides/lib/profileRichText.ts',
    // Passkeys need each instance to vouch for the app; not offered yet.
    'lib/webauthn': 'src/platform/overrides/lib/webauthn.ts',
    // Desktop shell modules with nothing to do on a phone.
    'desktop/boot': 'src/platform/overrides/desktop/boot.ts',
    'desktop/updater': 'src/platform/overrides/desktop/updater.ts',
  },
  PACKAGE_OVERRIDES: {},
};
