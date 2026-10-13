# Strafe mobile — AGENTS.md

Native Android and iOS apps for Strafe, in React Native (Expo SDK 57, RN 0.86, Hermes, New
Architecture). The workspace contract in `../AGENTS.md` (privacy, real E2EE with no
downgrades, federation, self-hosting, terminology: Space / Room / Section / PM) applies here
in full. Read it first.

## The one idea: the app's logic *is* the web client's

`web/` is the web client (`StrafeChat/web.strafe.chat`) as a **pinned git submodule**. The app
imports its non-UI code directly — `@web/stores/*`, `@web/api/*`, `@web/lib/*`, `@web/i18n/t`,
`@web/types/*` — so the gateway handling, unread/mention counting, message paging, E2EE,
key backup, voice key rotation, permissions and every other rule is one implementation shared
with the web, with its fixes. **Never re-implement in mobile what a web store or lib already
does.** If a web module can't run here, override it (below) — don't fork its logic into src/.

How that works:

- **Shims** (`src/platform/shims/`, installed by `index.ts` before anything else): MMKV-backed
  `localStorage`, `window` events (app foreground/background → focus/blur/visibilitychange),
  `window.location` (origin = the signed-in instance's web origin; `pathname` mirrors the
  screen; `assign('/')` reloads the app), `matchMedia` (reduced motion, colour scheme),
  WebCrypto via react-native-quick-crypto (`crypto.subtle` is real: AES-GCM, HKDF, PBKDF2...),
  URL polyfill, `import.meta.env` (Babel transform, `babel/import-meta-env.js`). There is
  deliberately **no global `document`**.
- **Overrides** (`src/platform/overrides/manifest.js`, applied by `metro.config.js`): a web
  module bound to the browser (DOM, IndexedDB, WASM, Tauri, Web Audio) is replaced by a mobile
  file with the **same exports**, keyed by its path under `web/src`. To change one or two
  functions and keep the rest, import the real module as `@web-original/<path>`, re-export
  `*`, and export your replacements (local exports win over `export *`). Importing any web
  `.tsx` is a bundle-time error — web UI never runs here.
- **The Solid → React bridge** (`src/bridge/solid.ts`): the stores are Solid stores.
  `useSolid(() => expr, deps)` tracks what `expr` reads and returns a frozen **snapshot**,
  re-rendering when any of it changes. Keep selectors narrow: a list reads ids, a row reads
  one item by id. Never pass store proxies into React state or `React.memo` props — pass ids
  or snapshots. Call store *functions* (actions) directly from handlers.
- **E2EE engine**: Hermes has no WebAssembly, so `@matrix-org/matrix-sdk-crypto-wasm` runs in
  a hidden WebView (`src/platform/crypto/`) and the package name resolves to an RN-side
  facade with the same API (value classes local, engine calls over RPC). Same library, same
  wire format, same store format as the web.

## Layout

```
index.ts                 entry: shims, then expo-router
src/app/                 routes (expo-router). Screens only; components live elsewhere
src/shell/               the swipe shell (rails ⟷ conversation ⟷ members) and its state
src/ui/                  the design system - use it, don't hand-roll buttons/sheets/rows
src/features/<area>/     feature UI: auth, nav, chat, composer, room, profile, settings,
                         voice, admin, discover...
src/platform/            shims, overrides, crypto host, notifications, boot
src/bridge/              Solid ↔ React
src/theme/               theme from the web's appearance store (useTheme)
src/i18n/locales/        mobile-only strings (six locales, `mobile.` prefix)
modules/strafe-push/     push notifications, native half (Kotlin + Swift, Expo module):
                         device keys, FCM / UnifiedPush / APNs, decrypt and render
plugins/                 config plugins (call service, push: Android manifest, iOS
                         Notification Service Extension target)
web/                     the web client (submodule, pinned) - do not edit from here
```

## UI rules (mobile first)

- **Discord-mobile information architecture**, as the web's own mobile layout: nav panel
  (space rail + room list, bottom tabs Home / Notifications / You), conversation panel,
  member drawer from the right; swipe between them (`src/shell/SwipeShell.tsx`). A child that
  owns horizontal drags (code block, carousel, scrubber) wraps itself in
  `<HorizontalGestureOwner>`. Tablets (≥ 768 dp) show panels side by side.
- **No hover, no right-click.** Long-press opens an action sheet (with a light haptic);
  hover-only information (reactors, full timestamps, filenames) gets a tap or sheet. Popovers
  become bottom sheets (`src/ui/Sheet`). Destructive actions confirm through the shared
  `confirmDialog` store, rendered by the app's host.
- Theme only through `useTheme()` - every colour, radius and font size. No hex literals in
  components (except pure black scrims/shadows). Respect `theme.reduceMotion`.
- Icons: `@expo/vector-icons` FontAwesome6 (the web uses Font Awesome; keep the same glyph).
- Images: `expo-image` (SVG emoji, caching). Lists: `@shopify/flash-list`. Keyboard:
  `react-native-keyboard-controller`. Safe areas: `react-native-safe-area-context`.
- Safe areas: screens pad only their top and bottom. Left and right insets (landscape: the
  notch, a side navigation bar) are applied once per route group, by the Stack's
  `contentStyle` through `useHorizontalSafePadding()` (`src/ui/safeArea`), and by `Sheet` and
  `Toast`, which draw outside it. The media viewer's route is left unpadded (its pages are the
  window's width), so its chrome pads itself. Inside the shell the bottom inset goes to the
  in-call bar, so anything portaled over the whole window uses `useWindowInsets()`.
- Accessibility: every `Pressable` has `accessibilityRole` and a label; touch targets ≥ 44 pt
  (use `hitSlop`); text scales with the system font size.
- Strings: always `t()` from `@web/i18n/t`. Use the web's existing keys wherever the meaning
  matches; mobile-only copy goes in `src/i18n/locales/*.ts` under `mobile.` in **all six**
  locales (Arabic plurals `_zero/_one/_two/_few/_many/_other`). `npm run check:i18n`.
- Ids are snowflake **strings**. Never `Number()` an id.

## Native & build

- Continuous Native Generation: `android/` and `ios/` are generated (`npx expo prebuild`) and
  git-ignored. Configure native behaviour in `app.json` / config plugins only.
- Add packages with `npx expo install <pkg>` (SDK-compatible versions).
- Android dev build: `JAVA_HOME=~/.local/share/jdks/jdk-21 npx expo run:android` (JDK 21; GraalVM 22 breaks jlink, 26 is too new for Kotlin). iOS builds
  need macOS (CI workflow).
- Before calling anything done: `npm run typecheck`, `npm run lint`, `npm test`,
  `npm run check:i18n`, `npm run check:overrides`.

## Push notifications

Instances send standard Web Push, encrypted to a key that only the device holds
(`deploy/docs/PUSH.md` in StrafeChat/deploy has the protocol). `src/platform/push/` registers
each signed-in account. iOS goes through APNs; Android goes through FCM when the build has
`STRAFE_FCM_*`, or through UnifiedPush. Each device token is registered with the build's
gateway (`EXPO_PUBLIC_PUSH_GATEWAY`), and the resulting endpoint plus the device's public key
are sent to the instance. Decryption and rendering are native (the JS app may not be running).
Android handles it in the module itself; iOS uses the Notification Service Extension under
`plugins/strafe-push-ios`. While the app is in the foreground, the open account's pushes are
suppressed, because the app's own notification logic covers them. In the background it's the
other way round. Never put message content in a log, and never show more than
"Encrypted message" for an end-to-end encrypted room. To test the whole chain on the emulator
without Google, use the gateway's debug transport (PUSH.md, *Development*).

## Bumping the web submodule

`cd web && git fetch && git checkout <commit>`, then `npm run check:overrides` (every
override still exports what the original does) and run the app. Overrides are the contract
surface between the two repos; a renamed export in web shows up there first.
