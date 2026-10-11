/**
 * Create a space, or join one with an invite (CreateSpaceModal's two forms, as two segments of
 * one screen - /create-space opens on Create, /join-space on Join).
 *
 * Create: a name (required, max 100) and a description (optional, max 500); POST /spaces, store
 * it, and show its rooms. Join: an invite link from any Strafe instance, a code, or
 * `code@instance` for a space hosted elsewhere - with Paste for the clipboard - which opens the
 * invite preview. A link from another instance becomes `code@thatinstance` (invites.ts).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { t } from '@web/i18n/t';
import { createSpace } from '@web/api/spaces';
import { addOrUpdateSpace } from '@web/stores/spaces';
import { useTheme } from '@/theme';
import { Button, Header, Input, SegmentedControl, Text } from '@/ui';
import { errorMessage } from '../actions';
import { inviteCodeFromAnyInput } from '../invites';
import { goBack, goToSpace, replaceRoute } from '../navigation';

export type CreateSpaceMode = 'create' | 'join';

function CreateForm() {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const n = name.trim();
    setError('');
    if (!n) {
      setError(t('common.nameRequired'));
      return;
    }
    setLoading(true);
    try {
      const space = await createSpace({ name: n, description: description.trim() || undefined });
      addOrUpdateSpace(space);
      goToSpace(space.id);
    } catch (err) {
      setError(errorMessage(err, 'createSpace.failed'));
      setLoading(false);
    }
  }

  return (
    <View style={styles.form}>
      <Text tone="muted">{t('createSpace.description')}</Text>
      <Input
        label={t('common.name')}
        value={name}
        onChangeText={(v) => {
          setName(v);
          setError('');
        }}
        placeholder={t('createSpace.namePlaceholder')}
        maxLength={100}
        disabled={loading}
        error={error || undefined}
        required
        autoFocus
        returnKeyType="next"
      />
      <Input
        label={t('createSpace.descriptionLabel')}
        value={description}
        onChangeText={setDescription}
        placeholder={t('createSpace.descriptionPlaceholder')}
        maxLength={500}
        disabled={loading}
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
      />
      <Button title={t('createSpace.submit')} fullWidth loading={loading} disabled={!name.trim()} onPress={() => void submit()} />
    </View>
  );
}

function JoinForm() {
  const [invite, setInvite] = useState('');
  const [error, setError] = useState('');

  function submit(raw = invite) {
    const code = inviteCodeFromAnyInput(raw);
    if (!code) {
      setError(t('createSpace.invalidInvite'));
      return;
    }
    setError('');
    replaceRoute(`/invite/${encodeURIComponent(code)}`);
  }

  async function paste() {
    try {
      const text = (await Clipboard.getStringAsync()).trim();
      if (!text) return;
      setInvite(text);
      setError('');
      if (inviteCodeFromAnyInput(text)) submit(text);
    } catch {
      /* clipboard unavailable: type it */
    }
  }

  return (
    <View style={styles.form}>
      <Input
        label={t('createSpace.haveInvite')}
        value={invite}
        onChangeText={(v) => {
          setInvite(v);
          setError('');
        }}
        placeholder={t('createSpace.invitePlaceholder')}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        keyboardType="url"
        error={error || undefined}
        autoFocus
        returnKeyType="go"
        onSubmitEditing={() => submit()}
        right={<Button title={t('mobile.nav.paste')} variant="ghost" size="sm" icon="fa-paste" onPress={() => void paste()} />}
      />
      <Button title={t('createSpace.joinWithInvite')} fullWidth disabled={!invite.trim()} onPress={() => submit()} />
    </View>
  );
}

export function CreateSpaceScreen({ initialMode = 'create' }: { initialMode?: CreateSpaceMode }) {
  const theme = useTheme();
  const [mode, setMode] = useState<CreateSpaceMode>(initialMode);
  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.background }]}>
      <Header title={mode === 'create' ? t('home.createSpace') : t('invite.joinSpace')} onBack={goBack} />
      <KeyboardAwareScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled" bottomOffset={24}>
        <View style={styles.inner}>
          <SegmentedControl<CreateSpaceMode>
            value={mode}
            onChange={setMode}
            items={[
              { id: 'create', label: t('common.create'), icon: 'fa-plus' },
              { id: 'join', label: t('mobile.nav.join'), icon: 'fa-right-to-bracket' },
            ]}
          />
          {mode === 'create' ? <CreateForm /> : <JoinForm />}
        </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scroll: { flexGrow: 1, padding: 20, alignItems: 'center' },
  inner: { width: '100%', maxWidth: 520, gap: 20 },
  form: { gap: 16 },
});
