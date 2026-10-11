# The crypto host

The app's end-to-end encryption is the web client's: `web/src/lib/e2ee` driving
`@matrix-org/matrix-sdk-crypto-wasm` (vodozemac, Olm/Megolm). Hermes has no WebAssembly, so
the engine runs in a hidden WebView and the package name resolves, in the app, to a facade
with the package's API. Same library, same wire format, same store format as the web - no
second crypto implementation to audit, and no downgrade.

```
 web/src/lib/e2ee (service, transport, rooms, safety, callKeys, ...)  - unchanged
        │ imports '@matrix-org/matrix-sdk-crypto-wasm'
        ▼
 matrixSdkCrypto.ts   facade: value classes + enums local, OlmMachine methods as RPCs,
        │             results snapshotted, decryptRoomEvent batched
 host.ts              client: boot, ready gate, correlation, timeouts, crashes
        │ JSON strings over postMessage
 CryptoHost.tsx       hidden <WebView source={{ html, baseUrl: 'https://e2ee.strafe.invalid/' }}>
        ▼
 crypto-host/src      the page: server.ts (RPC, machines by handle, snapshots),
                      storage.ts (IndexedDB housekeeping), backup.ts (backup key flows)
                      + the engine, instantiated from bytes
```

Overrides (`../overrides/crypto.manifest.js`): the package → `matrixSdkCrypto.ts`;
`lib/e2ee/machine` and `lib/e2ee/keyBackup` → `../overrides/e2ee/`. Everything else in
`lib/e2ee` runs as written (crypto.subtle is real here via react-native-quick-crypto).

## Loading the engine

**The page.** `npm run build:crypto-host` (crypto-host/build.mjs) bundles crypto-host/src
with esbuild and inlines it into one HTML document, written to `assets/crypto/hostPage.js`
as a string (~160 KB). The WebView loads it with `baseUrl: https://e2ee.strafe.invalid/`:

- a **stable https origin**, so the engine's IndexedDB store persists across launches (an
  inline page with no base URL gets an opaque origin and loses its storage every time, which
  would provision a new device on every start) and WebCrypto is available (secure context);
- `.invalid` never resolves (RFC 6761): nothing can be served from it and nothing it does
  can reach a network;
- the page's CSP allows only its own inline script (by SHA-256), wasm compilation
  (`'wasm-unsafe-eval'`) and **no connections** (`connect-src 'none'`). The engine has
  nothing to talk to but the app.

**The wasm.** The package's `initAsync()` fetches the `.wasm` by URL
(`instantiateStreaming(fetch(url))`), and the page has no URL to fetch from and no network.
So the page does what the package's Node entry does - `WebAssembly.instantiate(bytes,
{ './matrix_sdk_crypto_wasm_bg.js': glue })`, then `__wbg_set_wasm` and `__wbindgen_start` -
with bytes the app sends it. The build copies the `.wasm` to
`assets/crypto/matrix_sdk_crypto_wasm_bg.wasm` (a Metro asset, so it is not 10 MB of string
in every JS bundle) and bakes its SHA-256 into the page. At boot the app reads the asset
(expo-asset → expo-file-system, `wasmAsset.ts`), posts it in 1 MiB base64 slices
(`host.wasmChunk`), and `host.wasmFinish` checks the digest before instantiating. Embedding
the wasm in the HTML instead was rejected: an ~11 MB `loadDataWithBaseURL` string is
fragile on Android, and it would sit in the JS bundle anyway.

## Protocol (protocol.ts)

One JSON string per message, `PROTOCOL_VERSION` checked at hello.

| direction | message | |
|---|---|---|
| page → app | `{t:'hello', protocol}` | page loaded; the app starts the boot |
| app → page | `{t:'call', id, method, params, progress?}` | one RPC |
| page → app | `{t:'result', id, ok, value \| error}` | its answer |
| page → app | `{t:'progress', id, args}` | key-import progress for that call |
| page → app | `{t:'log', level, message}` | unhandled errors in the page |

Errors cross as `{name, message, stack, data}` with **name and message verbatim**:
`machine.ts` recovers from a device mismatch by regex-parsing the engine's initialize error
(`expected @u:server:DEVICE`), and the reset dialog prints `name: message`. The engine's
`MegolmDecryptionError` (not an Error) crosses with its `code`/`withheldCode` in `data` and is
rebuilt as the facade's `MegolmDecryptionError`.

Values cross as data. Ids are strings, enums their numbers, bigints decimal strings. Maps
and Sets are explicit: `receiveSyncChanges`'s one-time-key counts go as entries - **an empty
Map tells the engine the server has no one-time keys and it uploads more on every sync,
forever** - and `unusedFallbackKeys` distinguishes `null` (argument omitted) from `[]` (an
empty Set), which the engine treats differently. `EncryptionSettings` sends only the fields
that were assigned; the page applies them to the engine's own `new EncryptionSettings()`.

Methods (`HostMethods`): `host.*` (ping, wipe, wasm), `store.*` (inspect, marker, delete) -
served before the engine loads, so a reset works when the engine cannot open a store -
then `machine.*`, `device.*` and `backup.*`.

### What the facade snapshots

`OlmMachine.identityKeys`, `userId`, `deviceId` are read once at initialize. Requests from
`outgoingRequests`/`shareRoomKey`/`getMissingSessions`/`backupRoomKeys` carry
`id/type/body/event_type/txn_id/version`. `getUserDevices()` returns a `UserDevices` with
synchronous `devices()/get()/keys()`; each `Device` has synchronous `deviceId`, `getKey()`,
`keys`, `localTrustState`, `isVerified()`..., and RPC-backed `setLocalTrust()` (which also
updates the snapshot) and `encryptToDeviceEvent()` (the page re-reads the device from the
store for each call, so no wasm Device is held across calls). Processed to-device events
carry `rawEvent` and `encryptionInfo` (`sender`, `senderDevice`, `isSenderVerified()`).
Decrypted room events carry `event`, sender fields and both `shieldState()`s.

`decryptRoomEvent` calls made in one turn are sent as one `machine.decryptRoomEvents` (up to
64 per call); each still resolves or rejects on its own.

Not offered (unused by Strafe): cross-signing, verification flows, dehydrated devices, QR
login, room key bundles, `exportRoomKeys`. `importBackedUpRoomKeys` and
`BackupDecryptionKey` exist but refuse: see the backup below.

## The key backup

`overrides/e2ee/keyBackup.ts` is the web module with two flows moved into the page, so the
backup's private key never exists in the app:

- `prepareKeyBackup` → `backup.prepare`: the page creates the key pair, generates the
  recovery code and wraps the private key under it with the web's own `recoveryCode.ts`
  (bundled into the page, run with the page's WebCrypto), frees the key, and returns
  `{code, publicKey, wrapped, salt}`.
- `restoreKeyBackup` → `backup.restoreOpen` (unwrap + check against the backup's public
  key; a wrong code is `RecoveryCodeMismatchError`), then each server page, still encrypted,
  to `backup.restoreAddPage` (decrypted in the page), then `backup.restoreImport` into the
  machine. Decrypted sessions never cross the bridge. A session the app abandons is freed
  after ten minutes.

Version tracking, the sync loop, 404 adoption, status and the bootstrap claim are the web's,
unchanged.

## The machine and its store (`overrides/e2ee/machine.ts`)

Same exports and device-identity rules as the web. Differences:

- The store passphrase is in the keystore (`expo-secure-store`,
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`), keyed `strafe_e2ee_passphrase_<userId>` (SecureStore
  keys may not contain `:`).
- **The device id and the store are coupled.** The id lives in MMKV and can outlive the
  WebView's data (storage pressure, the OS clearing web data, a backup restore). The engine
  would then create a new account under the old id - which the server holds other keys for,
  so peers keep encrypting to keys nobody has. After every successful open the app records
  `strafe_e2ee_store_device:<scope>` in MMKV and a `{userId, deviceId}` marker in the page's
  storage (`<store>::strafe-device`). On open: established-but-missing store, or a store
  whose passphrase is gone → `E2eeStoreUnusableError` (the existing reset flow); a store
  whose device id record is lost → the marker's device is reused if still registered, no
  orphan device is provisioned.
- One machine per store: the page closes any machine still on a store before opening it
  again, and opens are serialised per store. The app side supersedes stale opens.

## Lifecycle

```
detached ──attach──▶ loading ──hello──▶ booting ──wasm ok──▶ ready
                        ▲                  │                   │
                        └────── crash / reload / remount ──────┘
                                                   failed (protocol mismatch, bad wasm,
                                                           more than 4 crashes in 2 min)
```

- **Boot**: on hello the app applies `takeCryptoStorageWipe()` (`host.wipeStorage` deletes
  every database on the origin; a failed wipe is re-scheduled), then sends the wasm. Engine
  calls queue until ready; `host.*`/`store.*` go as soon as the page said hello. A call that
  waits more than 2 min for the host to come up fails with `CryptoHostTimeoutError`.
- **Timeouts**: 30 s by default once sent; longer for store opens, PBKDF2 and imports
  (`METHOD_TIMEOUT_MS`). A late answer is dropped. A timeout does not restart the page -
  restarting while the old page may still hold the store would risk two machines on it.
- **Crash**: `onContentProcessDidTerminate` (iOS) / `onRenderProcessGone` (Android) →
  `cryptoHost.crashed()`: everything in flight rejects with `CryptoHostCrashedError`, the
  generation advances (calls bound to an older machine reject with
  `CryptoHostRestartedError`), restart listeners run, and the component mounts a fresh
  WebView. machine.ts drops its cached machine, reopens it once the new page is ready, and
  calls `retryPendingDecrypts()`. A second `hello` from a live page (WKWebView reloading
  itself) is treated the same way.
- **Failed**: stays failed until the app restarts; every call rejects with
  `CryptoHostUnavailableError`. The UI should show that encryption is unavailable - sending
  in an encrypted room must not fall back to anything.

## Failure modes, and what the user sees

| cause | result |
|---|---|
| WebView killed in background | in-flight calls fail, store reopens on the next page; failed decrypts retried |
| WebView storage cleared, MMKV kept | `E2eeStoreUnusableError` → reset dialog → fresh device, restore prompt |
| keystore lost the passphrase | `E2eeStoreUnusableError` → reset dialog |
| store opened by another device id | web's recovery: keep the stored device if registered, else start fresh |
| asset missing/corrupt, digest mismatch | host `failed`, `CryptoHostUnavailableError` |
| page built for another protocol | host `failed` ("rebuild the crypto host") |

Push notifications for encrypted rooms cannot show text: the engine only runs while the
app's JS and its WebView do. To-device messages, room keys and call keys are processed in
the foreground; catch-up on resume is the web's (`resyncDevice`, `pollToDevice`).

## Building and testing

- `npm run build:crypto-host` - needs `@matrix-org/matrix-sdk-crypto-wasm` installed (or
  `MATRIX_SDK_CRYPTO_WASM_DIR`). Re-run after bumping the package or editing crypto-host/src.
- `npx jest src/platform/crypto src/platform/overrides/e2ee` - the integration tests run the
  page's server code on the real wasm in Node (fake-indexeddb) behind the real client and
  facade: two devices exchanging Olm and Megolm, the web's transport/rooms/service/safety/
  callKeys unmodified, call keys, the backup round trip, the machine lifecycle and crashes.
- `npx tsc --noEmit -p crypto-host` type-checks the page.
