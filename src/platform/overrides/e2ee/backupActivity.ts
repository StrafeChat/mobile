/**
 * What the key-backup overrides are doing right now: a restore from the recovery backup
 * (keyBackup.ts restoreKeyBackup) or an import of the old PIN backup's keys (machine.ts
 * importRoomKeys, which only legacyBackup.ts calls).
 *
 * The web closes its recovery dialog the moment a code is submitted, so it never needs to
 * know when the work behind it ends. The phone keeps its sheet up with a spinner while the
 * code is checked and the backup is downloaded and imported (seconds on a slow phone, longer
 * for a big backup), and the flow in stores/e2eeBackup says nothing when it succeeds - it
 * just stops asking. This store is that signal: `running` while an operation is in flight,
 * and `settled` bumped once it ends, either way.
 *
 * Counts only; nothing here ever holds a code, a key or anything decrypted.
 */
import { createStore } from 'solid-js/store';

export type KeyBackupOperation = 'restore' | 'legacyImport';

export interface KeyBackupActivity {
  /** The operation in flight, or null. */
  running: KeyBackupOperation | null;
  /** Bumped every time an operation ends: a change means "the one you were waiting on finished". */
  settled: number;
  /** How the most recent operation ended. */
  lastOutcome: 'succeeded' | 'failed' | null;
  /** Sessions the most recent successful operation imported (new to this device). */
  lastImported: number;
}

const [keyBackupActivity, setKeyBackupActivity] = createStore<KeyBackupActivity>({
  running: null,
  settled: 0,
  lastOutcome: null,
  lastImported: 0,
});

export { keyBackupActivity };

/** Operations in flight; `running` names the latest while any is. */
let inFlight = 0;

/** Run `op` as `kind`, reporting its start and its end (resolved or rejected) in the store. */
export async function trackKeyBackupOperation(kind: KeyBackupOperation, op: () => Promise<number>): Promise<number> {
  inFlight++;
  setKeyBackupActivity('running', kind);
  try {
    const imported = await op();
    finish('succeeded', imported);
    return imported;
  } catch (e) {
    finish('failed', 0);
    throw e;
  }
}

function finish(outcome: 'succeeded' | 'failed', imported: number): void {
  inFlight = Math.max(0, inFlight - 1);
  setKeyBackupActivity({
    running: inFlight > 0 ? keyBackupActivity.running : null,
    settled: keyBackupActivity.settled + 1,
    lastOutcome: outcome,
    lastImported: imported,
  });
}
