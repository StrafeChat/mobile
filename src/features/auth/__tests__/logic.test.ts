/**
 * The auth area's pure rules: form validation (the web's Register / Reset rules plus the
 * server's username grammar), email-link parsing, error lines, and the instance status line.
 */
import i18next from 'i18next';
import { ApiError } from '@web/api/ApiError';
import { bindI18nReactivity } from '@web/i18n/t';
import webEn from '@web/i18n/locales/en';
import authEn from '@/i18n/areas/auth/en';
import {
  dobError,
  dobForApi,
  defaultPickerDate,
  emailError,
  isAtLeastAge,
  normalizeTotp,
  parseISODate,
  passwordError,
  confirmError,
  toISODate,
  usernameError,
} from '../logic/validation';
import { isPlausibleToken, parseAuthLink, queryParams, sameInstanceHost, tokenFromPaste } from '../logic/authLinks';
import { authErrorLines, isDeadMfaSession, isNetworkFailure, unverifiedEmail } from '../logic/errors';
import { hostOf, instanceInputFor, instanceStatusMessage } from '../logic/instanceStatus';

beforeAll(async () => {
  bindI18nReactivity();
  await i18next.init({
    lng: 'en',
    resources: { en: { translation: { ...webEn, mobile: { auth: authEn } } } },
    interpolation: { escapeValue: false },
    initAsync: false,
    showSupportNotice: false,
  } as Parameters<typeof i18next.init>[0]);
});

describe('validation', () => {
  test('parseISODate accepts real calendar days only', () => {
    expect(parseISODate('2000-02-29')?.getDate()).toBe(29);
    expect(parseISODate('2001-02-29')).toBeNull();
    expect(parseISODate('2001-13-01')).toBeNull();
    expect(parseISODate('01/02/2001')).toBeNull();
    expect(parseISODate('')).toBeNull();
  });

  test('toISODate round-trips a local day', () => {
    expect(toISODate(new Date(1999, 0, 5))).toBe('1999-01-05');
    expect(toISODate(parseISODate('2010-12-31')!)).toBe('2010-12-31');
    expect(dobForApi('2010-12-31')).toBe('2010-12-31T00:00:00.000Z');
  });

  test('the 13-year gate is a calendar check, as on the web', () => {
    const today = new Date(2026, 9, 11);
    expect(isAtLeastAge(new Date(2013, 9, 11), 13, today)).toBe(true);
    expect(isAtLeastAge(new Date(2013, 9, 12), 13, today)).toBe(false);
    expect(dobError('2013-10-12', today)).toBe('You must be at least 13 years old.');
    expect(dobError('2013-10-11', today)).toBe('');
    expect(dobError('', today)).toBe('Date of birth is required.');
    expect(dobError('2013-02-30', today)).toBe('Invalid date.');
    expect(defaultPickerDate(today).getFullYear()).toBe(2008);
  });

  test('email', () => {
    expect(emailError('')).toBe('Email is required.');
    expect(emailError('nope')).toBe('Enter a valid email address.');
    expect(emailError(' a@b.co ')).toBe('');
  });

  test("username follows the server's grammar", () => {
    expect(usernameError('')).toBe('Username is required.');
    expect(usernameError('a')).toBe('Username must be at least 2 characters.');
    expect(usernameError('a'.repeat(33))).toBe('Username must be at most 32 characters.');
    expect(usernameError('bad name')).toBe(authEn.usernameInvalid);
    expect(usernameError('emoji😀')).toBe(authEn.usernameInvalid);
    expect(usernameError('al#0001')).toBe(authEn.usernameInvalid);
    expect(usernameError('Al.ice_-9')).toBe('');
  });

  test('password and confirmation', () => {
    expect(passwordError('')).toBe('Password is required.');
    expect(passwordError('1234567')).toBe('Password must be at least 8 characters.');
    expect(passwordError('12345678')).toBe('');
    expect(confirmError('a', 'b')).toBe('The passwords do not match.');
    expect(confirmError('a', 'a')).toBe('');
  });

  test('TOTP codes are typed or pasted with separators', () => {
    expect(normalizeTotp('123 456')).toBe('123456');
    expect(normalizeTotp('123-456')).toBe('123456');
    expect(normalizeTotp('abc')).toBe('');
  });
});

describe('email links', () => {
  const token = 'Zx9_abcDEF-123456789';

  test('the app scheme, both spellings', () => {
    expect(parseAuthLink(`strafe://verify-email?token=${token}`)).toEqual({ kind: 'verify-email', token, instance: null });
    expect(parseAuthLink(`strafe:///reset-password?token=${token}&instance=Chat.Example.org`)).toEqual({
      kind: 'reset-password',
      token,
      instance: 'chat.example.org',
    });
  });

  test("an instance's https link carries its host", () => {
    expect(parseAuthLink(`https://chat.example.org/verify-email?token=${token}`)).toEqual({
      kind: 'verify-email',
      token,
      instance: 'chat.example.org',
    });
    expect(parseAuthLink(`http://localhost:3000/reset-password?x=1&token=${encodeURIComponent(token)}#frag`)?.instance).toBe('localhost:3000');
  });

  test('anything else is not an auth link', () => {
    expect(parseAuthLink(`https://chat.example.org/invite/abc?token=${token}`)).toBeNull();
    expect(parseAuthLink('https://chat.example.org/verify-email')).toBeNull();
    expect(parseAuthLink(`mailto:verify-email?token=${token}`)).toBeNull();
    expect(parseAuthLink(`javascript://verify-email?token=${token}`)).toBeNull();
    expect(parseAuthLink('not a url')).toBeNull();
  });

  test('pasting the link or the bare token', () => {
    expect(tokenFromPaste(`  https://x.org/reset-password?token=${token}\n`, 'reset-password')).toEqual({ token, instance: 'x.org' });
    expect(tokenFromPaste(`https://x.org/verify-email?token=${token}`, 'reset-password')).toBeNull();
    expect(tokenFromPaste(token, 'verify-email')).toEqual({ token, instance: null });
    expect(tokenFromPaste('short', 'verify-email')).toBeNull();
    expect(isPlausibleToken('has spaces in it but long')).toBe(false);
  });

  test('query parsing decodes and keeps the first value', () => {
    expect(queryParams('?a=1&a=2&b=x%20y&c=+z')).toEqual({ a: '1', b: 'x y', c: ' z' });
  });

  test('instance hosts compare loosely', () => {
    expect(sameInstanceHost('Chat.Example.org', 'https://chat.example.org/')).toBe(true);
    expect(sameInstanceHost('chat.example.org:443', 'chat.example.org')).toBe(true);
    expect(sameInstanceHost('a.org', 'b.org')).toBe(false);
    expect(sameInstanceHost(null, 'b.org')).toBe(false);
  });
});

describe('error lines', () => {
  test("React Native's network failure reads as the translated network error", () => {
    expect(isNetworkFailure(new TypeError('Network request failed'))).toBe(true);
    expect(authErrorLines(new TypeError('Network request failed'))).toEqual([webEn.errors.network]);
    expect(authErrorLines(new ApiError('x', 0))).toEqual([webEn.errors.network]);
  });

  test('server messages and codes map through the web mapper', () => {
    expect(authErrorLines(new ApiError('invalid email or password', 401))).toEqual([webEn.errors.api.invalidCredentials]);
    expect(authErrorLines(new ApiError('slow down', 429))).toEqual([webEn.errors.api.rateLimited]);
    expect(authErrorLines(new ApiError('x', 429, undefined, 'mfa_too_many_attempts'))).toEqual([webEn.errors.api.mfaTooManyAttempts]);
  });

  test('a dead pending login and an unverified address are recognised by code', () => {
    expect(isDeadMfaSession(new ApiError('x', 401, undefined, 'mfa_token_invalid'))).toBe(true);
    expect(isDeadMfaSession(new ApiError('invalid authenticator code', 401))).toBe(false);
    expect(unverifiedEmail(new ApiError('email not verified', 403, undefined, 'email_unverified', { verification_email_sent: true }))).toEqual({
      sent: true,
    });
    expect(unverifiedEmail(new ApiError('email not verified', 403, undefined, 'email_unverified', {}))).toEqual({ sent: false });
    expect(unverifiedEmail(new Error('x'))).toBeNull();
  });
});

describe('instance status', () => {
  test('messages follow the web picker', () => {
    expect(instanceStatusMessage({ kind: 'idle' })).toBe(webEn.desktop.instance.hint);
    expect(instanceStatusMessage({ kind: 'resolving', host: 'x.org' })).toBe('Looking up x.org…');
    expect(instanceStatusMessage({ kind: 'ok', domain: 'x.org', version: '1.2.3' })).toBe('Connected to x.org · Strafe 1.2.3.');
    expect(instanceStatusMessage({ kind: 'ok', domain: 'x.org' })).toBe('Connected to x.org.');
    expect(instanceStatusMessage({ kind: 'error', code: 'invalid', host: '' })).toBe(webEn.desktop.instance.errorInvalid);
    expect(instanceStatusMessage({ kind: 'error', code: 'not_strafe', host: 'x.org' })).toBe('x.org does not seem to be a Strafe instance.');
    expect(instanceStatusMessage({ kind: 'error', code: 'unreachable', host: 'x.org' })).toContain('Could not reach x.org');
  });

  test('hostOf strips scheme, path and a leading @', () => {
    expect(hostOf(' https://Chat.example.org/api ')).toBe('Chat.example.org');
    expect(hostOf('@strafe.chat')).toBe('strafe.chat');
  });

  test('a known instance is found again by domain, a dev API by its URL', () => {
    expect(instanceInputFor({ domain: 'strafe.chat', apiUrl: 'https://strafe.chat/api' })).toBe('strafe.chat');
    expect(instanceInputFor({ domain: 'a.org', apiUrl: 'https://api.a.org' })).toBe('a.org');
    expect(instanceInputFor({ domain: '127.0.0.1:4000', apiUrl: 'http://127.0.0.1:4000' })).toBe('http://127.0.0.1:4000');
    expect(instanceInputFor({ domain: 'a.local', apiUrl: 'https://a.local:8443/api' })).toBe('https://a.local:8443/api');
  });
});
