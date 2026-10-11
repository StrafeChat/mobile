/**
 * Where a password-reset email's link lands - the web's ResetPasswordPage
 * (web/src/pages/ResetPasswordPage.tsx): the new password twice, then the token is redeemed
 * with it. Without a token (the link opened in the browser, or "I have the link") it asks for
 * the link first.
 *
 * The server ends every session of the account on success. If this device is signed in, the
 * way on is a sign-out (which restarts the app on the sign-in screen); otherwise back to
 * sign in.
 */
import { useRef, useState } from 'react';
import { View, type TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { resetPassword } from '@web/api/auth';
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { useSolid } from '@/bridge/solid';
import { signOut } from '@/platform/session';
import { Button, Input, haptics } from '@/ui';
import { AuthIconChip, AuthScaffold } from '../components/AuthScaffold';
import { FormErrors } from '../components/FormErrors';
import { PasteLinkForm } from '../components/PasteLinkForm';
import { authErrorLines } from '../logic/errors';
import { ensureLinkInstance } from '../logic/linkInstance';
import { markAuthLinkHandled } from '../logic/pendingLink';
import { confirmError, passwordError } from '../logic/validation';
import { AUTH_PATHS, backOr, returnToAuth } from '../nav';

export function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ token?: string; instance?: string }>();
  const signedIn = useSolid(() => !!auth.token);
  const [token, setToken] = useState(() => (typeof params.token === 'string' ? params.token.trim() : ''));
  const [linkInstance, setLinkInstance] = useState<string | null>(() => (typeof params.instance === 'string' ? params.instance : null));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [passwordErr, setPasswordErr] = useState('');
  const [confirmErr, setConfirmErr] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const confirmRef = useRef<TextInput>(null);
  markAuthLinkHandled(token);

  async function submit() {
    if (loading) return;
    setErrors([]);
    if (!token) {
      setErrors([t('auth.reset.missingToken')]);
      return;
    }
    const pe = passwordError(password);
    const ce = pe ? '' : confirmError(password, confirm);
    setPasswordErr(pe);
    setConfirmErr(ce);
    if (pe || ce) {
      haptics.error();
      return;
    }
    setLoading(true);
    try {
      const where = await ensureLinkInstance(linkInstance);
      if (!where.ok) {
        setErrors([where.message]);
        return;
      }
      await resetPassword(token, password);
      haptics.success();
      setDone(true);
    } catch (e) {
      setErrors(authErrorLines(e));
      haptics.error();
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthScaffold
        title={t('auth.reset.successTitle')}
        subtitle={t('auth.reset.successBody')}
        brand={false}
        centered
        accessory={<AuthIconChip icon="circle-check" />}
        testID="reset-done"
      >
        <Button
          title={t('auth.reset.goToLogin')}
          fullWidth
          size="lg"
          loading={leaving}
          onPress={() => {
            if (signedIn) {
              // Every session of the account was just ended, this one included.
              setLeaving(true);
              void signOut();
            } else {
              returnToAuth(AUTH_PATHS.signIn);
            }
          }}
          testID="reset-go-login"
        />
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold
      title={t('auth.reset.title')}
      subtitle={token ? t('auth.reset.subtitle') : t('mobile.auth.resetLinkBody')}
      brand={false}
      onBack={loading ? undefined : () => backOr(AUTH_PATHS.signIn)}
      accessory={<AuthIconChip icon={token ? 'key' : 'envelope-open-text'} />}
      centered={!token}
      testID={token ? 'reset' : 'reset-input'}
    >
      {!token ? (
        <PasteLinkForm
          kind="reset-password"
          submitLabel={t('auth.login.mfa.submit')}
          onToken={(found) => {
            setErrors([]);
            setToken(found.token);
            setLinkInstance(found.instance);
          }}
        />
      ) : (
        <>
          <View style={{ gap: 14 }}>
            <Input
              label={t('auth.reset.passwordLabel')}
              placeholder={t('auth.reset.passwordPlaceholder')}
              value={password}
              onChangeText={(v) => {
                setErrors([]);
                setPasswordErr('');
                setPassword(v);
              }}
              error={passwordErr}
              required
              disabled={loading}
              autoFocus
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              passwordRules="minlength: 8;"
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => confirmRef.current?.focus()}
              testID="reset-password"
            />
            <Input
              ref={confirmRef}
              label={t('auth.reset.confirmLabel')}
              placeholder={t('auth.reset.confirmPlaceholder')}
              value={confirm}
              onChangeText={(v) => {
                setConfirmErr('');
                setConfirm(v);
              }}
              error={confirmErr}
              required
              disabled={loading}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="go"
              onSubmitEditing={() => void submit()}
              testID="reset-confirm"
            />
          </View>
          <FormErrors lines={errors} testID="reset-errors" />
          <View style={{ gap: 12 }}>
            <Button title={t('auth.reset.submit')} fullWidth size="lg" loading={loading} onPress={() => void submit()} testID="reset-submit" />
            <Button title={t('auth.forgot.backToLogin')} variant="ghost" fullWidth disabled={loading} onPress={() => returnToAuth(AUTH_PATHS.signIn)} />
          </View>
        </>
      )}
      {!token ? <FormErrors lines={errors} testID="reset-errors" /> : null}
    </AuthScaffold>
  );
}
