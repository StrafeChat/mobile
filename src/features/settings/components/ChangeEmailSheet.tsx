/**
 * Settings → Security → Change email (the web's ChangeEmailDialog): the new address, then a
 * re-authentication - the current password, plus an authenticator or recovery code when the
 * account has a second factor. Passkeys can't be used for this step-up (not in v1, and never
 * in the app), so a passkey-only account enters a recovery code.
 *
 * With email on, the server sends a confirmation link to the new address and nothing changes
 * until it is opened (`onDone(state, true)`); without it the change applies at once,
 * unverified (`onDone(state, false)`). The request itself is the web store's
 * `submitEmailChange`, which also keeps `accountEmail` up to date.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { isApiError } from '@web/api/ApiError';
import type { EmailChangeInput, EmailState } from '@web/api/users';
import { EMAIL_RE } from '@web/lib/emailChange';
import { submitEmailChange } from '@web/stores/accountEmail';
import { Button, FieldError, Input, MONO_FONT, Sheet, Text } from '@/ui';
import { errorText } from './sheets';

export interface ChangeEmailSheetProps {
  open: boolean;
  currentEmail: string;
  /** The instance can send email: the change waits for a link (copy and outcome differ). */
  mailEnabled: boolean;
  totpEnabled: boolean;
  hasPasskeys: boolean;
  onDone: (state: EmailState, sent: boolean) => void;
  onClose: () => void;
}

export function ChangeEmailSheet({ open, currentEmail, mailEnabled, totpEnabled, hasPasskeys, onDone, onClose }: ChangeEmailSheetProps) {
  const passkeyOnly = !totpEnabled && hasPasskeys;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(passkeyOnly);
  // The server said a second factor is needed though the status we had said none (it was
  // turned on in another session): show the field from then on.
  const [mfaRevealed, setMfaRevealed] = useState(false);
  const [emailErr, setEmailErr] = useState('');
  const [passwordErr, setPasswordErr] = useState('');
  const [codeErr, setCodeErr] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // A fresh form every time the sheet opens. The starting mode only; the toggle owns it from
  // then on.
  useEffect(() => {
    if (!open) return;
    setEmail('');
    setPassword('');
    setCode('');
    setUseRecovery(!totpEnabled && hasPasskeys);
    setMfaRevealed(false);
    setEmailErr('');
    setPasswordErr('');
    setCodeErr('');
    setError('');
    setBusy(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const showCode = totpEnabled || hasPasskeys || mfaRevealed;
  // Authenticator codes are offered unless we know the only factor is a passkey.
  const canTotp = totpEnabled || !hasPasskeys;

  function clearErrors() {
    setEmailErr('');
    setPasswordErr('');
    setCodeErr('');
    setError('');
  }

  async function submit() {
    if (busy) return;
    clearErrors();
    const addr = email.trim();
    if (!addr) return setEmailErr(t('auth.register.errors.emailRequired'));
    if (!EMAIL_RE.test(addr)) return setEmailErr(t('auth.register.errors.emailInvalid'));
    if (addr.toLowerCase() === currentEmail.trim().toLowerCase()) return setEmailErr(t('settings.security.email.change.errors.same'));
    if (!password) return setPasswordErr(t('auth.register.errors.passwordRequired'));
    const c = code.trim();
    if (showCode && !c) return setCodeErr(t('settings.security.email.change.errors.codeRequired'));

    const input: EmailChangeInput = { email: addr, password };
    if (showCode) {
      if (useRecovery) input.recovery_code = c;
      else input.code = c;
    }
    setBusy(true);
    try {
      const state = await submitEmailChange(input);
      setBusy(false);
      onDone(state, state.pending !== null);
    } catch (err) {
      if (isApiError(err) && err.code === 'mfa_required') setMfaRevealed(true);
      // A code is good for one try: a wrong or replayed one has to be typed again anyway.
      if (isApiError(err) && (err.code === 'invalid_code' || err.code === 'invalid_recovery_code')) setCode('');
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('settings.security.email.change.title')}
      description={mailEnabled ? t('settings.security.email.change.descriptionMail') : t('settings.security.email.change.descriptionNoMail')}
      icon="envelope"
      dismissible={!busy}
      closeButton
      scrollable
      testID="change-email-sheet"
    >
      <View style={{ gap: 12 }}>
        <Input
          label={t('settings.security.email.change.newLabel')}
          placeholder={t('settings.security.email.change.newPlaceholder')}
          value={email}
          onChangeText={(v) => {
            clearErrors();
            setEmail(v);
          }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          autoFocus
          returnKeyType="next"
          error={emailErr || undefined}
          disabled={busy}
          testID="change-email-address"
        />
        <Input
          label={t('settings.security.email.change.passwordLabel')}
          value={password}
          onChangeText={(v) => {
            clearErrors();
            setPassword(v);
          }}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType={showCode ? 'next' : 'done'}
          onSubmitEditing={showCode ? undefined : () => void submit()}
          error={passwordErr || undefined}
          disabled={busy}
          testID="change-email-password"
        />
        {showCode ? (
          <View style={{ gap: 8 }}>
            <Input
              key={useRecovery ? 'recovery' : 'totp'}
              label={useRecovery ? t('auth.login.mfa.recoveryLabel') : t('auth.login.mfa.totpLabel')}
              placeholder={useRecovery ? t('auth.login.mfa.recoveryPlaceholder') : t('auth.login.mfa.totpPlaceholder')}
              value={code}
              onChangeText={(v) => {
                clearErrors();
                setCode(v);
              }}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              keyboardType={useRecovery ? 'default' : 'number-pad'}
              textContentType={useRecovery ? 'none' : 'oneTimeCode'}
              autoComplete={useRecovery ? 'off' : 'one-time-code'}
              maxLength={useRecovery ? 64 : 10}
              inputStyle={{ fontFamily: MONO_FONT, writingDirection: 'ltr' }}
              returnKeyType="done"
              onSubmitEditing={() => void submit()}
              error={codeErr || undefined}
              hint={
                useRecovery
                  ? passkeyOnly
                    ? t('settings.security.email.change.passkeyOnlyHint')
                    : t('settings.security.email.change.recoveryHint')
                  : undefined
              }
              disabled={busy}
              testID="change-email-code"
            />
            {canTotp ? (
              <View style={{ alignItems: 'flex-start' }}>
                <Button
                  variant="link"
                  title={useRecovery ? t('auth.login.mfa.useTotp') : t('auth.login.mfa.useRecovery')}
                  disabled={busy}
                  onPress={() => {
                    clearErrors();
                    setCode('');
                    setUseRecovery((v) => !v);
                  }}
                  testID="change-email-toggle-recovery"
                />
              </View>
            ) : null}
          </View>
        ) : null}
        {error ? <FieldError message={error} /> : null}
        <Button
          title={mailEnabled ? t('settings.security.email.change.submitMail') : t('settings.security.email.change.submitNoMail')}
          loading={busy}
          fullWidth
          onPress={() => void submit()}
          testID="change-email-submit"
        />
        <Button title={t('common.cancel')} variant="ghost" fullWidth disabled={busy} onPress={onClose} />
      </View>
    </Sheet>
  );
}

/** "Check your new inbox": the request went through and a link is on its way. */
export function ChangeEmailSentSheet({ open, email, onClose }: { open: boolean; email: string; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title={t('settings.security.email.change.sentTitle')} icon="envelope-circle-check" closeButton testID="change-email-sent">
      <View style={{ gap: 14 }}>
        <Text>{t('settings.security.email.change.sentBody', { email })}</Text>
        <Button title={t('settings.security.email.change.done')} fullWidth onPress={onClose} />
      </View>
    </Sheet>
  );
}
