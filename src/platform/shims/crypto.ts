/**
 * WebCrypto for the shared web code, natively (react-native-quick-crypto, OpenSSL via JSI).
 *
 * The web client uses `crypto.getRandomValues` everywhere and `crypto.subtle` for attachment
 * encryption (AES-GCM), the key backup (HKDF / PBKDF2 / AES-GCM), recovery codes and call
 * media keys. quick-crypto implements those algorithms with the same WebCrypto API, so the
 * web modules run unchanged; the Olm/Megolm engine itself is the WASM build in the crypto
 * WebView, not this.
 */
import { install } from 'react-native-quick-crypto';

install();
