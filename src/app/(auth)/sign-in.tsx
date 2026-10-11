/**
 * TEMPORARY sign-in used to bring the platform layer up on a device (instance + email +
 * password, TOTP if asked). The real sign-in, registration and account flows replace it
 * (src/features/auth).
 */
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { login, verifyTotp } from '@web/api/auth';
import { t } from '@web/i18n/t';
import { chooseInstance, completeSignIn, finishSignIn, suggestedInstance } from '@/platform/session';
import { Button, Input, Text } from '@/ui';
import { useTheme } from '@/theme';

export default function SignIn() {
  const theme = useTheme();
  const [instance, setInstance] = useState(suggestedInstance()?.domain ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      if (mfaToken) {
        const out = finishSignIn(await verifyTotp({ mfa_token: mfaToken, code } as never));
        if (out.kind === 'signed-in') return;
      }
      await chooseInstance(instance);
      const out = finishSignIn(await login({ email, password }));
      if (out.kind === 'second-factor') setMfaToken(out.mfaToken);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  void completeSignIn;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <Text variant="title">{t('auth.login.title')}</Text>
        {!mfaToken ? (
          <View style={{ gap: 12 }}>
            <Input label="Instance" value={instance} onChangeText={setInstance} autoCapitalize="none" autoCorrect={false} testID="instance" />
            <Input label={t('auth.login.email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" testID="email" />
            <Input label={t('auth.login.password')} value={password} onChangeText={setPassword} secureTextEntry testID="password" />
          </View>
        ) : (
          <Input label="Code" value={code} onChangeText={setCode} keyboardType="number-pad" testID="totp" />
        )}
        {error ? <Text tone="danger">{error}</Text> : null}
        <Button title={t('auth.login.submit')} onPress={() => void submit()} loading={busy} testID="submit" />
      </ScrollView>
    </SafeAreaView>
  );
}
