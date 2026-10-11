/**
 * "Forgot your password?" - the web's ForgotPasswordPage (web/src/pages/ForgotPasswordPage.tsx):
 * the account's address, and the server mails a reset link. The answer is the same for every
 * well-formed address, so is the confirmation ("if an account exists..."): this screen must
 * never reveal whether one does. An instance that cannot send email says so up front.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Redirect, useLocalSearchParams, type Href } from 'expo-router';
import { forgotPassword } from '@web/api/auth';
import { t } from '@web/i18n/t';
import { instance } from '@web/stores/instance';
import { useSolid } from '@/bridge/solid';
import { loadInstanceInfo } from '@/platform/overrides/runtime/instance';
import { Banner, Button, Input, haptics } from '@/ui';
import { AuthIconChip, AuthScaffold } from '../components/AuthScaffold';
import { FormErrors } from '../components/FormErrors';
import { InstanceRow } from '../components/InstanceRow';
import { authErrorLines } from '../logic/errors';
import { emailError } from '../logic/validation';
import { AUTH_PATHS, backOr, pushAuth, returnToAuth } from '../nav';
import { useChosenInstance } from '../useInstancePicker';

export function ForgotPasswordScreen() {
  const inst = useChosenInstance();
  const params = useLocalSearchParams<{ email?: string }>();
  const emailOff = useSolid(() => instance.loaded && !instance.email.enabled);
  const [email, setEmail] = useState(() => (typeof params.email === 'string' ? params.email : ''));
  const [emailErr, setEmailErr] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sentTo, setSentTo] = useState('');

  useEffect(() => {
    if (inst) void loadInstanceInfo();
  }, [inst]);

  if (!inst) return <Redirect href={AUTH_PATHS.instance as Href} />;

  async function submit() {
    if (loading) return;
    setErrors([]);
    const value = email.trim();
    const err = emailError(value);
    setEmailErr(err);
    if (err) {
      haptics.error();
      return;
    }
    setLoading(true);
    try {
      await forgotPassword(value);
      haptics.success();
      setSentTo(value);
    } catch (e) {
      setErrors(authErrorLines(e));
      haptics.error();
    } finally {
      setLoading(false);
    }
  }

  if (sentTo) {
    return (
      <AuthScaffold
        title={t('auth.forgot.sentTitle')}
        subtitle={t('auth.forgot.sentBody', { email: sentTo })}
        brand={false}
        centered
        onBack={() => setSentTo('')}
        accessory={<AuthIconChip icon="envelope-open-text" />}
        testID="forgot-sent"
      >
        <View style={{ gap: 12 }}>
          <Button
            title={t('auth.forgot.backToLogin')}
            fullWidth
            size="lg"
            onPress={() => returnToAuth(AUTH_PATHS.signIn, { email: sentTo })}
            testID="forgot-back-login"
          />
          <Button title={t('mobile.auth.haveLink')} variant="ghost" fullWidth onPress={() => pushAuth(AUTH_PATHS.resetPassword)} testID="forgot-have-link" />
        </View>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      title={t('auth.forgot.title')}
      subtitle={t('auth.forgot.subtitle')}
      onBack={loading ? undefined : () => backOr(AUTH_PATHS.signIn)}
      testID="forgot"
    >
      <InstanceRow domain={inst.domain} disabled={loading} onChange={() => pushAuth(AUTH_PATHS.instance, { next: 'sign-in' })} />
      {emailOff ? <Banner tone="info" message={t('auth.forgot.disabled')} testID="forgot-disabled" /> : null}
      <Input
        label={t('auth.forgot.emailLabel')}
        placeholder={t('auth.forgot.emailPlaceholder')}
        value={email}
        onChangeText={(v) => {
          setErrors([]);
          setEmailErr('');
          setEmail(v);
        }}
        error={emailErr}
        required
        disabled={loading || emailOff}
        autoFocus={!email}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete="email"
        textContentType="emailAddress"
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
        inputStyle={{ writingDirection: 'ltr' }}
        testID="forgot-email"
      />
      <FormErrors lines={errors} testID="forgot-errors" />
      <View style={{ gap: 12 }}>
        <Button title={t('auth.forgot.submit')} fullWidth size="lg" loading={loading} disabled={emailOff} onPress={() => void submit()} testID="forgot-submit" />
        <Button title={t('auth.forgot.backToLogin')} variant="ghost" fullWidth disabled={loading} onPress={() => returnToAuth(AUTH_PATHS.signIn)} />
      </View>
    </AuthScaffold>
  );
}
