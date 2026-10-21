/**
 * Bottom-sheet forms the settings pages share: a password confirmation (2FA changes, and the
 * key backup through PasswordPromptHost), a single text field (names, notes, reasons, email),
 * and the recovery-codes display.
 *
 * Each keeps itself open while its request runs (not dismissible, button busy) and shows the
 * server's error inside the sheet, as the web dialogs do.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Share, View } from 'react-native';
import { t } from '@web/i18n/t';
import { translateCaughtApiError } from '@web/lib/formatApiError';
import { useTheme } from '@/theme';
import { Button, FieldError, Input, Sheet, Text, TextArea, type DialogTone } from '@/ui';
import { useCopy } from '../hooks/useCopy';

/** The web's apiErrorText: the translated server error, or a generic line. */
export function errorText(err: unknown, fallbackKey = 'mobile.settings.genericError'): string {
  const lines = translateCaughtApiError(err, t);
  return lines.join(' ') || t(fallbackKey);
}

export interface PasswordPromptSheetProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  /**
   * An error the caller already knows about, shown until the user edits the field - a wrong
   * password reported by a previous attempt when the prompt is raised again (the web's
   * PasswordPromptDialog `error`).
   */
  error?: string;
  onConfirm: (password: string) => Promise<void>;
  onClose: () => void;
}

export function PasswordPromptSheet({ open, title, description, confirmLabel, tone = 'default', error: callerError, onConfirm, onClose }: PasswordPromptSheetProps) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  // null until this sheet has something of its own to say (or the user starts typing), so
  // that the caller's error shows first and typing clears it like any other.
  const [ownError, setOwnError] = useState<string | null>(null);
  const error = ownError ?? callerError ?? '';

  useEffect(() => {
    if (open) {
      setPassword('');
      setOwnError(null);
      setBusy(false);
    }
  }, [open]);

  async function submit() {
    if (!password || busy) return;
    setOwnError('');
    setBusy(true);
    try {
      await onConfirm(password);
    } catch (err) {
      setOwnError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title={title} description={description} icon="lock" tone={tone === 'danger' ? 'danger' : 'default'} dismissible={!busy} closeButton>
      <View style={{ gap: 12 }}>
        <Input
          label={t('settings.security.passwordPromptLabel')}
          value={password}
          onChangeText={(v) => {
            setOwnError('');
            setPassword(v);
          }}
          secureTextEntry
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
          error={error || undefined}
          disabled={busy}
        />
        <Button
          title={confirmLabel}
          variant={tone === 'danger' ? 'destructive' : 'primary'}
          loading={busy}
          disabled={!password}
          fullWidth
          onPress={() => void submit()}
        />
      </View>
    </Sheet>
  );
}

export interface TextPromptSheetProps {
  open: boolean;
  title: string;
  description?: string;
  icon?: string;
  tone?: DialogTone;
  label?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel: string;
  confirmVariant?: 'primary' | 'destructive';
  maxLength?: number;
  multiline?: boolean;
  /** Allow confirming with an empty value (an optional reason). */
  allowEmpty?: boolean;
  keyboardType?: 'default' | 'email-address' | 'number-pad' | 'url';
  autoCapitalize?: 'none' | 'sentences' | 'words';
  /** Extra content under the field (chips, a checkbox). */
  children?: ReactNode;
  onConfirm: (value: string) => Promise<void> | void;
  onClose: () => void;
}

export function TextPromptSheet({
  open,
  title,
  description,
  icon,
  tone,
  label,
  placeholder,
  initialValue = '',
  confirmLabel,
  confirmVariant = 'primary',
  maxLength,
  multiline,
  allowEmpty,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  children,
  onConfirm,
  onClose,
}: TextPromptSheetProps) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setError('');
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const canSubmit = allowEmpty || value.trim().length > 0;

  async function submit() {
    if (!canSubmit || busy) return;
    setBusy(true);
    setError('');
    try {
      await onConfirm(value);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const field = multiline ? (
    <TextArea
      label={label}
      placeholder={placeholder}
      value={value}
      onChangeText={(v) => {
        setError('');
        setValue(v);
      }}
      maxLength={maxLength}
      autoFocus
      disabled={busy}
      error={error || undefined}
      minRows={3}
    />
  ) : (
    <Input
      label={label}
      placeholder={placeholder}
      value={value}
      onChangeText={(v) => {
        setError('');
        setValue(v);
      }}
      maxLength={maxLength}
      autoFocus
      disabled={busy}
      error={error || undefined}
      keyboardType={keyboardType}
      autoCapitalize={autoCapitalize}
      autoCorrect={keyboardType === 'default'}
      returnKeyType="done"
      onSubmitEditing={() => void submit()}
    />
  );

  return (
    <Sheet open={open} onClose={onClose} title={title} description={description} icon={icon} tone={tone} dismissible={!busy} closeButton>
      <View style={{ gap: 14 }}>
        {field}
        {children}
        <Button title={confirmLabel} variant={confirmVariant} loading={busy} disabled={!canSubmit} fullWidth onPress={() => void submit()} />
      </View>
    </Sheet>
  );
}

export interface RecoveryCodesSheetProps {
  open: boolean;
  codes: readonly string[];
  title?: string;
  description?: string;
  onClose: () => void;
}

/** One-time codes in a two-column grid, with copy-all and the share sheet (save to Files). */
export function RecoveryCodesSheet({ open, codes, title, description, onClose }: RecoveryCodesSheetProps) {
  const theme = useTheme();
  const { copy, copied } = useCopy(2000);
  const text = codes.join('\n');
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title ?? t('settings.security.recoveryCodes.dialogTitle')}
      description={description ?? t('settings.security.recoveryCodes.dialogDescription')}
      icon="key"
      closeButton
    >
      <View style={{ gap: 12 }}>
        <View
          accessible
          accessibilityLabel={codes.join(', ')}
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            padding: 12,
            borderRadius: theme.radii.lg,
            borderWidth: 1,
            borderColor: theme.colors.border,
            backgroundColor: theme.colors.muted,
          }}
        >
          {codes.map((code) => (
            <View key={code} style={{ width: '50%', paddingVertical: 4 }}>
              <Text variant="mono" align="center" selectable>
                {code}
              </Text>
            </View>
          ))}
        </View>
        <Text variant="caption">{t('mobile.settings.codesScreenshotWarning')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            title={copied('codes') ? t('settings.security.recoveryCodes.copied') : t('settings.security.recoveryCodes.copyAll')}
            icon={copied('codes') ? 'check' : 'copy'}
            variant="outline"
            style={{ flex: 1 }}
            onPress={() => void copy('codes', text)}
          />
          <Button
            title={t('mobile.settings.share')}
            icon="share-nodes"
            variant="outline"
            style={{ flex: 1 }}
            onPress={() => void Share.share({ message: text }).catch(() => undefined)}
          />
        </View>
        <Button title={t('settings.security.recoveryCodes.done')} fullWidth onPress={onClose} />
      </View>
    </Sheet>
  );
}

/** An inline red error line, announced when it appears. */
export function InlineError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <FieldError message={message} />;
}
