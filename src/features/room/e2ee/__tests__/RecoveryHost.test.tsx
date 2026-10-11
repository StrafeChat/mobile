/**
 * The E2EE prompts against the web's recoveryPrompt store and the overrides' backup-activity
 * signal: the keyboard is put away on every way out of an input view, the restore spinner ends
 * when the restore does (not on a 30 s timer, and not while a long one is still running), a
 * wrong code comes back to be corrected, the PIN field takes the digits Arabic keyboards type,
 * and the "no encryption" dialog speaks to a phone rather than to a browser tab.
 */
import '../../__tests__/roomTestSetup';
import { afterEach, beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Keyboard } from 'react-native';
import { webcrypto } from 'crypto';
import {
  cancelRecoveryPrompt,
  promptLegacyPin,
  promptRecoveryCode,
  recoveryPrompt,
  RecoveryPromptCancelled,
  setRecoveryPrompt,
  setRecoveryPromptError,
} from '@web/stores/recoveryPrompt';
import { generateRecoveryCode } from '@web/lib/e2ee/recoveryCode';
import { resetStores } from '@/data/testing/fixtures';
import { trackKeyBackupOperation } from '@/platform/overrides/e2ee/backupActivity';


const { RecoveryHost } = require('../RecoveryHost') as typeof import('../RecoveryHost');
const { E2eeEnvironmentHost } = require('../E2eeEnvironmentHost') as typeof import('../E2eeEnvironmentHost');


const CODE_FIELD = 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX';
let dismissKeyboard: ReturnType<typeof jest.spyOn>;

beforeAll(() => {
  // The checksum check (isWellFormedRecoveryCode) hashes with WebCrypto, as the app's shim does.
  const g = globalThis as { crypto?: Crypto };
  if (!g.crypto?.subtle) Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true });
});

beforeEach(() => {
  jest.useFakeTimers();
  resetStores();
  dismissKeyboard = jest.spyOn(Keyboard, 'dismiss');
});

afterEach(async () => {
  await act(async () => {
    cancelRecoveryPrompt();
    setRecoveryPrompt({ e2eeEnvironmentError: null, e2eeStoreError: null, lastSubmitError: null });
  });
  await act(async () => {
    jest.runOnlyPendingTimers();
  });
  dismissKeyboard.mockRestore();
  jest.useRealTimers();
});

/** A promise and its resolvers, for an operation the test finishes when it wants. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

describe('the keyboard', () => {
  test('Later on "Upgrade your backup" puts the keyboard away', async () => {
    await render(<RecoveryHost />);
    let failure: unknown;
    await act(async () => {
      promptLegacyPin().catch((e: unknown) => (failure = e));
    });
    expect(screen.getByText('Upgrade your backup')).toBeTruthy();
    dismissKeyboard.mockClear();
    await act(async () => {
      fireEvent.press(screen.getByText('Later'));
    });
    expect(dismissKeyboard).toHaveBeenCalled();
    expect((failure as RecoveryPromptCancelled).reason).toBe('dismissed');
  });

  test('a prompt the flow closes itself puts the keyboard away too', async () => {
    await render(<RecoveryHost />);
    await act(async () => {
      promptRecoveryCode().catch(() => undefined);
    });
    dismissKeyboard.mockClear();
    // What surfaceE2eeEnvironmentFailure and sign-out do.
    await act(async () => {
      cancelRecoveryPrompt();
    });
    expect(dismissKeyboard).toHaveBeenCalled();
  });

  test('submitting a PIN puts the keyboard away before the field is replaced by the spinner', async () => {
    await render(<RecoveryHost />);
    let pin: string | undefined;
    await act(async () => {
      void promptLegacyPin().then((v) => (pin = v));
    });
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('6+ digits'), '123456');
    });
    dismissKeyboard.mockClear();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Import' }));
    });
    expect(dismissKeyboard).toHaveBeenCalled();
    expect(pin).toBe('123456');
    expect(screen.getByText('Importing your old backup…')).toBeTruthy();
  });
});

describe('the restore spinner', () => {
  async function submitCode(code: string): Promise<void> {
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText(CODE_FIELD), code);
    });
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Restore' }));
    });
  }

  test('closes when the restore ends, not 30 s later', async () => {
    const code = await generateRecoveryCode();
    const restore = deferred<number>();
    await render(<RecoveryHost />);
    await act(async () => {
      // The flow's shape (stores/e2eeBackup restoreWithPrompt): ask, then restore.
      void promptRecoveryCode().then(() => trackKeyBackupOperation('restore', () => restore.promise));
    });
    await submitCode(code);
    expect(screen.getByText('Restoring your messages…')).toBeTruthy();

    // A big backup: still downloading well past the old 30 s cut-off, still a spinner.
    await advance(45_000);
    expect(screen.getByText('Restoring your messages…')).toBeTruthy();

    await act(async () => {
      restore.resolve(12);
    });
    await advance(1_000);
    expect(screen.queryByText('Restoring your messages…')).toBeNull();
    expect(screen.queryByTestId('recovery-sheet')).toBeNull();
  });

  test('a wrong code comes back with the code as typed and the error, to correct in place', async () => {
    const code = await generateRecoveryCode();
    await render(<RecoveryHost />);
    await act(async () => {
      void promptRecoveryCode().then(async () => {
        await trackKeyBackupOperation('restore', () => Promise.reject(new Error('mismatch'))).catch(() => undefined);
        setRecoveryPromptError("That code doesn't open this account's backup.");
        return promptRecoveryCode({ retainSubmitError: true }).catch(() => undefined);
      });
    });
    await submitCode(code);
    await advance(0);
    expect(screen.getByText("That code doesn't open this account's backup.")).toBeTruthy();
    expect(screen.getByDisplayValue(code)).toBeTruthy();
    expect(recoveryPrompt.pending?.kind).toBe('enterCode');
  });
});

describe('the saved-code file', () => {
  test('a code file a killed Save left in the cache is removed at start', async () => {
    const fs = require('expo-file-system') as { File: new (...args: unknown[]) => { exists: boolean; delete(): void } };
    const Original = fs.File;
    const deleted: string[] = [];
    fs.File = class extends Original {
      constructor(...args: unknown[]) {
        super(...args);
        this.exists = args[1] === 'strafe-recovery-code.txt';
      }
      delete() {
        deleted.push('strafe-recovery-code.txt');
        super.delete();
      }
    };
    try {
      await render(<RecoveryHost />);
      expect(deleted).toEqual(['strafe-recovery-code.txt']);
    } finally {
      fs.File = Original;
    }
  });
});

describe('the PIN field', () => {
  test('takes Arabic-Indic and Persian digits as the digits they are', async () => {
    await render(<RecoveryHost />);
    let pin: string | undefined;
    await act(async () => {
      void promptLegacyPin().then((v) => (pin = v));
    });
    await act(async () => {
      fireEvent.changeText(screen.getByPlaceholderText('6+ digits'), '١٢٣۴۵۶');
    });
    expect(screen.getByDisplayValue('123456')).toBeTruthy();
    await act(async () => {
      fireEvent.press(screen.getByRole('button', { name: 'Import' }));
    });
    expect(pin).toBe('123456');
  });
});

describe('encryption unavailable', () => {
  test('explains it for a phone, not with the web\'s advice for a browser tab', async () => {
    await render(<E2eeEnvironmentHost />);
    await act(async () => {
      setRecoveryPrompt('e2eeEnvironmentError', 'This browser only exposes encryption (Web Crypto) on HTTPS or http://localhost.');
    });
    expect(screen.getByText(/Strafe couldn.t start its encryption engine/)).toBeTruthy();
    expect(screen.queryByText(/http:\/\/localhost/)).toBeNull();
  });
});
