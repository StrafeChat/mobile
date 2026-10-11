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

/**
 * What the PIN field keeps of what was typed: digits only, with the Arabic-Indic, Extended
 * Arabic-Indic (Persian/Urdu) and fullwidth digits some keyboards' number pads produce turned
 * into ASCII - the same mapping legacyBackup.ts applies before PBKDF2, so the PIN that set
 * the backup up on a desktop opens it from such a keyboard. Dropping them instead (a bare
 * `\D` filter) left the field empty however many digits were typed.
 */
export function normalizePinInput(raw: string): string {
  let out = '';
  for (const ch of raw) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x30 && cp <= 0x39) out += ch;
    else if (cp >= 0x0660 && cp <= 0x0669) out += String.fromCharCode(0x30 + cp - 0x0660);
    else if (cp >= 0x06f0 && cp <= 0x06f9) out += String.fromCharCode(0x30 + cp - 0x06f0);
    else if (cp >= 0xff10 && cp <= 0xff19) out += String.fromCharCode(0x30 + cp - 0xff10);
  }
  return out;
}
