/**
 * The recovery-code field's typing rules (the web's RecoveryModal EnterCodeView): the text
 * is re-grouped into dash-separated blocks of four on every change, and the caret stays after
 * the same number of code characters it was after - so correcting one wrong character in the
 * middle of a 34-character code is possible, which after a mistyped code is exactly what the
 * person is trying to do.
 *
 * A native TextInput reports the new text (onChangeText) and the selection (onSelectionChange)
 * separately, so the caret of an edit is worked out from the previous value and selection.
 */
import { formatRecoveryCode, normalizeRecoveryCode, RECOVERY_CODE_LENGTH } from '@web/lib/e2ee/recoveryCode';

export interface Selection {
  start: number;
  end: number;
}

/** Where the caret is after `prev` (with `sel` selected) became `next` by one edit. */
export function caretAfterEdit(prev: string, sel: Selection, next: string): number {
  const start = Math.max(0, Math.min(sel.start, prev.length));
  const end = Math.max(start, Math.min(sel.end, prev.length));
  const inserted = next.length - (prev.length - (end - start));
  return Math.max(0, Math.min(next.length, start + inserted));
}

/** Re-group `raw` and move `caret` to the same code character. */
export function reformatRecoveryInput(raw: string, caret: number): { value: string; caret: number } {
  const codeCharsBefore = normalizeRecoveryCode(raw.slice(0, Math.max(0, caret))).length;
  const formatted = formatRecoveryCode(raw);
  let seen = 0;
  let position = formatted.length;
  for (let i = 0; i < formatted.length; i++) {
    if (seen === codeCharsBefore) {
      position = i;
      break;
    }
    if (formatted[i] !== '-') seen++;
  }
  return { value: formatted, caret: position };
}

/** Restore is offered once the code has all its characters. */
export function recoveryCodeComplete(value: string): boolean {
  return normalizeRecoveryCode(value).length === RECOVERY_CODE_LENGTH;
}

/** The legacy PIN must have at least six digits (the web's rule). */
export const LEGACY_PIN_MIN = 6;
export const LEGACY_PIN_MAX = 12;
