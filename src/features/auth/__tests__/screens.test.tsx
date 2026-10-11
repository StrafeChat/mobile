/**
 * The auth screens against mocked session / API calls: the instance screen, sign in with its
 * second-factor and unverified steps, registration (validation, invite check, captcha
 * gating and re-arming), email verification, forgot / reset password.
 */
import './authTestSetup';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ApiError } from '@web/api/ApiError';
import webEn from '@web/i18n/locales/en';
import authEn from '@/i18n/areas/auth/en';
import { InstanceScreen } from '../screens/InstanceScreen';
import { SignInScreen } from '../screens/SignInScreen';
import { RegisterScreen } from '../screens/RegisterScreen';
import { VerifyEmailScreen } from '../screens/VerifyEmailScreen';
import { ForgotPasswordScreen } from '../screens/ForgotPasswordScreen';
import { ResetPasswordScreen } from '../screens/ResetPasswordScreen';
import { RESET_SCRIPT } from '../captcha/captchaPage';
import { resetPendingAuthLinkForTests } from '../logic/pendingLink';

const session = jest.requireMock('@/platform/session') as Record<string, jest.Mock> & {
  InstanceResolveError: new (code: string, host: string) => Error;
};
const api = jest.requireMock('@web/api/auth') as Record<string, jest.Mock>;
const instanceApi = jest.requireMock('@web/api/instance') as Record<string, jest.Mock>;
const routerMod = jest.requireMock('expo-router') as { router: Record<string, jest.Mock>; mockParams: Record<string, string> };
const instanceStore = jest.requireMock('@/platform/overrides/runtime/instance') as {
  setInstance: (...a: unknown[]) => void;
};
const authStore = jest.requireMock('@web/stores/auth') as { mockSetAuth: (k: string, v: unknown) => void };
const webview = (jest.requireMock('react-native-webview') as { mockWebView: { props: Record<string, unknown> | null; injected: string[] } }).mockWebView;

const INST = { domain: 'chat.example.org', apiUrl: 'https://chat.example.org/api', stargateUrl: 'wss://chat.example.org/gateway/events' };

function setParams(p: Record<string, string>) {
  for (const k of Object.keys(routerMod.mockParams)) delete routerMod.mockParams[k];
  Object.assign(routerMod.mockParams, p);
}

beforeEach(() => {
  jest.clearAllMocks();
  resetPendingAuthLinkForTests();
  setParams({});
  session.currentInstance.mockReturnValue(INST);
  session.suggestedInstance.mockReturnValue(INST);
  session.chooseInstance.mockResolvedValue({ ...INST, version: '1.4.0' });
  session.peekSignOutNotice.mockReturnValue(null);
  instanceStore.setInstance({ loaded: true, inviteOnly: false, email: { enabled: true, verificationRequired: false } });
  instanceStore.setInstance('captcha', { enabled: false, provider: '', siteKey: '', apiUrl: '' });
  authStore.mockSetAuth('token', null);
  webview.props = null;
  webview.injected = [];
});

describe('instance screen', () => {
  test('first run: looks the address up as you type, shows the version, then goes on', async () => {
    session.currentInstance.mockReturnValue(null);
    session.suggestedInstance.mockReturnValue(null);
    jest.useFakeTimers();
    try {
      await render(<InstanceScreen />);
      expect(screen.getByText(authEn.welcomeTitle)).toBeTruthy();
      await fireEvent.changeText(screen.getByTestId('instance-input'), 'chat.example.org');
      expect(session.chooseInstance).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(700);
      });
      expect(session.chooseInstance).toHaveBeenCalledWith('chat.example.org', expect.anything());
      expect(screen.getByText('Connected to chat.example.org · Strafe 1.4.0.')).toBeTruthy();
      await act(async () => {
        await fireEvent.press(screen.getByTestId('instance-sign-in'));
      });
      expect(routerMod.router.dismissTo).toHaveBeenCalledWith('/sign-in');
    } finally {
      jest.useRealTimers();
    }
  });

  test('an address that is not a Strafe instance says so and goes nowhere', async () => {
    session.currentInstance.mockReturnValue(null);
    session.suggestedInstance.mockReturnValue(null);
    session.chooseInstance.mockRejectedValue(new session.InstanceResolveError('not_strafe', 'example.com'));
    await render(<InstanceScreen />);
    await fireEvent.changeText(screen.getByTestId('instance-input'), 'example.com');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('instance-register'));
    });
    expect(await screen.findByText('example.com does not seem to be a Strafe instance.')).toBeTruthy();
    expect(routerMod.router.dismissTo).not.toHaveBeenCalled();
  });

  test('a chosen instance is ready at once and refreshed quietly', async () => {
    let answer: (v: unknown) => void = () => undefined;
    session.chooseInstance.mockReturnValue(new Promise((r) => (answer = r)));
    await render(<InstanceScreen />);
    // Ready before the instance has answered again (no spinner, buttons on).
    expect(screen.getByText('Connected to chat.example.org.')).toBeTruthy();
    expect(screen.getByTestId('instance-sign-in').props.accessibilityState.disabled).toBe(false);
    expect(session.chooseInstance).toHaveBeenCalledWith('chat.example.org', expect.anything());
    await act(async () => answer({ ...INST, version: '1.4.0' }));
    expect(screen.getByText('Connected to chat.example.org · Strafe 1.4.0.')).toBeTruthy();
  });
});

describe('sign in', () => {
  test('without an instance, the instance screen comes first', async () => {
    session.currentInstance.mockReturnValue(null);
    await render(<SignInScreen />);
    expect(screen.getByTestId('redirect').props.children).toBe('redirect:/instance');
  });

  test('both fields are required; a good password signs in', async () => {
    api.login.mockResolvedValue({ token: 't', user: { id: '1', username: 'a', display_name: 'A' } });
    await render(<SignInScreen />);
    expect(screen.getByTestId('instance-row-domain').props.children).toBe('chat.example.org');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('sign-in-submit'));
    });
    expect(screen.getByText(webEn.auth.login.clientErrorRequired)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), '  me@example.org ');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'hunter22');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('sign-in-submit'));
    });
    expect(api.login).toHaveBeenCalledWith({ email: 'me@example.org', password: 'hunter22' });
    expect(session.finishSignIn).toHaveBeenCalled();
  });

  test('wrong password shows the translated server error', async () => {
    api.login.mockRejectedValue(new ApiError('invalid email or password', 401));
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'me@example.org');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'nope');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('sign-in-submit'));
    });
    expect(screen.getByText(webEn.errors.api.invalidCredentials)).toBeTruthy();
  });

  test('second factor: passkey note, six digits submit by themselves, a dead login goes back', async () => {
    api.login.mockResolvedValue({ mfa_required: true, mfa_token: 'm1', methods: ['totp', 'webauthn'] });
    api.verifyTotp.mockRejectedValueOnce(new ApiError('invalid authenticator code', 401));
    api.verifyTotp.mockRejectedValueOnce(new ApiError('mfa session expired or invalid, please log in again', 401, undefined, 'mfa_token_invalid'));
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'me@example.org');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'hunter22');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('sign-in-submit'));
    });
    expect(screen.getByText(webEn.auth.login.mfa.title)).toBeTruthy();
    expect(screen.getByTestId('passkey-note')).toBeTruthy();

    await act(async () => {
      await fireEvent.changeText(screen.getByTestId('mfa-code'), '123 456');
    });
    expect(api.verifyTotp).toHaveBeenCalledWith({ mfa_token: 'm1', code: '123456' });
    expect(screen.getByText(webEn.errors.api.invalidTotpCode)).toBeTruthy();
    expect(screen.getByTestId('sign-in-mfa')).toBeTruthy();

    await act(async () => {
      await fireEvent.changeText(screen.getByTestId('mfa-code'), '654321');
    });
    expect(screen.getByTestId('sign-in')).toBeTruthy();
    expect(screen.getByText(webEn.errors.api.mfaTokenInvalid)).toBeTruthy();
  });

  test('passkey-only accounts get the recovery code form straight away', async () => {
    api.login.mockResolvedValue({ mfa_required: true, mfa_token: 'm2', methods: ['webauthn'] });
    api.verifyRecoveryCode.mockResolvedValue({ token: 't', user: { id: '1', username: 'a', display_name: 'A' } });
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'me@example.org');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'hunter22');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('sign-in-submit'));
    });
    expect(screen.getByText(webEn.auth.login.mfa.recoverySubtitle)).toBeTruthy();
    expect(screen.queryByTestId('mfa-toggle-recovery')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('mfa-code'), ' abcde-12345 ');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('mfa-submit'));
    });
    expect(api.verifyRecoveryCode).toHaveBeenCalledWith({ mfa_token: 'm2', code: 'abcde-12345' });
  });

  test('unverified address: says whether a link went out; "send a new link" signs in again', async () => {
    api.login.mockRejectedValueOnce(new ApiError('email not verified', 403, undefined, 'email_unverified', { verification_email_sent: true }));
    api.login.mockResolvedValueOnce({ token: 't', user: { id: '1', username: 'a', display_name: 'A' } });
    await render(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'me@example.org');
    await fireEvent.changeText(screen.getByTestId('sign-in-password'), 'hunter22');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('sign-in-submit'));
    });
    expect(screen.getByText('We just sent a verification link to me@example.org. Open it, then sign in again.')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('unverified-resend'));
    });
    expect(api.login).toHaveBeenCalledTimes(2);
    expect(session.finishSignIn).toHaveBeenCalled();
  });

  test('why the last session ended, until dismissed', async () => {
    session.peekSignOutNotice.mockReturnValue({ reason: 'banned', at: 1 });
    await render(<SignInScreen />);
    expect(screen.getByText(webEn.auth.login.bannedNotice)).toBeTruthy();
  });

  test('"forgot your password?" only when the instance can send email', async () => {
    instanceStore.setInstance('email', { enabled: false, verificationRequired: false });
    const { rerender } = await render(<SignInScreen />);
    expect(screen.queryByTestId('sign-in-forgot')).toBeNull();
    await act(async () => instanceStore.setInstance('email', { enabled: true, verificationRequired: false }));
    await rerender(<SignInScreen />);
    await fireEvent.changeText(screen.getByTestId('sign-in-email'), 'me@example.org');
    await fireEvent.press(screen.getByTestId('sign-in-forgot'));
    expect(routerMod.router.push).toHaveBeenCalledWith('/forgot-password?email=me%40example.org');
  });

  test('opens the email link the app was launched with', async () => {
    const { Linking } = jest.requireActual('react-native') as typeof import('react-native');
    const spy = jest.spyOn(Linking, 'getInitialURL').mockResolvedValue('strafe://verify-email?token=abcdefghijklmnop1234');
    await render(<SignInScreen />);
    await waitFor(() => expect(routerMod.router.push).toHaveBeenCalledWith('/verify-email?token=abcdefghijklmnop1234'));
    spy.mockRestore();
  });
});

describe('register', () => {
  async function fillStep1() {
    await fireEvent.changeText(screen.getByTestId('register-email'), 'new@example.org');
    // The picker: open it and confirm a date (Android dialog in the test platform? iOS sheet).
    await fireEvent.press(screen.getByTestId('register-dob'));
    const picker = (jest.requireMock('@expo/ui/community/datetime-picker') as { mockDatePicker: { props: Record<string, (...a: unknown[]) => void> } })
      .mockDatePicker;
    await act(async () => {
      picker.props.onValueChange!({}, new Date(1990, 4, 17));
    });
    const done = screen.queryByTestId('register-dob-done');
    if (done) await fireEvent.press(done);
    await fireEvent.press(screen.getByTestId('register-next'));
  }

  test('step 1 checks the address and the date of birth', async () => {
    await render(<RegisterScreen />);
    await fireEvent.press(screen.getByTestId('register-next'));
    expect(screen.getByText(webEn.auth.register.errors.emailRequired)).toBeTruthy();
    expect(screen.getByText(webEn.auth.register.errors.dobRequired)).toBeTruthy();
    expect(screen.getByTestId('register-step-1')).toBeTruthy();
  });

  test('step 2: username grammar, invite check, then the account is created and signed in', async () => {
    instanceStore.setInstance({ inviteOnly: true });
    instanceApi.checkInstanceInvite.mockResolvedValue({ valid: true });
    api.register.mockResolvedValue({ id: '9', email: 'new@example.org', username: 'newbie', display_name: 'newbie', created_at: '' });
    api.login.mockResolvedValue({ token: 't', user: { id: '9', username: 'newbie', display_name: 'newbie' } });
    await render(<RegisterScreen />);
    await fillStep1();
    expect(screen.getByTestId('register-step-2')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('register-username'), 'bad name');
    await fireEvent.changeText(screen.getByTestId('register-password'), 'short');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('register-submit'));
    });
    expect(screen.getByText(authEn.usernameInvalid)).toBeTruthy();
    expect(screen.getByText(webEn.auth.register.errors.passwordMin)).toBeTruthy();
    expect(api.register).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('register-username'), 'newbie');
    expect(screen.getByText('People on other instances can add you as newbie@chat.example.org.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('register-password'), 'long enough');
    await fireEvent.changeText(screen.getByTestId('register-invite'), ' INV1 ');
    await waitFor(() => expect(instanceApi.checkInstanceInvite).toHaveBeenCalledWith('INV1'), { timeout: 1500 });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('register-submit'));
    });
    expect(api.register).toHaveBeenCalledWith({
      email: 'new@example.org',
      username: 'newbie',
      password: 'long enough',
      date_of_birth: '1990-05-17T00:00:00.000Z',
      invite: 'INV1',
    });
    expect(api.login).toHaveBeenCalledWith({ email: 'new@example.org', password: 'long enough' });
    expect(session.finishSignIn).toHaveBeenCalled();
  });

  test('an invite the server already called invalid blocks the form', async () => {
    instanceStore.setInstance({ inviteOnly: true });
    instanceApi.checkInstanceInvite.mockResolvedValue({ valid: false });
    await render(<RegisterScreen />);
    await fillStep1();
    await fireEvent.changeText(screen.getByTestId('register-username'), 'newbie');
    await fireEvent.changeText(screen.getByTestId('register-password'), 'long enough');
    await fireEvent.changeText(screen.getByTestId('register-invite'), 'BAD');
    expect(await screen.findByText(webEn.auth.register.errors.inviteInvalid, {}, { timeout: 1500 })).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('register-submit'));
    });
    expect(api.register).not.toHaveBeenCalled();
  });

  test('captcha: create waits for a token, sends it, and re-arms after a failure', async () => {
    instanceStore.setInstance('captcha', { enabled: true, provider: 'altcha', siteKey: '', apiUrl: '' });
    api.register.mockRejectedValueOnce(new ApiError('email already in use', 409));
    await render(<RegisterScreen />);
    await fillStep1();
    await fireEvent.changeText(screen.getByTestId('register-username'), 'newbie');
    await fireEvent.changeText(screen.getByTestId('register-password'), 'long enough');
    expect(screen.getByTestId('register-submit').props.accessibilityState.disabled).toBe(true);

    const onMessage = webview.props!.onMessage as (e: unknown) => void;
    await act(async () => {
      onMessage({ nativeEvent: { data: JSON.stringify({ type: 'ready' }), url: 'https://captcha.strafe.invalid/' } });
      onMessage({ nativeEvent: { data: JSON.stringify({ type: 'token', token: 'payload' }), url: 'https://captcha.strafe.invalid/' } });
    });
    expect(screen.getByTestId('register-submit').props.accessibilityState.disabled).toBe(false);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('register-submit'));
    });
    expect(api.register).toHaveBeenCalledWith(expect.objectContaining({ captcha_token: 'payload' }));
    expect(screen.getByText(webEn.errors.api.emailInUse)).toBeTruthy();
    expect(webview.injected).toContain(RESET_SCRIPT);
    expect(screen.getByTestId('register-submit').props.accessibilityState.disabled).toBe(true);
  });

  test('when the instance wants the address verified, "check your inbox"', async () => {
    api.register.mockResolvedValue({ id: '9', email: 'new@example.org', username: 'n', display_name: 'n', created_at: '', email_verification_required: true });
    await render(<RegisterScreen />);
    await fillStep1();
    await fireEvent.changeText(screen.getByTestId('register-username'), 'newbie');
    await fireEvent.changeText(screen.getByTestId('register-password'), 'long enough');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('register-submit'));
    });
    expect(screen.getByTestId('register-verify')).toBeTruthy();
    expect(api.login).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('register-go-login'));
    expect(routerMod.router.dismissTo).toHaveBeenCalledWith('/sign-in?email=new%40example.org');
  });
});

describe('email links', () => {
  test('verify: redeems the token on arrival', async () => {
    api.verifyEmail.mockResolvedValue({ ok: true });
    setParams({ token: 'tok-abcdefghijklmnop' });
    await render(<VerifyEmailScreen />);
    expect(await screen.findByText(webEn.auth.verifyEmail.successTitle)).toBeTruthy();
    expect(api.verifyEmail).toHaveBeenCalledTimes(1);
    expect(api.verifyEmail).toHaveBeenCalledWith('tok-abcdefghijklmnop');
  });

  test('verify: a link for another instance switches to it when signed out', async () => {
    api.verifyEmail.mockResolvedValue({ ok: true });
    setParams({ token: 'tok-abcdefghijklmnop', instance: 'other.example' });
    await render(<VerifyEmailScreen />);
    await screen.findByText(webEn.auth.verifyEmail.successTitle);
    expect(session.chooseInstance).toHaveBeenCalledWith('other.example');
  });

  test('verify: ...and is refused while signed in', async () => {
    authStore.mockSetAuth('token', 'live');
    setParams({ token: 'tok-abcdefghijklmnop', instance: 'other.example' });
    await render(<VerifyEmailScreen />);
    expect(await screen.findByText('This link is for other.example. Sign out to use it, or open it in your browser.')).toBeTruthy();
    expect(api.verifyEmail).not.toHaveBeenCalled();
  });

  test('verify: without a token it asks for the link, and refuses what is not one', async () => {
    api.verifyEmail.mockRejectedValue(new ApiError('that verification link is not valid or has expired', 400));
    await render(<VerifyEmailScreen />);
    await fireEvent.changeText(screen.getByTestId('paste-link-input'), 'hello');
    await fireEvent.press(screen.getByTestId('paste-link-submit'));
    expect(screen.getByText(authEn.linkInvalid)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('paste-link-input'), 'https://chat.example.org/verify-email?token=abcdefghijklmnop99');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('paste-link-submit'));
    });
    expect(api.verifyEmail).toHaveBeenCalledWith('abcdefghijklmnop99');
    expect(screen.getByText(webEn.errors.api.emailTokenInvalid)).toBeTruthy();
  });

  test('forgot: "if an account exists" whatever the address', async () => {
    api.forgotPassword.mockResolvedValue({ ok: true });
    await render(<ForgotPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('forgot-email'), 'x');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('forgot-submit'));
    });
    expect(screen.getByText(webEn.auth.register.errors.emailInvalid)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('forgot-email'), 'who@example.org');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('forgot-submit'));
    });
    expect(api.forgotPassword).toHaveBeenCalledWith('who@example.org');
    expect(screen.getByText(/If an account exists for who@example.org/)).toBeTruthy();
  });

  test('forgot: an instance without email says so and disables the form', async () => {
    instanceStore.setInstance('email', { enabled: false, verificationRequired: false });
    await render(<ForgotPasswordScreen />);
    expect(screen.getByText(webEn.auth.forgot.disabled)).toBeTruthy();
    expect(screen.getByTestId('forgot-submit').props.accessibilityState.disabled).toBe(true);
  });

  test('reset: passwords must match; success while signed in signs this device out', async () => {
    authStore.mockSetAuth('token', 'live');
    api.resetPassword.mockResolvedValue({ ok: true });
    setParams({ token: 'reset-abcdefghijklmnop' });
    await render(<ResetPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('reset-password'), 'new password');
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'other password');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('reset-submit'));
    });
    expect(screen.getByText(webEn.auth.reset.mismatch)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'new password');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('reset-submit'));
    });
    expect(api.resetPassword).toHaveBeenCalledWith('reset-abcdefghijklmnop', 'new password');
    expect(screen.getByTestId('reset-done')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('reset-go-login'));
    });
    expect(session.signOut).toHaveBeenCalled();
  });

  test('reset: a link for another account leaves this session signed in', async () => {
    authStore.mockSetAuth('token', 'live');
    api.resetPassword.mockResolvedValue({ ok: true });
    session.verifySession.mockResolvedValueOnce({ state: 'valid' });
    setParams({ token: 'reset-abcdefghijklmnop' });
    await render(<ResetPasswordScreen />);
    await fireEvent.changeText(screen.getByTestId('reset-password'), 'new password');
    await fireEvent.changeText(screen.getByTestId('reset-confirm'), 'new password');
    await act(async () => {
      await fireEvent.press(screen.getByTestId('reset-submit'));
    });
    await act(async () => {
      await fireEvent.press(screen.getByTestId('reset-go-login'));
    });
    expect(session.signOut).not.toHaveBeenCalled();
    expect(routerMod.router.replace).toHaveBeenCalledWith('/');
  });

  test('reset: without a token it asks for the link first', async () => {
    await render(<ResetPasswordScreen />);
    expect(screen.getByTestId('reset-input')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('paste-link-input'), 'strafe://reset-password?token=abcdefghijklmnop42');
    await fireEvent.press(screen.getByTestId('paste-link-submit'));
    expect(screen.getByTestId('reset')).toBeTruthy();
  });
});
