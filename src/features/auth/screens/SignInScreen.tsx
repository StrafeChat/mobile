/**
 * Sign in - the web's Login page (web/src/pages/Login.tsx), step for step:
 *
 * - password: email + password (with AutoFill / autofill hints), the instance it goes to,
 *   why the last session ended if it ended on its own, "Need an account?", "Forgot your
 *   password?" when the instance can send email, and the accounts already on this device;
 * - mfa: the authenticator code (number pad, one-time-code autofill, paste, submits itself at
 *   six digits) or a recovery code; passkeys are not offered in the app and the screen says
 *   so when the account has one; a dead pending login (expired, five wrong codes) goes back to
 *   the password with the reason kept on screen;
 * - unverified: the address needs confirming first; "Send a new link" is another sign-in
 *   attempt, which also signs straight in once the address has been verified.
 *
 * With no instance chosen yet, the instance screen comes first.
 */
import { useEffect, useRef, useState } from 'react';
import { BackHandler, View, type TextInput } from 'react-native';
import { Redirect, useLocalSearchParams, type Href } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { isMFAChallenge, login, verifyRecoveryCode, verifyTotp, type LoginResult } from '@web/api/auth';
import { t } from '@web/i18n/t';
import { instance } from '@web/stores/instance';
import { useSolid } from '@/bridge/solid';
import { finishSignIn } from '@/platform/session';
import { loadInstanceInfo } from '@/platform/overrides/runtime/instance';
import { Button, Input, MONO_FONT, Text, haptics } from '@/ui';
import { SavedAccountsList } from '../accounts';
import { AuthIconChip, AuthScaffold } from '../components/AuthScaffold';
import { FormErrors } from '../components/FormErrors';
import { InstanceRow } from '../components/InstanceRow';
import { SessionNotice } from '../components/SessionNotice';
import { authErrorLines, isDeadMfaSession, unverifiedEmail } from '../logic/errors';
import { TOTP_LENGTH, normalizeTotp } from '../logic/validation';
import { useChosenInstance } from '../useInstancePicker';
import { AUTH_PATHS, useLaunchAuthLink, pushAuth } from '../nav';

type Step = 'password' | 'mfa' | 'unverified';

export function SignInScreen() {
  const inst = useChosenInstance();
  const emailEnabled = useSolid(() => instance.email.enabled);
  // ?email= from registration, a reset or "go to sign in" on a result screen.
  const params = useLocalSearchParams<{ email?: string }>();

  const [step, setStep] = useState<Step>('password');
  const [email, setEmail] = useState(() => (typeof params.email === 'string' ? params.email : ''));
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const [unverifiedSent, setUnverifiedSent] = useState(false);
  const [mfaToken, setMfaToken] = useState('');
  const [mfaMethods, setMfaMethods] = useState<'totp'[]>([]);
  const [useRecovery, setUseRecovery] = useState(false);
  const [passkeyHidden, setPasskeyHidden] = useState(false);
  const [code, setCode] = useState('');

  const passwordRef = useRef<TextInput>(null);
  useLaunchAuthLink();
  const codeRef = useRef<TextInput>(null);
  const busy = useRef(false);

  useEffect(() => {
    if (typeof params.email === 'string' && params.email) setEmail(params.email);
  }, [params.email]);

  // Whether this instance can send email decides if "forgot your password?" exists.
  useEffect(() => {
    if (inst) void loadInstanceInfo();
  }, [inst]);

  // Android back on a later step returns to the password, as the screen's own links do.
  useEffect(() => {
    if (step === 'password') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!loading) backToPassword();
      return true;
    });
    return () => sub.remove();
    // backToPassword only sets state.
     
  }, [step, loading]);

  if (!inst) return <Redirect href={AUTH_PATHS.instance as Href} />;

  function backToPassword() {
    setStep('password');
    setMfaToken('');
    setCode('');
    setErrors([]);
  }

  function handleResult(raw: LoginResult) {
    const hadPasskey = isMFAChallenge(raw) && raw.methods.includes('webauthn');
    const out = finishSignIn(raw);
    if (out.kind === 'signed-in') {
      haptics.success();
      return;
    }
    setPasskeyHidden(hadPasskey);
    setMfaToken(out.mfaToken);
    setMfaMethods(out.methods);
    // Nothing but a passkey on the account: a recovery code is the way in from here.
    setUseRecovery(out.methods.length === 0);
    setCode('');
    setErrors([]);
    setStep('mfa');
  }

  /** Right password, unverified address: that step instead of an error. */
  function handleUnverified(err: unknown): boolean {
    const u = unverifiedEmail(err);
    if (!u) return false;
    setUnverifiedSent(u.sent);
    setStep('unverified');
    return true;
  }

  async function submitPassword() {
    if (busy.current) return;
    setErrors([]);
    const e = email.trim();
    if (!e || !password) {
      setErrors([t('auth.login.clientErrorRequired')]);
      haptics.error();
      return;
    }
    busy.current = true;
    setLoading(true);
    try {
      handleResult(await login({ email: e, password }));
    } catch (err) {
      if (!handleUnverified(err)) {
        setErrors(authErrorLines(err));
        haptics.error();
      }
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  async function submitCode(value: string = code) {
    if (busy.current) return;
    setErrors([]);
    const c = useRecovery ? value.trim() : normalizeTotp(value);
    if (!c) {
      setErrors([t('auth.login.clientErrorRequired')]);
      return;
    }
    busy.current = true;
    setLoading(true);
    try {
      const res = useRecovery
        ? await verifyRecoveryCode({ mfa_token: mfaToken, code: c })
        : await verifyTotp({ mfa_token: mfaToken, code: c });
      handleResult(res);
    } catch (err) {
      const lines = authErrorLines(err);
      haptics.error();
      if (isDeadMfaSession(err)) backToPassword();
      else setCode('');
      setErrors(lines);
      if (!isDeadMfaSession(err)) setTimeout(() => codeRef.current?.focus(), 50);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  function onCodeChange(raw: string) {
    setErrors([]);
    if (useRecovery) {
      setCode(raw);
      return;
    }
    const digits = normalizeTotp(raw);
    setCode(digits);
    if (digits.length === TOTP_LENGTH) void submitCode(digits);
  }

  async function pasteCode() {
    const text = await Clipboard.getStringAsync().catch(() => '');
    if (!text) return;
    onCodeChange(useRecovery ? text.trim() : text);
  }

  async function resend() {
    if (busy.current) return;
    setErrors([]);
    busy.current = true;
    setLoading(true);
    try {
      handleResult(await login({ email: email.trim(), password }));
    } catch (err) {
      if (!handleUnverified(err)) setErrors(authErrorLines(err));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  if (step === 'unverified') {
    return (
      <AuthScaffold
        title={t('auth.login.unverified.title')}
        subtitle={
          unverifiedSent
            ? t('auth.login.unverified.sent', { email: email.trim() })
            : t('auth.login.unverified.notSent', { email: email.trim() })
        }
        brand={false}
        centered
        onBack={loading ? undefined : backToPassword}
        accessory={<AuthIconChip icon="envelope-open-text" />}
        testID="sign-in-unverified"
      >
        <FormErrors lines={errors} testID="sign-in-errors" />
        <View style={{ gap: 12 }}>
          <Button title={t('auth.login.unverified.resend')} fullWidth size="lg" loading={loading} onPress={() => void resend()} testID="unverified-resend" />
          <Button title={t('auth.login.unverified.back')} variant="outline" fullWidth disabled={loading} onPress={backToPassword} />
        </View>
      </AuthScaffold>
    );
  }

  if (step === 'mfa') {
    return (
      <AuthScaffold
        title={t('auth.login.mfa.title')}
        subtitle={useRecovery ? t('auth.login.mfa.recoverySubtitle') : t('auth.login.mfa.subtitle')}
        brand={false}
        centered
        onBack={loading ? undefined : backToPassword}
        accessory={<AuthIconChip icon={useRecovery ? 'key' : 'shield-halved'} />}
        testID="sign-in-mfa"
      >
        {passkeyHidden ? (
          <Text variant="caption" align="center" testID="passkey-note">
            {t('mobile.webOverrides.passkeyUnavailable')}
          </Text>
        ) : null}
        <Input
          key={useRecovery ? 'recovery' : 'totp'}
          ref={codeRef}
          label={useRecovery ? t('auth.login.mfa.recoveryLabel') : t('auth.login.mfa.totpLabel')}
          placeholder={useRecovery ? t('auth.login.mfa.recoveryPlaceholder') : t('auth.login.mfa.totpPlaceholder')}
          value={code}
          onChangeText={onCodeChange}
          onSubmitEditing={() => void submitCode()}
          disabled={loading}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          keyboardType={useRecovery ? 'default' : 'number-pad'}
          textContentType={useRecovery ? 'none' : 'oneTimeCode'}
          autoComplete={useRecovery ? 'off' : 'one-time-code'}
          returnKeyType="go"
          maxLength={useRecovery ? 64 : undefined}
          inputStyle={{
            fontFamily: MONO_FONT,
            letterSpacing: useRecovery ? 1 : 6,
            writingDirection: 'ltr',
          }}
          right={<Button title={t('mobile.auth.paste')} variant="link" onPress={() => void pasteCode()} disabled={loading} />}
          testID="mfa-code"
        />
        <FormErrors lines={errors} testID="sign-in-errors" />
        <Button title={t('auth.login.mfa.submit')} fullWidth size="lg" loading={loading} onPress={() => void submitCode()} testID="mfa-submit" />
        <View style={{ alignItems: 'center', gap: 14 }}>
          {mfaMethods.length > 0 ? (
            <Button
              variant="link"
              title={useRecovery ? t('auth.login.mfa.backToTwoFactor') : t('auth.login.mfa.useRecovery')}
              disabled={loading}
              onPress={() => {
                setErrors([]);
                setCode('');
                setUseRecovery((v) => !v);
              }}
              testID="mfa-toggle-recovery"
            />
          ) : null}
          <Button variant="link" title={t('auth.login.mfa.backToPassword')} disabled={loading} onPress={backToPassword} testID="mfa-back" />
        </View>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      title={t('auth.login.title')}
      subtitle={t('auth.login.subtitle')}
      testID="sign-in"
      footer={<SavedAccountsList disabled={loading} />}
    >
      <SessionNotice />
      <InstanceRow domain={inst.domain} disabled={loading} onChange={() => pushAuth(AUTH_PATHS.instance, { next: 'sign-in' })} />
      <View style={{ gap: 14 }}>
        <Input
          label={t('auth.login.emailLabel')}
          placeholder={t('auth.login.emailPlaceholder')}
          value={email}
          onChangeText={(v) => {
            setErrors([]);
            setEmail(v);
          }}
          disabled={loading}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="email"
          textContentType="username"
          importantForAutofill="yes"
          returnKeyType="next"
          submitBehavior="submit"
          onSubmitEditing={() => passwordRef.current?.focus()}
          inputStyle={{ writingDirection: 'ltr' }}
          testID="sign-in-email"
        />
        <Input
          ref={passwordRef}
          label={t('auth.login.passwordLabel')}
          placeholder={t('auth.login.passwordPlaceholder')}
          value={password}
          onChangeText={(v) => {
            setErrors([]);
            setPassword(v);
          }}
          disabled={loading}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          importantForAutofill="yes"
          returnKeyType="go"
          onSubmitEditing={() => void submitPassword()}
          testID="sign-in-password"
        />
        {emailEnabled ? (
          <Button
            variant="link"
            title={t('auth.login.forgotPassword')}
            disabled={loading}
            onPress={() => pushAuth(AUTH_PATHS.forgotPassword, { email: email.trim() || undefined })}
            style={{ alignSelf: 'flex-end' }}
            testID="sign-in-forgot"
          />
        ) : null}
      </View>
      <FormErrors lines={errors} testID="sign-in-errors" />
      <View style={{ gap: 12 }}>
        <Button title={t('auth.login.submit')} fullWidth size="lg" loading={loading} onPress={() => void submitPassword()} testID="sign-in-submit" />
        <Button
          title={t('auth.login.registerLink')}
          variant="ghost"
          fullWidth
          disabled={loading}
          onPress={() => pushAuth(AUTH_PATHS.register)}
          testID="sign-in-register"
        />
      </View>
    </AuthScaffold>
  );
}
