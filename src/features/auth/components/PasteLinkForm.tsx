/**
 * "Paste the link from the email": the way into the verify / reset screens when the email's
 * link opened in the browser instead of the app (it points at the instance's web domain,
 * which the app cannot claim for every self-hosted instance). Takes the whole link or just
 * its token.
 */
import { useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { t } from '@web/i18n/t';
import { Button, Input } from '@/ui';
import { tokenFromPaste, type AuthLinkKind } from '../logic/authLinks';

export function PasteLinkForm({
  kind,
  onToken,
  disabled,
  submitLabel,
}: {
  kind: AuthLinkKind;
  onToken: (found: { token: string; instance: string | null }) => void;
  disabled?: boolean;
  submitLabel: string;
}) {
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  const submit = (raw: string = value) => {
    const found = tokenFromPaste(raw, kind);
    if (!found) {
      setError(t('mobile.auth.linkInvalid'));
      return;
    }
    setError('');
    onToken(found);
  };

  const paste = async () => {
    const text = (await Clipboard.getStringAsync().catch(() => '')).trim();
    if (!text) return;
    setValue(text);
    submit(text);
  };

  return (
    <View style={{ gap: 12 }}>
      <Input
        label={t('mobile.auth.linkLabel')}
        placeholder={t('mobile.auth.linkPlaceholder')}
        hint={t('mobile.auth.linkHint')}
        value={value}
        onChangeText={(v) => {
          setError('');
          setValue(v);
        }}
        error={error}
        disabled={disabled}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        keyboardType="url"
        returnKeyType="go"
        onSubmitEditing={() => submit()}
        inputStyle={{ writingDirection: 'ltr' }}
        right={<Button title={t('mobile.auth.paste')} variant="link" disabled={disabled} onPress={() => void paste()} />}
        testID="paste-link-input"
      />
      <Button title={submitLabel} fullWidth size="lg" disabled={disabled || !value.trim()} onPress={() => submit()} testID="paste-link-submit" />
    </View>
  );
}
