/**
 * Welcome, and which instance. The app is one build for every Strafe instance, so before
 * anything else it asks where the account lives - the web's InstancePicker
 * (web/src/components/desktop/InstancePicker.tsx) as a calm first screen: the turtle, a line
 * about what Strafe is, the address field (looked up as you type, with the instance's name
 * and version or a clear error), then "Sign in" or "Create account" once it has answered.
 *
 * Reached first when no instance is chosen, and from "Change" on the sign-in and register
 * forms (?next= says which one to go back to).
 */
import { useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { t } from '@web/i18n/t';
import { Button, haptics } from '@/ui';
import { SavedAccountsList } from '../accounts';
import { AuthScaffold } from '../components/AuthScaffold';
import { InstanceField } from '../components/InstanceField';
import { SessionNotice } from '../components/SessionNotice';
import { AUTH_PATHS, useLaunchAuthLink, backOr, returnToAuth } from '../nav';
import { useInstancePicker } from '../useInstancePicker';

export function InstanceScreen() {
  const params = useLocalSearchParams<{ next?: string }>();
  const next = params.next === 'register' ? 'register' : params.next === 'sign-in' ? 'sign-in' : null;
  const picker = useInstancePicker();
  const [going, setGoing] = useState<'sign-in' | 'register' | null>(null);
  useLaunchAuthLink();

  async function go(target: 'sign-in' | 'register') {
    if (going) return;
    setGoing(target);
    try {
      const ok = await picker.resolveNow();
      if (!ok) {
        haptics.error();
        return;
      }
      haptics.selection();
      returnToAuth(target === 'register' ? AUTH_PATHS.register : AUTH_PATHS.signIn);
    } finally {
      setGoing(null);
    }
  }

  const primary: 'sign-in' | 'register' = next === 'register' ? 'register' : 'sign-in';
  const secondary = primary === 'register' ? 'sign-in' : 'register';
  const label = (target: 'sign-in' | 'register') => (target === 'register' ? t('auth.register.createAccount') : t('auth.login.submit'));
  const resolving = picker.status.kind === 'resolving';

  return (
    <AuthScaffold
      title={next ? t('mobile.auth.chooseInstanceTitle') : t('mobile.auth.welcomeTitle')}
      subtitle={next ? t('mobile.auth.chooseInstanceBody') : t('mobile.auth.welcomeBody')}
      heroBrand={!next}
      onBack={next || router.canGoBack() ? () => backOr(AUTH_PATHS.signIn) : undefined}
      footer={next ? null : <SavedAccountsList disabled={!!going} />}
      testID="instance-screen"
    >
      {next ? null : <SessionNotice />}
      <InstanceField picker={picker} autoFocus={!picker.value} onSubmit={() => void go(primary)} />
      <View style={{ gap: 12 }}>
        <Button
          title={label(primary)}
          fullWidth
          size="lg"
          loading={going === primary}
          disabled={!picker.value.trim() || resolving || (!!going && going !== primary)}
          onPress={() => void go(primary)}
          testID={`instance-${primary}`}
        />
        <Button
          title={label(secondary)}
          variant="outline"
          fullWidth
          loading={going === secondary}
          disabled={!picker.value.trim() || resolving || (!!going && going !== secondary)}
          onPress={() => void go(secondary)}
          testID={`instance-${secondary}`}
        />
      </View>
    </AuthScaffold>
  );
}
