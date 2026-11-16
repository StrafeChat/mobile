/// <reference types="jest" />
/**
 * Settings -> Security -> email: changing the address (the step-up's fields by what the
 * account's second factor is, and the server asking for one we did not know about), the
 * pending change's rows (paste the link, cancel), and an instance without the email routes
 * hiding the Change row. The store and its rules are the web's (stores/accountEmail); only the
 * HTTP calls are stubbed.
 */
import './settingsTestSetup';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { t } from '@web/i18n/t';
import { ApiError } from '@web/api/ApiError';
import { setInstance } from '@web/stores/instance';
import { setAccountEmail } from '@web/stores/accountEmail';
import { resetStores } from '@/data/testing/fixtures';
import { SecurityScreen } from '../user/SecurityScreen';

// The instance's email setting is set directly below; the screen's refetch of GET / has no
// server to reach here.
jest.mock('@web/stores/instance', () => ({
  ...jest.requireActual('@web/stores/instance'),
  loadInstanceInfo: jest.fn(async () => undefined),
}));
jest.mock('@web/api/twoFactor', () => ({
  getTwoFactorStatus: jest.fn(),
}));
jest.mock('@web/api/users', () => ({
  ...jest.requireActual('@web/api/users'),
  getMe: jest.fn(),
  getEmailState: jest.fn(),
  requestEmailChange: jest.fn(),
  resendEmailChange: jest.fn(),
  cancelEmailChange: jest.fn(),
  confirmEmailChange: jest.fn(),
}));

const twoFactor = jest.requireMock('@web/api/twoFactor') as { getTwoFactorStatus: jest.Mock };
const users = jest.requireMock('@web/api/users') as Record<
  'getMe' | 'getEmailState' | 'requestEmailChange' | 'resendEmailChange' | 'cancelEmailChange' | 'confirmEmailChange',
  jest.Mock
>;

const CURRENT = 'me@example.org';
const NEXT = 'new@example.org';
const TOKEN = 'ab'.repeat(32);
const PENDING = { email: NEXT, expires_at: '2026-11-15T15:04:05Z' };

function state(pending: typeof PENDING | null = null, email = CURRENT) {
  return { email, verified_email: true, pending };
}

function factors(opts: { totp?: boolean; passkeys?: number } = {}) {
  twoFactor.getTwoFactorStatus.mockResolvedValue({
    totp_enabled: opts.totp === true,
    webauthn_credentials: Array.from({ length: opts.passkeys ?? 0 }, (_, i) => ({ id: `k${i}`, name: `Key ${i}`, created_at: '2026-01-01T00:00:00Z' })),
    recovery_codes_remaining: 8,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  resetStores();
  setAccountEmail({ userId: null, state: null, supported: true, loading: false });
  setInstance({ loaded: true, email: { enabled: true, verificationRequired: false } });
  factors();
  users.getEmailState.mockResolvedValue(state());
  users.getMe.mockResolvedValue({ id: '100', username: 'me', display_name: 'Me', email: CURRENT, verified_email: true });
});

/** The screen, with the 2FA status loaded (the Change row waits for it). */
async function open() {
  await render(<SecurityScreen />);
  await waitFor(() => expect(screen.getByText(CURRENT)).toBeTruthy());
  await waitFor(() => expect(screen.getByTestId('security-change-email').props.accessibilityState?.disabled).toBeFalsy());
}

async function openChange() {
  await open();
  await fireEvent.press(screen.getByTestId('security-change-email'));
  await waitFor(() => expect(screen.getByTestId('change-email-address')).toBeTruthy());
  await fireEvent.changeText(screen.getByTestId('change-email-address'), ` ${NEXT} `);
  await fireEvent.changeText(screen.getByTestId('change-email-password'), 'hunter22');
}

describe('changing the email address', () => {
  it('asks for no code without 2FA, and shows the sent step', async () => {
    users.requestEmailChange.mockResolvedValue(state(PENDING));
    await openChange();
    expect(screen.queryByTestId('change-email-code')).toBeNull();
    await fireEvent.press(screen.getByTestId('change-email-submit'));
    await waitFor(() => expect(users.requestEmailChange).toHaveBeenCalledWith({ email: NEXT, password: 'hunter22' }));
    await waitFor(() => expect(screen.getByText(t('settings.security.email.change.sentTitle'))).toBeTruthy());
    // The pending change is now the screen's.
    expect(screen.getByTestId('security-email-pending')).toBeTruthy();
  });

  it('refuses the current address before asking the server', async () => {
    await openChange();
    await fireEvent.changeText(screen.getByTestId('change-email-address'), 'ME@example.org');
    await fireEvent.press(screen.getByTestId('change-email-submit'));
    expect(screen.getByText(t('settings.security.email.change.errors.same'))).toBeTruthy();
    expect(users.requestEmailChange).not.toHaveBeenCalled();
  });

  it('with TOTP, asks for a code and can switch to a recovery code', async () => {
    factors({ totp: true });
    users.requestEmailChange.mockResolvedValue(state(PENDING));
    await openChange();
    expect(screen.getByTestId('change-email-code').props.keyboardType).toBe('number-pad');
    await fireEvent.press(screen.getByTestId('change-email-submit'));
    expect(screen.getByText(t('settings.security.email.change.errors.codeRequired'))).toBeTruthy();
    expect(users.requestEmailChange).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('change-email-toggle-recovery'));
    expect(screen.getByText(t('settings.security.email.change.recoveryHint'))).toBeTruthy();
    expect(screen.getByText(t('auth.login.mfa.useTotp'))).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('change-email-code'), 'abcd-efgh');
    await fireEvent.press(screen.getByTestId('change-email-submit'));
    await waitFor(() =>
      expect(users.requestEmailChange).toHaveBeenCalledWith({ email: NEXT, password: 'hunter22', recovery_code: 'abcd-efgh' }),
    );
  });

  it('with TOTP, sends the authenticator code', async () => {
    factors({ totp: true });
    users.requestEmailChange.mockResolvedValue(state(PENDING));
    await openChange();
    await fireEvent.changeText(screen.getByTestId('change-email-code'), '123456');
    await fireEvent.press(screen.getByTestId('change-email-submit'));
    await waitFor(() => expect(users.requestEmailChange).toHaveBeenCalledWith({ email: NEXT, password: 'hunter22', code: '123456' }));
  });

  it('a passkey-only account enters a recovery code, with no way back to TOTP', async () => {
    factors({ passkeys: 1 });
    await openChange();
    expect(screen.getByTestId('change-email-code')).toBeTruthy();
    expect(screen.getByText(t('settings.security.email.change.passkeyOnlyHint'))).toBeTruthy();
    expect(screen.queryByTestId('change-email-toggle-recovery')).toBeNull();
  });

  it('shows the code field when the server says a second factor is required', async () => {
    users.requestEmailChange.mockRejectedValueOnce(
      new ApiError('a code from your authenticator app or a recovery code is required', 403, undefined, 'mfa_required'),
    );
    await openChange();
    expect(screen.queryByTestId('change-email-code')).toBeNull();
    await fireEvent.press(screen.getByTestId('change-email-submit'));
    await waitFor(() => expect(screen.getByTestId('change-email-code')).toBeTruthy());
    expect(screen.getByText(t('errors.api.mfaRequired'))).toBeTruthy();
  });

  it('without email on the instance, applies the change at once', async () => {
    setInstance({ email: { enabled: false, verificationRequired: false } });
    users.requestEmailChange.mockResolvedValue({ email: NEXT, verified_email: false, pending: null });
    await open();
    // No verification without mail: no pill, the no-mail hint, no send row.
    expect(screen.queryByText(t('settings.security.email.verified'))).toBeNull();
    expect(screen.getByText(t('settings.security.email.noMailHint'))).toBeTruthy();
    expect(screen.queryByTestId('security-send-verification')).toBeNull();
    await fireEvent.press(screen.getByTestId('security-change-email'));
    await waitFor(() => expect(screen.getByText(t('settings.security.email.change.submitNoMail'))).toBeTruthy());
    await fireEvent.changeText(screen.getByTestId('change-email-address'), NEXT);
    await fireEvent.changeText(screen.getByTestId('change-email-password'), 'hunter22');
    await fireEvent.press(screen.getByTestId('change-email-submit'));
    await waitFor(() => expect(screen.getByText(NEXT)).toBeTruthy());
    expect(screen.getByText(t('settings.security.email.change.changed'))).toBeTruthy();
  });
});

describe('a pending change', () => {
  it('renders its rows; a pasted link that is not one is refused, a real one is confirmed', async () => {
    users.getEmailState.mockResolvedValue(state(PENDING));
    users.confirmEmailChange.mockResolvedValue(state(null, NEXT));
    await open();
    expect(screen.getByText(t('settings.security.email.pending.title'))).toBeTruthy();
    expect(screen.getByTestId('security-email-resend')).toBeTruthy();
    expect(screen.getByTestId('security-email-cancel')).toBeTruthy();
    // Verification of the old address is moot while a change waits.
    expect(screen.queryByTestId('security-send-verification')).toBeNull();

    await fireEvent.press(screen.getByTestId('security-email-paste'));
    const field = await waitFor(() => screen.getByPlaceholderText(t('settings.security.email.paste.placeholder')));
    await fireEvent.changeText(field, 'https://chat.example/verify-email?token=' + TOKEN);
    await fireEvent.press(screen.getByText(t('settings.security.email.paste.submit')));
    expect(screen.getByText(t('settings.security.email.paste.invalid'))).toBeTruthy();
    expect(users.confirmEmailChange).not.toHaveBeenCalled();

    await fireEvent.changeText(field, `https://chat.example/confirm-email?token=${TOKEN.toUpperCase()}`);
    await fireEvent.press(screen.getByText(t('settings.security.email.paste.submit')));
    await waitFor(() => expect(users.confirmEmailChange).toHaveBeenCalledWith(TOKEN));
    await waitFor(() => expect(screen.getByText(NEXT)).toBeTruthy());
    expect(screen.queryByTestId('security-email-pending')).toBeNull();
    expect(screen.getByText(t('settings.security.email.change.changed'))).toBeTruthy();
  });

  it('resends, then holds the button for the cooldown', async () => {
    users.getEmailState.mockResolvedValue(state(PENDING));
    users.resendEmailChange.mockResolvedValue(state(PENDING));
    await open();
    await fireEvent.press(screen.getByTestId('security-email-resend'));
    await waitFor(() => expect(screen.getByText(t('settings.security.email.pending.resent'))).toBeTruthy());
    expect(users.resendEmailChange).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('security-email-resend').props.accessibilityState?.disabled).toBe(true);
  });

  it('cancel drops the pending rows', async () => {
    users.getEmailState.mockResolvedValue(state(PENDING));
    users.cancelEmailChange.mockResolvedValue(state(null));
    await open();
    await fireEvent.press(screen.getByTestId('security-email-cancel'));
    await waitFor(() => expect(users.cancelEmailChange).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('security-email-pending')).toBeNull());
    expect(screen.getByText(t('settings.security.email.pending.cancelled'))).toBeTruthy();
  });
});

describe('an instance without the email routes', () => {
  it('shows the address from /users/@me but no Change row', async () => {
    users.getEmailState.mockRejectedValue(new ApiError('HTTP 404', 404));
    await render(<SecurityScreen />);
    await waitFor(() => expect(screen.getByText(CURRENT)).toBeTruthy());
    expect(users.getMe).toHaveBeenCalled();
    expect(screen.queryByTestId('security-change-email')).toBeNull();
  });
});
