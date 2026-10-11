/**
 * Where a verification email's link lands - the web's VerifyEmailPage
 * (web/src/pages/VerifyEmailPage.tsx): the token is redeemed on arrival and the screen says
 * whether it took (redeeming is idempotent server-side, so a mail scanner or a second tap
 * still reports success). Reached by strafe://verify-email?token=..., by an https link the OS
 * handed over, or with no token at all - then it asks for the link from the email.
 *
 * Signed in or not; the way on is "Continue" into the app or "Go to sign in".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { verifyEmail } from '@web/api/auth';
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { useSolid } from '@/bridge/solid';
import { Button, Spinner, haptics } from '@/ui';
import { AuthIconChip, AuthScaffold } from '../components/AuthScaffold';
import { FormErrors } from '../components/FormErrors';
import { PasteLinkForm } from '../components/PasteLinkForm';
import { authErrorLines } from '../logic/errors';
import { ensureLinkInstance } from '../logic/linkInstance';
import { markAuthLinkHandled } from '../logic/pendingLink';
import { AUTH_PATHS, backOr, pushAuth, returnToAuth } from '../nav';

type State = 'input' | 'working' | 'ok' | 'failed';

export function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ token?: string; instance?: string }>();
  const signedIn = useSolid(() => !!auth.token);
  const initialToken = typeof params.token === 'string' ? params.token.trim() : '';
  const [state, setState] = useState<State>(initialToken ? 'working' : 'input');
  const [errors, setErrors] = useState<string[]>([]);
  const [needsInstance, setNeedsInstance] = useState(false);
  const started = useRef<string | null>(null);

  const redeem = useCallback(async (token: string, host: string | null) => {
    markAuthLinkHandled(token);
    setErrors([]);
    setNeedsInstance(false);
    setState('working');
    const where = await ensureLinkInstance(host);
    if (!where.ok) {
      setNeedsInstance(where.reason === 'noInstance');
      setErrors([where.message]);
      setState('failed');
      return;
    }
    try {
      await verifyEmail(token);
      haptics.success();
      setState('ok');
    } catch (err) {
      setErrors(authErrorLines(err));
      haptics.error();
      setState('failed');
    }
  }, []);

  // Redeem once per token, on arrival (a re-render or a remount in development must not
  // turn into a second request that could race the first).
  useEffect(() => {
    if (!initialToken || started.current === initialToken) return;
    started.current = initialToken;
    void redeem(initialToken, typeof params.instance === 'string' ? params.instance : null);
  }, [initialToken, params.instance, redeem]);

  const title =
    state === 'working'
      ? t('auth.verifyEmail.title')
      : state === 'ok'
        ? t('auth.verifyEmail.successTitle')
        : state === 'failed'
          ? t('auth.verifyEmail.failTitle')
          : t('mobile.auth.verifyLinkTitle');

  const onward = () => {
    if (signedIn) router.replace('/' as Href);
    else returnToAuth(AUTH_PATHS.signIn);
  };

  return (
    <AuthScaffold
      title={title}
      subtitle={state === 'ok' ? t('auth.verifyEmail.successBody') : state === 'input' ? t('mobile.auth.verifyLinkBody') : undefined}
      brand={false}
      centered
      onBack={state === 'working' ? undefined : () => backOr(AUTH_PATHS.signIn)}
      accessory={
        state === 'ok' ? (
          <AuthIconChip icon="circle-check" />
        ) : state === 'failed' ? (
          <AuthIconChip icon="circle-exclamation" tone="danger" />
        ) : state === 'input' ? (
          <AuthIconChip icon="envelope-open-text" />
        ) : null
      }
      testID={`verify-email-${state}`}
    >
      {state === 'working' ? (
        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
          <Spinner size="large" label={t('auth.verifyEmail.title')} />
        </View>
      ) : null}
      {state === 'input' ? (
        <PasteLinkForm kind="verify-email" submitLabel={t('mobile.auth.verifyAction')} onToken={({ token, instance }) => void redeem(token, instance)} />
      ) : null}
      <FormErrors lines={errors} testID="verify-email-errors" />
      {state === 'ok' || state === 'failed' ? (
        <View style={{ gap: 12 }}>
          {needsInstance ? (
            <Button title={t('mobile.auth.chooseInstanceTitle')} fullWidth size="lg" onPress={() => pushAuth(AUTH_PATHS.instance, { next: 'sign-in' })} />
          ) : (
            <Button
              title={signedIn ? t('auth.verifyEmail.continueApp') : t('auth.verifyEmail.goToLogin')}
              fullWidth
              size="lg"
              onPress={onward}
              testID="verify-email-onward"
            />
          )}
          {state === 'failed' ? (
            <Button title={t('mobile.auth.tryAnotherLink')} variant="ghost" fullWidth onPress={() => setState('input')} testID="verify-email-retry" />
          ) : null}
        </View>
      ) : null}
    </AuthScaffold>
  );
}
