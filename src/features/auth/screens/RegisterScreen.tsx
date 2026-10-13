/**
 * Create an account - the web's Register page (web/src/pages/Register.tsx) as a two-step
 * wizard plus a result step:
 *
 * 1. email and date of birth (a real date, 13 or older), on the instance shown at the top;
 * 2. username (the server's grammar, checked here too, with the handle it makes), password,
 *    the instance invite when registration is invite-only (checked 400 ms after typing; a
 *    stale answer is dropped, a failed check says nothing, an invalid code blocks), and the
 *    instance's captcha (create stays disabled until it is solved; it re-arms after any
 *    failed attempt, because tokens are single-use);
 * 3. "check your inbox" when the instance wants the address verified first.
 *
 * Without verification the new account is signed straight in (the web sends you to the
 * sign-in form instead). Back - the arrow, Android's back, the iOS edge swipe - walks the
 * steps, and is blocked while the request runs.
 */
import { useEffect, useRef, useState } from 'react';
import { BackHandler, View, type TextInput } from 'react-native';
import { Redirect, useNavigation, type Href } from 'expo-router';
import { login, register } from '@web/api/auth';
import { checkInstanceInvite } from '@web/api/instance';
import { t } from '@web/i18n/t';
import { instance } from '@web/stores/instance';
import { useSolid } from '@/bridge/solid';
import { finishSignIn } from '@/platform/session';
import { instanceInfoFailed, loadInstanceInfo } from '@/platform/overrides/runtime/instance';
import { useTheme } from '@/theme';
import { Button, Input, Text, haptics, toast } from '@/ui';
import { CaptchaWebView } from '../captcha/CaptchaWebView';
import { AuthIconChip, AuthScaffold } from '../components/AuthScaffold';
import { DateOfBirthField } from '../components/DateOfBirthField';
import { FormErrors } from '../components/FormErrors';
import { InstanceRow } from '../components/InstanceRow';
import { authErrorLines } from '../logic/errors';
import { USERNAME_RE, dobError, dobForApi, emailError, passwordError, usernameError } from '../logic/validation';
import { useChosenInstance } from '../useInstancePicker';
import { AUTH_PATHS, backOr, pushAuth, returnToAuth } from '../nav';

export const INVITE_CHECK_DEBOUNCE_MS = 400;

type Step = 1 | 2 | 3;

export function RegisterScreen() {
  const inst = useChosenInstance();
  const navigation = useNavigation();
  const info = useSolid(() => ({
    loaded: instance.loaded,
    // GET / failed: the store keeps its defaults but is not `loaded` (the E2EE identity must
    // never be named from them). The form still works, as before, and the server decides.
    unreachable: instanceInfoFailed(),
    inviteOnly: instance.inviteOnly,
    federationEnabled: instance.federationEnabled,
    domain: instance.domain,
    captchaEnabled: instance.captcha.enabled,
    captchaProvider: instance.captcha.provider,
    captchaSiteKey: instance.captcha.siteKey,
    captchaApiUrl: instance.captcha.apiUrl,
  }));

  const [step, setStep] = useState<Step>(1);
  const [email, setEmail] = useState('');
  const [dob, setDob] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');

  const [emailErr, setEmailErr] = useState('');
  const [dobErr, setDobErr] = useState('');
  const [usernameErr, setUsernameErr] = useState('');
  const [passwordErr, setPasswordErr] = useState('');
  const [inviteErr, setInviteErr] = useState('');
  const [inviteChecked, setInviteChecked] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [registeredEmail, setRegisteredEmail] = useState('');

  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaBroken, setCaptchaBroken] = useState(false);
  const resetCaptcha = useRef<(() => void) | null>(null);

  const passwordRef = useRef<TextInput>(null);
  const inviteRef = useRef<TextInput>(null);
  const inviteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inviteValue = useRef('');
  const busy = useRef(false);

  useEffect(() => {
    if (inst) void loadInstanceInfo();
  }, [inst]);

  useEffect(() => () => {
    if (inviteTimer.current) clearTimeout(inviteTimer.current);
  }, []);

  // The iOS edge swipe would leave mid-form (and mid-request); the steps own "back" here.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: step !== 2 && !loading });
  }, [navigation, step, loading]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (loading) return true;
      if (step === 2) {
        goStep1();
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // goStep1 only sets state.
     
  }, [step, loading]);

  if (!inst) return <Redirect href={AUTH_PATHS.instance as Href} />;

  const captchaRequired = info.captchaEnabled;

  function goStep1() {
    setStep(1);
    setUsernameErr('');
    setPasswordErr('');
    setErrors([]);
  }

  function next() {
    setErrors([]);
    const e1 = emailError(email);
    const e2 = dobError(dob);
    setEmailErr(e1);
    setDobErr(e2);
    if (e1 || e2) {
      haptics.error();
      return;
    }
    setStep(2);
  }

  function onInviteChange(value: string) {
    setInvite(value);
    inviteValue.current = value;
    setInviteErr('');
    setInviteChecked(false);
    setErrors([]);
    if (inviteTimer.current) clearTimeout(inviteTimer.current);
    const code = value.trim();
    if (!code) return;
    inviteTimer.current = setTimeout(() => {
      void checkInstanceInvite(code)
        .then((res) => {
          // A reply for a code since edited away from is dropped.
          if (inviteValue.current.trim() !== code) return;
          setInviteChecked(true);
          if (!res.valid) setInviteErr(t('auth.register.errors.inviteInvalid'));
        })
        // The server decides at submit; a failed check (offline, rate limited) says nothing.
        .catch(() => undefined);
    }, INVITE_CHECK_DEBOUNCE_MS);
  }

  async function create() {
    if (busy.current) return;
    setErrors([]);
    const u = username.trim();
    const ue = usernameError(u);
    const pe = passwordError(password);
    setUsernameErr(ue);
    setPasswordErr(pe);
    let ok = !ue && !pe;
    if (captchaRequired && !captchaToken) {
      setErrors([captchaBroken ? t('auth.register.captchaUnavailable') : t('auth.register.captchaRequired')]);
      ok = false;
    }
    // Only a code the server already called bad blocks; an empty one goes through (the
    // instance's first account needs none, and only the server knows whether this is it).
    if (info.inviteOnly && inviteChecked && inviteErr) ok = false;
    if (!ok) {
      haptics.error();
      return;
    }

    const e = email.trim();
    busy.current = true;
    setLoading(true);
    try {
      const res = await register({
        email: e,
        username: u,
        password,
        date_of_birth: dobForApi(dob),
        ...(captchaToken ? { captcha_token: captchaToken } : {}),
        ...(invite.trim() ? { invite: invite.trim() } : {}),
      });
      haptics.success();
      if (res.email_verification_required) {
        setRegisteredEmail(e);
        setStep(3);
        return;
      }
      // No verification needed: sign the new account in with what was just typed.
      try {
        const out = finishSignIn(await login({ email: e, password }));
        if (out.kind === 'signed-in') return;
      } catch {
        /* fall through to the sign-in form */
      }
      toast.success(t('mobile.auth.registered'));
      returnToAuth(AUTH_PATHS.signIn, { email: e });
    } catch (err) {
      setErrors(authErrorLines(err));
      haptics.error();
      // Tokens are single-use: whatever went wrong, re-arm the challenge.
      setCaptchaToken('');
      resetCaptcha.current?.();
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  if (step === 3) {
    return (
      <AuthScaffold
        title={t('auth.register.verify.title')}
        subtitle={t('auth.register.verify.body', { email: registeredEmail })}
        brand={false}
        centered
        accessory={<AuthIconChip icon="envelope-open-text" />}
        testID="register-verify"
      >
        <Text variant="caption" align="center">
          {t('auth.register.verify.hint')}
        </Text>
        <View style={{ gap: 12 }}>
          <Button
            title={t('auth.register.verify.goToLogin')}
            fullWidth
            size="lg"
            onPress={() => returnToAuth(AUTH_PATHS.signIn, { email: registeredEmail })}
            testID="register-go-login"
          />
          <Button
            title={t('mobile.auth.haveLink')}
            variant="ghost"
            fullWidth
            onPress={() => pushAuth(AUTH_PATHS.verifyEmail)}
            testID="register-have-link"
          />
        </View>
      </AuthScaffold>
    );
  }

  const stepLabel = t('mobile.auth.stepOf', { step, total: 2 });
  const handleDomain = info.domain || inst.domain;
  const showHandle = info.federationEnabled && USERNAME_RE.test(username.trim());

  return (
    <AuthScaffold
      title={t('auth.register.title')}
      subtitle={t('auth.register.subtitle')}
      onBack={loading ? undefined : step === 2 ? goStep1 : () => backOr(AUTH_PATHS.signIn)}
      testID={`register-step-${step}`}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center' }} accessible accessibilityLabel={stepLabel}>
        {[1, 2].map((n) => (
          <StepDot key={n} active={n === step} done={n < step} />
        ))}
        <Text variant="caption" style={{ marginStart: 4 }}>
          {stepLabel}
        </Text>
      </View>

      {step === 1 ? (
        <>
          <InstanceRow domain={inst.domain} disabled={loading} onChange={() => pushAuth(AUTH_PATHS.instance, { next: 'register' })} />
          <View style={{ gap: 14 }}>
            <Input
              label={t('auth.register.emailLabel')}
              placeholder={t('auth.register.emailPlaceholder')}
              value={email}
              onChangeText={(v) => {
                setEmailErr('');
                setEmail(v);
              }}
              error={emailErr}
              required
              disabled={loading}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
              inputStyle={{ writingDirection: 'ltr' }}
              testID="register-email"
            />
            <DateOfBirthField
              label={t('auth.register.dobLabel')}
              value={dob}
              onChange={(v) => {
                setDobErr('');
                setDob(v);
              }}
              error={dobErr}
              required
              disabled={loading}
              testID="register-dob"
            />
          </View>
          <FormErrors lines={errors} testID="register-errors" />
          <View style={{ gap: 12 }}>
            <Button title={t('auth.register.next')} fullWidth size="lg" iconRight="arrow-right" onPress={next} testID="register-next" />
            <Button
              title={t('auth.register.signInLink')}
              variant="ghost"
              fullWidth
              onPress={() => returnToAuth(AUTH_PATHS.signIn)}
              testID="register-sign-in"
            />
          </View>
        </>
      ) : (
        <>
          <View style={{ gap: 14 }}>
            <Input
              label={t('auth.register.usernameLabel')}
              placeholder={t('auth.register.usernamePlaceholder')}
              value={username}
              onChangeText={(v) => {
                setErrors([]);
                setUsernameErr('');
                setUsername(v);
              }}
              error={usernameErr}
              hint={showHandle ? t('mobile.auth.handlePreview', { handle: `${username.trim()}@${handleDomain}` }) : t('mobile.auth.usernameRules')}
              required
              disabled={loading}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              autoComplete="username-new"
              textContentType="username"
              maxLength={32}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => passwordRef.current?.focus()}
              inputStyle={{ writingDirection: 'ltr' }}
              testID="register-username"
            />
            <Input
              ref={passwordRef}
              label={t('auth.register.passwordLabel')}
              placeholder={t('auth.register.passwordPlaceholder')}
              value={password}
              onChangeText={(v) => {
                setErrors([]);
                setPasswordErr('');
                setPassword(v);
              }}
              error={passwordErr}
              required
              disabled={loading}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              passwordRules="minlength: 8;"
              returnKeyType={info.inviteOnly ? 'next' : 'done'}
              submitBehavior={info.inviteOnly ? 'submit' : 'blurAndSubmit'}
              onSubmitEditing={() => {
                if (info.inviteOnly) inviteRef.current?.focus();
              }}
              testID="register-password"
            />
            {info.inviteOnly ? (
              <Input
                ref={inviteRef}
                label={t('auth.register.inviteLabel')}
                placeholder={t('auth.register.invitePlaceholder')}
                value={invite}
                onChangeText={onInviteChange}
                error={inviteErr}
                disabled={loading}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="off"
                importantForAutofill="no"
                returnKeyType="done"
                inputStyle={{ writingDirection: 'ltr' }}
                testID="register-invite"
              />
            ) : null}
            {captchaRequired ? (
              <CaptchaWebView
                provider={info.captchaProvider}
                siteKey={info.captchaSiteKey}
                apiUrl={info.captchaApiUrl}
                onToken={(token) => {
                  setCaptchaToken(token);
                  if (token) setErrors([]);
                }}
                onReady={(reset) => {
                  resetCaptcha.current = reset;
                  setCaptchaBroken(false);
                }}
                onLoadError={() => setCaptchaBroken(true)}
                testID="register-captcha"
              />
            ) : null}
          </View>
          <FormErrors lines={errors} testID="register-errors" />
          <View style={{ gap: 12 }}>
            <Button
              title={t('auth.register.createAccount')}
              fullWidth
              size="lg"
              loading={loading}
              // Until the instance has said whether it runs a captcha or wants an invite,
              // the form cannot know what it is missing - unless asking failed, when it goes
              // ahead with the defaults and the server's answer says what is missing.
              disabled={!(info.loaded || info.unreachable) || (captchaRequired && !captchaToken)}
              onPress={() => void create()}
              testID="register-submit"
            />
            <Button title={t('auth.register.back')} variant="outline" fullWidth disabled={loading} onPress={goStep1} testID="register-back" />
          </View>
        </>
      )}
    </AuthScaffold>
  );
}

function StepDot({ active, done }: { active: boolean; done: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        width: active ? 22 : 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: active || done ? theme.colors.primary : theme.colors.border,
      }}
    />
  );
}
