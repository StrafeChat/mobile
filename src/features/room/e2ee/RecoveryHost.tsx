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
 * code re-opens the prompt with the error (and the code as typed, to correct), and the sheet
 * closes once the restore or import has finished (the overrides' keyBackupActivity) and the
 * flow has nothing more to ask.
 *
 * The keyboard is put away whenever an input view is answered, cancelled or closed: the
 * sheet's text field unmounts with the sheet, and an Android keyboard whose field has gone
 * stays up over the app with nothing left to dismiss it.
 */
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, View, type TextInputSelectionChangeEvent } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import {
  cancelRecoveryPrompt,
  recoveryPrompt,
  submitRecoveryPrompt,
  type RecoveryPromptKind,
} from '@web/stores/recoveryPrompt';
import { confirmDialogState } from '@web/stores/confirmDialog';
import { formatRecoveryCode, isWellFormedRecoveryCode } from '@web/lib/e2ee/recoveryCode';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { keyBackupActivity } from '@/platform/overrides/e2ee/backupActivity';
import { useTheme } from '@/theme';
import { Button, Checkbox, Input, Sheet, Spinner, Text, haptics, toast, withAlpha } from '@/ui';
import { LEGACY_PIN_MAX, LEGACY_PIN_MIN, normalizePinInput, recoveryCodeComplete } from './recoveryInput';

/**
 * After the restore or import a submission started has ended: how long to wait for the flow's
 * next question (a wrong code re-asks, a PIN import goes on to show the new code) before
 * closing, so the sheet does not drop and re-open between the two.
 */
const FOLLOW_UP_GRACE_MS = 600;
/** A submission that never starts a tracked operation (a PIN backup with no keys in it, say). */
const BUSY_TIMEOUT_MS = 30_000;

/** Put the keyboard away while the focused field still exists, then do `then`. */
function closingKeyboard(then: () => void): () => void {
  return () => {
    Keyboard.dismiss();
    then();
  };
}

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

/** The file Save hands to the share sheet; it exists only while the share sheet is up. */
const CODE_FILE_NAME = 'strafe-recovery-code.txt';

/**
 * Remove a code file a Save left behind: the app can be killed while the share sheet is in
 * front (it is in the background then), before its `finally` runs - which would leave the
 * one secret that opens the whole message history sitting in the cache directory.
 */
function sweepCodeFile(): void {
  try {
    const file = new File(Paths.cache, CODE_FILE_NAME);
    if (file.exists) file.delete();
  } catch {
    // Nothing there, or the cache is already gone.
  }
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
    const file = new File(Paths.cache, CODE_FILE_NAME);
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

function EnterCodeView({
  error,
  initialValue,
  onSubmitted,
}: {
  error: string | null;
  /** The code that was just refused, so one wrong character can be fixed in place. */
  initialValue: string;
  onSubmitted: (code: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [malformed, setMalformed] = useState(false);
  const [checking, setChecking] = useState(false);
  const caret = useRef({ start: 0, end: 0 });
  const complete = recoveryCodeComplete(value);

  // Typing or pasting at the end (nearly every edit) re-groups into blocks of four as you go.
  // An edit in the middle is left as typed until the field loses focus: re-grouping there
  // means moving the caret from JS, and a controlled caret races fast typing on Android (the
  // native caret has already moved on). Dashes are ignored when the code is read, so a
  // half-grouped code still restores.
  function onChangeText(raw: string) {
    const atEnd = caret.current.start >= value.length;
    setValue(atEnd ? formatRecoveryCode(raw) : raw);
    setMalformed(false);
  }

  function onSelectionChange(e: TextInputSelectionChangeEvent) {
    caret.current = e.nativeEvent.selection;
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
      Keyboard.dismiss();
      onSubmitted(value);
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
        onChangeText={onChangeText}
        onSelectionChange={onSelectionChange}
        onBlur={() => setValue((v) => formatRecoveryCode(v))}
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
        <Button title={t('recovery.later')} variant="outline" style={{ flex: 1 }} onPress={closingKeyboard(() => cancelRecoveryPrompt('dismissed'))} />
        <Button title={t('recovery.lostCode')} variant="ghost" style={{ flex: 1 }} onPress={closingKeyboard(() => cancelRecoveryPrompt('lostCode'))} />
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
    Keyboard.dismiss();
    onSubmitted();
    submitRecoveryPrompt(value);
  }
  return (
    <View style={{ gap: 14 }}>
      <Input
        label={t('recovery.pin')}
        value={pin}
        onChangeText={(v) => {
          setPin(normalizePinInput(v));
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
        <Button title={t('recovery.later')} variant="outline" style={{ flex: 1 }} onPress={closingKeyboard(() => cancelRecoveryPrompt('dismissed'))} />
        <Button title={t('recovery.lostPin')} variant="ghost" style={{ flex: 1 }} onPress={closingKeyboard(() => cancelRecoveryPrompt('lostCode'))} />
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
  /** The flow moved on to a confirmation ("start a new backup?", "delete the old one?"). */
  const confirming = useSolid(() => !!confirmDialogState.pending);
  const activity = useSolid(() => ({
    running: keyBackupActivity.running,
    settled: keyBackupActivity.settled,
    outcome: keyBackupActivity.lastOutcome,
  }));
  /**
   * A code or PIN was submitted and the flow is checking it; `settled` is the activity count
   * at that moment, so a later count means the operation it started has ended.
   */
  const [busy, setBusy] = useState<{ kind: RecoveryPromptKind; settled: number } | null>(null);
  const shown = useRef<{ kind: RecoveryPromptKind; code: string } | null>(null);
  if (prompt) shown.current = { kind: prompt.kind, code: prompt.code };
  /** The recovery code last submitted - offered back if the flow re-asks after a wrong code. */
  const lastCode = useRef('');

  // The flow answered: another prompt (a wrong code), an error dialog, a confirmation.
  useEffect(() => {
    if (prompt || storeError || confirming) setBusy(null);
  }, [prompt, storeError, confirming]);

  // The operation the submission started has ended: close, unless the flow asks something
  // next. Nothing tracked running yet (the PIN is still being checked, or the flow took a path
  // that imports nothing): let go after BUSY_TIMEOUT_MS. A long restore keeps the spinner.
  useEffect(() => {
    if (!busy || activity.running) return;
    const finished = activity.settled !== busy.settled;
    const timer = setTimeout(
      () => {
        if (finished && activity.outcome === 'succeeded') haptics.success();
        setBusy(null);
      },
      finished ? FOLLOW_UP_GRACE_MS : BUSY_TIMEOUT_MS,
    );
    return () => clearTimeout(timer);
  }, [busy, activity.running, activity.settled, activity.outcome]);

  const open = !!prompt || !!busy;
  const openRef = useRef(open);
  openRef.current = open;

  // However it closed (answered, cancelled, swiped, or closed by the flow), the keyboard goes
  // with it - while the field is still mounted, which it is until the sheet has slid away.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) {
      Keyboard.dismiss();
      lastCode.current = '';
    }
    wasOpen.current = open;
  }, [open]);

  useEffect(sweepCodeFile, []);

  const begin = (kind: RecoveryPromptKind) => setBusy({ kind, settled: keyBackupActivity.settled });

  const view = shown.current;
  const head = view ? titleFor(view.kind) : null;

  return (
    <Sheet
      open={open}
      // Swiped away while a prompt is up: "Later". A close that follows the prompt being
      // answered is not a cancel (the next prompt may already be waiting).
      onClose={() => {
        Keyboard.dismiss();
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
            <Text align="center" accessibilityLiveRegion="polite">
              {busy.kind === 'enterLegacyPin' ? t('mobile.room.importingBackup') : t('mobile.room.restoringMessages')}
            </Text>
            <Button title={t('mobile.room.continueInBackground')} variant="ghost" onPress={() => setBusy(null)} />
          </View>
        ) : view?.kind === 'showCode' ? (
          <ShowCodeView key={view.code} code={view.code} />
        ) : view?.kind === 'enterCode' ? (
          <EnterCodeView
            error={lastError}
            initialValue={lastError ? lastCode.current : ''}
            onSubmitted={(code) => {
              lastCode.current = code;
              begin('enterCode');
            }}
          />
        ) : view?.kind === 'enterLegacyPin' ? (
          <EnterPinView error={lastError} onSubmitted={() => begin('enterLegacyPin')} />
        ) : null}
      </View>
    </Sheet>
  );
}
