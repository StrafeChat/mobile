/**
 * Form rules for the auth screens: the web's (pages/Register.tsx, ForgotPasswordPage.tsx,
 * ResetPasswordPage.tsx), plus the server's username grammar, which the web leaves to the
 * server. Pure functions; every message is a translated string or '' for "fine".
 */
import { t } from '@web/i18n/t';

/** The web's address check (Register.tsx / ForgotPasswordPage.tsx). */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The server's username grammar (equinox auth/service.go usernameRe), which is also the
 * federation handle grammar: 2-32 of letters, digits, '_', '.', '-'. Unique case-insensitively,
 * no #discriminator.
 */
export const USERNAME_RE = /^[A-Za-z0-9_.-]{2,32}$/;
export const USERNAME_MIN = 2;
export const USERNAME_MAX = 32;
export const PASSWORD_MIN = 8;
/** Accounts are for people at least this old (the web's DOB gate). */
export const MIN_AGE_YEARS = 13;

/** 'YYYY-MM-DD' to a local Date, or null when it is not a real calendar date. */
export function parseISODate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
  return dt;
}

/** A local date as 'YYYY-MM-DD' (what the form keeps and the API receives, plus T00:00:00Z). */
export function toISODate(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0');
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The web's calendar check: born on or before this day `years` ago. */
export function isAtLeastAge(dob: Date, years: number, today: Date = new Date()): boolean {
  const cutoff = new Date(today.getFullYear() - years, today.getMonth(), today.getDate());
  return dob <= cutoff;
}

/** Where the date picker opens when nothing is chosen yet: about 18 years ago. */
export function defaultPickerDate(today: Date = new Date()): Date {
  return new Date(today.getFullYear() - 18, today.getMonth(), today.getDate());
}

/** The register API's form of the date of birth (Register.tsx). */
export function dobForApi(iso: string): string {
  return `${iso}T00:00:00.000Z`;
}

export function emailError(raw: string): string {
  const v = raw.trim();
  if (!v) return t('auth.register.errors.emailRequired');
  if (!EMAIL_RE.test(v)) return t('auth.register.errors.emailInvalid');
  return '';
}

export function dobError(iso: string, today: Date = new Date()): string {
  if (!iso) return t('auth.register.errors.dobRequired');
  const dob = parseISODate(iso);
  if (!dob) return t('auth.register.errors.dobInvalid');
  if (!isAtLeastAge(dob, MIN_AGE_YEARS, today)) return t('auth.register.errors.dobAge');
  return '';
}

export function usernameError(raw: string): string {
  const v = raw.trim();
  if (!v) return t('auth.register.errors.usernameRequired');
  if (v.length < USERNAME_MIN) return t('errors.validation.usernameMin');
  if (v.length > USERNAME_MAX) return t('errors.validation.usernameMax');
  if (!USERNAME_RE.test(v)) return t('mobile.auth.usernameInvalid');
  return '';
}

export function passwordError(raw: string): string {
  if (!raw) return t('auth.register.errors.passwordRequired');
  if (raw.length < PASSWORD_MIN) return t('auth.register.errors.passwordMin');
  return '';
}

export function confirmError(password: string, confirm: string): string {
  return confirm !== password ? t('auth.reset.mismatch') : '';
}

/** A TOTP code as typed or pasted ("123 456", "123-456") down to its digits. */
export function normalizeTotp(raw: string): string {
  return raw.replace(/\D+/g, '').slice(0, 8);
}

/** Authenticator codes are six digits; the form submits by itself at six. */
export const TOTP_LENGTH = 6;
