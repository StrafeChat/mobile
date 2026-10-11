/**
 * The E2EE engine host, for the app shell. Everything E2EE itself goes through the web's
 * lib/e2ee (and the package facade it imports); see ./README.md.
 */
export { CryptoHost } from './CryptoHost';
export { cryptoHost, scheduleCryptoStorageWipe, takeCryptoStorageWipe, type HostState } from './host';
export {
  CryptoHostCrashedError,
  CryptoHostRestartedError,
  CryptoHostTimeoutError,
  CryptoHostUnavailableError,
  CryptoHostUnsupportedError,
} from './errors';
