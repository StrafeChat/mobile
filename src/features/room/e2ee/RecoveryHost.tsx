/**
 * The key-backup prompts (the web's RecoveryModal) as one bottom sheet, driven by the web's
 * stores/recoveryPrompt, which the backup flow (stores/e2eeBackup) awaits:
 *
 * - showCode - "Save your recovery code": the code, Copy, Save (the share sheet: Files, a
 *   password manager, Drive), the warning, "I've saved my recovery code", Done;
 * - enterCode - "Restore your messages": the code, re-grouped as it is typed with the caret
 *   kept in place, checked for typos locally before anything is sent; "I don't have my
 *   code", Later, Restore;
 * - enterLegacyPin - "Upgrade your backup": the old PIN, "I don't have my PIN", Later, Import.
 *
 * Swiping the sheet away is "Later" (the flow's 'dismissed'); nothing is committed until the
 * person answers. Unlike the web, the sheet stays up with a spinner while a code or PIN is
 * being checked (PBKDF2, the download and the import take a few seconds on a phone): a wrong
 * code re-opens the prompt with the error, and the sheet only closes when the flow is done
 * asking.
 */
import { useEffect, useRef, useState } from 'react';
import { Platform, View, type TextInputSelectionChangeEvent } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import {
  cancelRecoveryPrompt,
  recoveryPrompt,
  submitRecoveryPrompt,
  type RecoveryPromptKind,
} from '@web/stores/recoveryPrompt';
import { isWellFormedRecoveryCode } from '@web/lib/e2ee/recoveryCode';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Button, Checkbox, Input, Sheet, Spinner, Text, haptics, toast, withAlpha } from '@/ui';
import {
  LEGACY_PIN_MAX,
  LEGACY_PIN_MIN,
  caretAfterEdit,
  recoveryCodeComplete,
  reformatRecoveryInput,
  type Selection,
} from './recoveryInput';

/** How long the "checking" state waits for the flow to come back before letting go. */
const BUSY_TIMEOUT_MS = 30_000;

function CodeBlock({ code }: { code: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        paddingHorizontal: 14,
        paddingVertical: 12,
        borderRadius: theme.radii.md,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: withAlpha(theme.colors.muted, 0.4),
      }}
    >
      <Text variant="mono" align="center" selectable style={{ fontSize: theme.font(16), lineHeight: theme.font(24), letterSpacing: 2, writingDirection: 'ltr' }}>
        {code}
      </Text>
    </View>
  );
}

function ShowCodeView({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState(false);

  async function copy() {
    try {
      await Clipboard.setStringAsync(code);
      haptics.success();
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // The code is selectable, and Save still works.
    }
  }

  async function save() {
    // A named text file handed to the share sheet ("Save to Files", Drive, a password
    // manager), then removed from the app's cache: the code is not kept on the device.
    const file = new File(Paths.cache, 'strafe-recovery-code.txt');
    try {
      if (!(await Sharing.isAvailableAsync())) {
        toast.error(t('mobile.media.shareUnavailable'));
        return;
      }
      file.create({ overwrite: true });
      file.write(`${t('recovery.codeFileHeading')}\n\n${code}\n`);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/plain', dialogTitle: t('recovery.createTitle'), UTI: 'public.plain-text' });
      setSaved(true);
    } catch (e) {
      console.warn('[e2ee] could not share the recovery code file', e);
      toast.error(t('errors.unknown'));
    } finally {
      try {
        if (file.exists) file.delete();
      } catch {
        // Swept with the cache.
      }
    }
  }

  return (
    <View style={{ gap: 14 }}>
      <CodeBlock code={code} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button
          title={copied ? t('common.copied') : t('common.copy')}
          icon={copied ? 'check' : 'copy'}
          variant="outline"
          style={{ flex: 1 }}
          onPress={() => void copy()}
        />
        <Button title={t('mobile.room.saveCode')} icon="file-arrow-down" variant="outline" style={{ flex: 1 }} onPress={() => void save()} />
      </View>
      <Text variant="caption">{t('recovery.codeWarning')}</Text>
      <Checkbox checked={saved} onChange={setSaved} label={t('recovery.savedConfirm')} />
      <Button title={t('common.done')} disabled={!saved} fullWidth onPress={() => submitRecoveryPrompt('')} />
    </View>
  );
}

function EnterCodeView({ error, onSubmitted }: { error: string | null; onSubmitted: () => void }) {
  const [value, setValue] = useState('');
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 0 });
  const [malformed, setMalformed] = useState(false);
  const [checking, setChecking] = useState(false);
  const prev = useRef({ value: '', selection: { start: 0, end: 0 } as Selection });
  const complete = recoveryCodeComplete(value);

  function onChangeText(raw: string) {
    const caret = caretAfterEdit(prev.current.value, prev.current.selection, raw);
    const next = reformatRecoveryInput(raw, caret);
    const sel = { start: next.caret, end: next.caret };
    prev.current = { value: next.value, selection: sel };
    setValue(next.value);
    setSelection(sel);
    setMalformed(false);
  }

  function onSelectionChange(e: TextInputSelectionChangeEvent) {
    const sel = e.nativeEvent.selection;
    prev.current = { ...prev.current, selection: sel };
    setSelection(sel);
  }

  async function submit() {
    if (!complete || checking) return;
    setChecking(true);
    try {
      // A typo should read as a typo, not as "wrong code" - which a person hears as "your
      // history is gone".
      if (!(await isWellFormedRecoveryCode(value))) {
        setMalformed(true);
        haptics.error();
        return;
      }
      setMalformed(false);
      onSubmitted();
      submitRecoveryPrompt(value);
    } finally {
      setChecking(false);
    }
  }

  return (
    <View style={{ gap: 14 }}>
      <Input
        label={t('recovery.code')}
        value={value}
        selection={selection}
        onChangeText={onChangeText}
        onSelectionChange={onSelectionChange}
        placeholder={t('recovery.codePlaceholder')}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
        importantForAutofill="no"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => void submit()}
        error={(malformed ? t('recovery.codeMalformed') : error) || undefined}
        inputStyle={{ fontFamily: Platform.select({ ios: 'Menlo', default: 'monospace' }), letterSpacing: 1.5, textAlign: 'center', writingDirection: 'ltr' }}
      />
      <Button title={t('recovery.restore')} disabled={!complete} loading={checking} fullWidth onPress={() => void submit()} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={t('recovery.later')} variant="outline" style={{ flex: 1 }} onPress={() => cancelRecoveryPrompt('dismissed')} />
        <Button title={t('recovery.lostCode')} variant="ghost" style={{ flex: 1 }} onPress={() => cancelRecoveryPrompt('lostCode')} />
      </View>
    </View>
  );
}

function EnterPinView({ error, onSubmitted }: { error: string | null; onSubmitted: () => void }) {
  const [pin, setPin] = useState('');
  const [tooShort, setTooShort] = useState(false);
  function submit() {
    const value = pin.trim();
    if (value.length < LEGACY_PIN_MIN) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setPin('');
    onSubmitted();
    submitRecoveryPrompt(value);
  }
  return (
    <View style={{ gap: 14 }}>
      <Input
        label={t('recovery.pin')}
        value={pin}
        onChangeText={(v) => {
          setPin(v.replace(/\D/g, ''));
          setTooShort(false);
        }}
        placeholder={t('recovery.pinPlaceholder')}
        keyboardType="number-pad"
        secureTextEntry
        maxLength={LEGACY_PIN_MAX}
        autoComplete="off"
        autoCorrect={false}
        importantForAutofill="no"
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
        error={(tooShort ? t('recovery.pinTooShort') : error) || undefined}
        inputStyle={{ textAlign: 'center', letterSpacing: 4 }}
      />
      <Button title={t('recovery.importOld')} disabled={pin.trim().length < LEGACY_PIN_MIN} fullWidth onPress={submit} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={t('recovery.later')} variant="outline" style={{ flex: 1 }} onPress={() => cancelRecoveryPrompt('dismissed')} />
        <Button title={t('recovery.lostPin')} variant="ghost" style={{ flex: 1 }} onPress={() => cancelRecoveryPrompt('lostCode')} />
      </View>
    </View>
  );
}

function titleFor(kind: RecoveryPromptKind): { title: string; description: string } {
  switch (kind) {
    case 'showCode':
      return { title: t('recovery.createTitle'), description: t('recovery.createBody') };
    case 'enterCode':
      return { title: t('recovery.restoreTitle'), description: t('recovery.restoreBody') };
    default:
      return { title: t('recovery.migrateTitle'), description: t('recovery.migrateBody') };
  }
}

export function RecoveryHost() {
  const prompt = useSolid(() => {
    const p = recoveryPrompt.pending;
    return p ? { kind: p.kind, code: p.code ?? '' } : null;
  });
  const lastError = useSolid(() => recoveryPrompt.lastSubmitError);
  const storeError = useSolid(() => !!recoveryPrompt.e2eeStoreError || !!recoveryPrompt.e2eeEnvironmentError);
  /** A code or PIN was submitted and the flow is checking it. */
  const [busy, setBusy] = useState<RecoveryPromptKind | null>(null);
  const shown = useRef<{ kind: RecoveryPromptKind; code: string } | null>(null);
  if (prompt) shown.current = { kind: prompt.kind, code: prompt.code };

  // The flow answered: another prompt (a wrong code), an error dialog, or nothing more.
  useEffect(() => {
    if (prompt || storeError) setBusy(null);
  }, [prompt, storeError]);
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setBusy(null), BUSY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  const open = !!prompt || !!busy;
  const openRef = useRef(open);
  openRef.current = open;
  const view = shown.current;
  const head = view ? titleFor(view.kind) : null;

  return (
    <Sheet
      open={open}
      // Swiped away while a prompt is up: "Later". A close that follows the prompt being
      // answered is not a cancel (the next prompt may already be waiting).
      onClose={() => {
        if (openRef.current && recoveryPrompt.pending) cancelRecoveryPrompt('dismissed');
        setBusy(null);
      }}
      dismissible={!busy}
      title={head?.title}
      description={busy ? undefined : head?.description}
      icon="key"
      scrollable
      testID="recovery-sheet"
    >
      <View style={{ paddingTop: 12 }}>
        {busy ? (
          <View style={{ alignItems: 'center', gap: 12, paddingVertical: 24 }}>
            <Spinner />
            <Text align="center">{busy === 'enterLegacyPin' ? t('mobile.room.importingBackup') : t('mobile.room.restoringMessages')}</Text>
            <Button title={t('mobile.room.continueInBackground')} variant="ghost" onPress={() => setBusy(null)} />
          </View>
        ) : view?.kind === 'showCode' ? (
          <ShowCodeView key={view.code} code={view.code} />
        ) : view?.kind === 'enterCode' ? (
          <EnterCodeView error={lastError} onSubmitted={() => setBusy('enterCode')} />
        ) : view?.kind === 'enterLegacyPin' ? (
          <EnterPinView error={lastError} onSubmitted={() => setBusy('enterLegacyPin')} />
        ) : null}
      </View>
    </Sheet>
  );
}
