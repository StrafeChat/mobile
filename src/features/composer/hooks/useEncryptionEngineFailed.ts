/**
 * Whether this device's end-to-end encryption engine has failed for good (until the app
 * restarts). An encrypted conversation is then closed to sending - never sent in the clear.
 */
import { useSyncExternalStore } from 'react';
import { cryptoHost } from '@/platform/crypto/host';

const subscribe = (notify: () => void) => cryptoHost.onStateChange(() => notify());
const failed = () => cryptoHost.state === 'failed';

export function useEncryptionEngineFailed(): boolean {
  return useSyncExternalStore(subscribe, failed, failed);
}
