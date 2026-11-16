/**
 * Security (SecuritySettingsPage): the account's email - its verification, changing it, and a
 * change waiting for its confirmation link - the authenticator app (set up with a QR code, or opened straight in an authenticator on this
 * phone, or the secret copied), passkeys, and recovery codes. Every change is proven with a
 * code or the password, as on the web.
 *
 * Passkeys cannot be added from the app (WebAuthn needs the instance's web origin, which an
 * app on arbitrary self-hosted instances cannot claim), but ones added on the web are listed
 * and can be removed - that takes only the password.
 */
import { useEffect, useRef, useState } from 'react';
import { Linking, View } from 'react-native';
import { t, formatDate } from '@web/i18n/t';
import {
  deletePasskey,
  disableTotp,
  enableTotp,
  getTwoFactorStatus,
  regenerateRecoveryCodes,
  setupTotp,
  type TotpSetupResponse,
  type TwoFactorStatus,
} from '@web/api/twoFactor';
import { sendVerificationEmail } from '@web/api/users';
import {
  accountEmail,
  cancelPendingEmailChange,
  confirmPendingEmailChange,
  currentAccountEmail,
  loadAccountEmail,
  resendPendingEmailChange,
} from '@web/stores/accountEmail';
import { parseEmailChangeToken } from '@web/lib/emailChange';
import { loadInstanceInfo } from '@web/stores/instance';
import { useSolid } from '@/bridge/solid';
import { useInstance } from '@/data';
import { Button, Input, ListSection, MONO_FONT, Sheet, Spinner, Text, toast } from '@/ui';
import { useTheme } from '@/theme';
import { QrCode } from '../components/QrCode';
import { Note, SettingItem, StatusPill } from '../components/rows';
import { PasswordPromptSheet, RecoveryCodesSheet, TextPromptSheet, errorText } from '../components/sheets';
import { ChangeEmailSentSheet, ChangeEmailSheet } from '../components/ChangeEmailSheet';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { useCopy } from '../hooks/useCopy';

type ActiveSheet =
  | { kind: 'totpSetup' }
  | { kind: 'disableTotp' }
  | { kind: 'deletePasskey'; credentialId: string; name: string }
  | { kind: 'regenerateCodes' }
  | { kind: 'changeEmail' }
  | { kind: 'changeEmailSent'; email: string }
  | { kind: 'pasteEmailLink' }
  | null;

/** Status lines for the email rows, after an action on this screen. */
type EmailNotice = '' | 'changed' | 'cancelled';

/** Resend shares the server's one-a-minute cooldown with the request itself. */
const RESEND_LOCK_MS = 60_000;

function TotpSetupSheet({ open, onClose, onEnabled }: { open: boolean; onClose: () => void; onEnabled: (codes: string[] | null) => void }) {
  const theme = useTheme();
  const { copy, copied } = useCopy();
  const [setup, setSetup] = useState<TotpSetupResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    let live = true;
    setSetup(null);
    setCode('');
    setError('');
    setLoading(true);
    setupTotp()
      .then((res) => live && setSetup(res))
      .catch((err) => live && setError(errorText(err)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [open]);

  async function submit() {
    const c = code.trim();
    if (!c || busy) return;
    setError('');
    setBusy(true);
    try {
      const res = await enableTotp(c);
      onEnabled(res.recovery_codes);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function openAuthenticator() {
    if (!setup) return;
    try {
      await Linking.openURL(setup.otpauth_url);
    } catch {
      toast.info(t('mobile.settings.noAuthenticatorApp'));
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t('settings.security.totp.setupTitle')}
      description={t('mobile.settings.totpSetupDescription')}
      icon="mobile-screen-button"
      dismissible={!busy}
      closeButton
      scrollable
    >
      {loading ? (
        <Spinner fill />
      ) : (
        <View style={{ gap: 14 }}>
          {setup ? (
            <>
              <View style={{ alignItems: 'center' }}>
                <QrCode value={setup.otpauth_url} size={200} accessibilityLabel={t('mobile.settings.totpQrLabel')} />
              </View>
              <Button title={t('mobile.settings.openInAuthenticator')} icon="arrow-up-right-from-square" variant="secondary" fullWidth onPress={() => void openAuthenticator()} />
              <View style={{ gap: 6 }}>
                <Text variant="caption">{t('settings.security.totp.manualEntryHint')}</Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 8,
                    padding: 10,
                    borderRadius: theme.radii.md,
                    borderWidth: 1,
                    borderColor: theme.colors.border,
                    backgroundColor: theme.colors.muted,
                  }}
                >
                  <Text selectable style={{ flex: 1, fontFamily: MONO_FONT, writingDirection: 'ltr' }}>
                    {setup.secret}
                  </Text>
                  <Button
                    title={copied('secret') ? t('common.copied') : t('common.copy')}
                    size="sm"
                    variant="outline"
                    onPress={() => void copy('secret', setup.secret)}
                  />
                </View>
              </View>
            </>
          ) : null}
          <Input
            label={t('settings.security.totp.confirmLabel')}
            placeholder={t('settings.security.totp.confirmPlaceholder')}
            value={code}
            onChangeText={(v) => {
              setError('');
              setCode(v);
            }}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            maxLength={10}
            error={error || undefined}
            disabled={busy || !setup}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            testID="totp-code"
          />
          <Button title={t('settings.security.totp.enable')} loading={busy} disabled={!code.trim() || !setup} fullWidth onPress={() => void submit()} />
        </View>
      )}
    </Sheet>
  );
}

export function SecurityScreen() {
  useLocale();
  const instanceInfo = useInstance();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [sheet, setSheet] = useState<ActiveSheet>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  // The account's address, whether a link sent to it was ever opened, and any change waiting
  // for confirmation (the web's stores/accountEmail; live through USER_EMAIL_UPDATE). The
  // section shows whether or not the instance can send email - only verifying needs that.
  const emailState = useSolid(() => currentAccountEmail());
  const changeSupported = useSolid(() => accountEmail.supported);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [sendError, setSendError] = useState('');
  const [notice, setNotice] = useState<EmailNotice>('');
  const [resendBusy, setResendBusy] = useState(false);
  const [resendLocked, setResendLocked] = useState(false);
  const [resendNotice, setResendNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [cancelBusy, setCancelBusy] = useState(false);
  const resendTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(resendTimer.current), []);

  function lockResend() {
    clearTimeout(resendTimer.current);
    setResendLocked(true);
    resendTimer.current = setTimeout(() => setResendLocked(false), RESEND_LOCK_MS);
  }

  function loadEmail() {
    void loadInstanceInfo();
    // A failed load leaves the section as it was; the 2FA sections do not depend on it.
    void loadAccountEmail();
  }

  async function refresh(asPull = false) {
    if (asPull) setRefreshing(true);
    else setLoading(true);
    try {
      setStatus(await getTwoFactorStatus());
      setError('');
    } catch {
      setError(t('settings.security.loadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadEmail();
    void refresh();
  }, []);

  async function sendVerification() {
    setSendError('');
    setSendState('sending');
    try {
      await sendVerificationEmail();
      setSendState('sent');
    } catch (err) {
      setSendError(errorText(err));
      setSendState('idle');
    }
  }

  async function resend() {
    setResendNotice('');
    setActionError('');
    setResendBusy(true);
    try {
      await resendPendingEmailChange();
      lockResend();
      setResendNotice(t('settings.security.email.pending.resent'));
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setResendBusy(false);
    }
  }

  async function cancelChange() {
    setResendNotice('');
    setActionError('');
    setCancelBusy(true);
    try {
      await cancelPendingEmailChange();
      setNotice('cancelled');
    } catch (err) {
      setActionError(errorText(err));
    } finally {
      setCancelBusy(false);
    }
  }

  /** The address moved (a direct change, or a pasted link): the old send state no longer
   * describes it. */
  function emailChanged() {
    setSendState('idle');
    setSendError('');
    setResendNotice('');
    setActionError('');
    setNotice('changed');
  }

  function emailHint(verified: boolean): string {
    if (notice === 'changed') return t('settings.security.email.change.changed');
    if (notice === 'cancelled') return t('settings.security.email.pending.cancelled');
    if (!instanceInfo.emailEnabled) return t('settings.security.email.noMailHint');
    if (verified) return t('settings.security.email.verifiedHint');
    return sendState === 'sent' ? t('settings.security.email.sent') : t('settings.security.email.unverifiedHint');
  }

  const s = status;
  const hasSecondFactor = !!s && (s.totp_enabled || s.webauthn_credentials.length > 0);
  const info = emailState?.email.includes('@') ? emailState : null;
  const pending = info?.pending ?? null;

  return (
    <SettingsScreen
      title={t('settings.sections.security.title')}
      error={error}
      refreshing={refreshing}
      onRefresh={() => {
        void loadEmail();
        void refresh(true);
      }}
      testID="settings-security"
    >
      {info ? (
        <ListSection title={t('settings.security.email.sectionTitle')}>
          <SettingItem
            icon="envelope"
            title={info.email}
            titleAccessory={
              // Verification means something only where the instance can send the link.
              instanceInfo.emailEnabled ? (
                <StatusPill
                  label={info.verified_email ? t('settings.security.email.verified') : t('settings.security.email.unverified')}
                  tone={info.verified_email ? 'success' : 'warning'}
                />
              ) : null
            }
            description={sendError ? undefined : emailHint(info.verified_email)}
            error={sendError}
            testID="security-email"
          />
          {instanceInfo.emailEnabled && !info.verified_email && !pending ? (
            <SettingItem
              icon="paper-plane"
              title={t('settings.security.email.send')}
              busy={sendState === 'sending'}
              disabled={sendState === 'sent'}
              onPress={() => void sendVerification()}
              testID="security-send-verification"
            />
          ) : null}
          {changeSupported ? (
            <SettingItem
              icon="pen"
              title={t('settings.security.email.change.title')}
              chevron
              disabled={loading}
              onPress={() => {
                setNotice('');
                setSheet({ kind: 'changeEmail' });
              }}
              testID="security-change-email"
            />
          ) : null}
          {pending ? (
            <>
              <SettingItem
                icon="clock"
                title={t('settings.security.email.pending.title')}
                description={t('settings.security.email.pending.body', {
                  email: pending.email,
                  time: formatDate(pending.expires_at, { timeStyle: 'short' }),
                })}
                error={actionError}
                testID="security-email-pending"
              />
              <SettingItem
                icon="rotate-right"
                title={t('settings.security.email.pending.resend')}
                description={resendNotice || undefined}
                busy={resendBusy}
                disabled={resendLocked || cancelBusy}
                onPress={() => void resend()}
                testID="security-email-resend"
              />
              <SettingItem
                icon="link"
                title={t('settings.security.email.pending.paste')}
                chevron
                disabled={cancelBusy}
                onPress={() => setSheet({ kind: 'pasteEmailLink' })}
                testID="security-email-paste"
              />
              <SettingItem
                icon="xmark"
                title={t('settings.security.email.pending.cancel')}
                destructive
                busy={cancelBusy}
                disabled={resendBusy}
                onPress={() => void cancelChange()}
                testID="security-email-cancel"
              />
            </>
          ) : null}
        </ListSection>
      ) : null}

      {loading && !s ? (
        <Spinner fill />
      ) : s ? (
        <>
          <ListSection title={t('settings.security.totp.sectionTitle')}>
            <SettingItem
              icon="mobile-screen-button"
              title={t('settings.security.totp.rowTitle')}
              description={s.totp_enabled ? t('settings.security.totp.enabledHint') : t('settings.security.totp.disabledHint')}
              titleAccessory={s.totp_enabled ? <StatusPill label={t('common.enabled')} tone="success" /> : null}
            />
            {s.totp_enabled ? (
              <SettingItem icon="ban" title={t('settings.security.totp.disable')} destructive onPress={() => setSheet({ kind: 'disableTotp' })} testID="security-totp-disable" />
            ) : (
              <SettingItem icon="plus" title={t('settings.security.totp.enable')} chevron onPress={() => setSheet({ kind: 'totpSetup' })} testID="security-totp-enable" />
            )}
          </ListSection>

          <ListSection title={t('settings.security.passkeys.sectionTitle')} footer={t('mobile.settings.passkeysAddOnWeb')}>
            {s.webauthn_credentials.length === 0 ? (
              <SettingItem icon="passport" title={t('settings.security.passkeys.empty')} />
            ) : (
              s.webauthn_credentials.map((cred) => (
                <SettingItem
                  key={cred.id}
                  icon="passport"
                  title={cred.name}
                  description={t('settings.security.passkeys.added', { when: formatDate(cred.created_at, { dateStyle: 'medium' }) })}
                  trailing={
                    <Button
                      title={t('settings.security.passkeys.remove')}
                      size="sm"
                      variant="destructive"
                      onPress={() => setSheet({ kind: 'deletePasskey', credentialId: cred.id, name: cred.name })}
                    />
                  }
                />
              ))
            )}
          </ListSection>

          {hasSecondFactor ? (
            <ListSection title={t('settings.security.recoveryCodes.sectionTitle')}>
              <SettingItem
                icon="key"
                title={t('settings.security.recoveryCodes.rowTitle')}
                description={t('settings.security.recoveryCodes.remaining', { count: s.recovery_codes_remaining })}
              />
              <SettingItem icon="rotate" title={t('settings.security.recoveryCodes.regenerate')} onPress={() => setSheet({ kind: 'regenerateCodes' })} />
            </ListSection>
          ) : null}
        </>
      ) : (
        <Note>{t('settings.security.loadFailed')}</Note>
      )}

      <TotpSetupSheet
        open={sheet?.kind === 'totpSetup'}
        onClose={() => setSheet((cur) => (cur?.kind === 'totpSetup' ? null : cur))}
        onEnabled={(newCodes) => {
          void refresh(true);
          setSheet(null);
          if (newCodes) setCodes(newCodes);
          toast.success(t('mobile.settings.totpEnabled'));
        }}
      />
      <PasswordPromptSheet
        open={sheet?.kind === 'disableTotp'}
        title={t('settings.security.totp.disableTitle')}
        description={t('settings.security.totp.disableDescription')}
        confirmLabel={t('settings.security.totp.disable')}
        tone="danger"
        onConfirm={async (password) => {
          await disableTotp(password);
          setSheet(null);
          await refresh(true);
        }}
        onClose={() => setSheet((cur) => (cur?.kind === 'disableTotp' ? null : cur))}
      />
      <PasswordPromptSheet
        open={sheet?.kind === 'deletePasskey'}
        title={t('settings.security.passkeys.removeTitle')}
        description={sheet?.kind === 'deletePasskey' ? t('settings.security.passkeys.removeDescription', { name: sheet.name }) : undefined}
        confirmLabel={t('settings.security.passkeys.remove')}
        tone="danger"
        onConfirm={async (password) => {
          if (sheet?.kind !== 'deletePasskey') return;
          await deletePasskey(sheet.credentialId, password);
          setSheet(null);
          await refresh(true);
        }}
        onClose={() => setSheet((cur) => (cur?.kind === 'deletePasskey' ? null : cur))}
      />
      <PasswordPromptSheet
        open={sheet?.kind === 'regenerateCodes'}
        title={t('settings.security.recoveryCodes.regenerateTitle')}
        description={t('settings.security.recoveryCodes.regenerateDescription')}
        confirmLabel={t('settings.security.recoveryCodes.regenerate')}
        onConfirm={async (password) => {
          const res = await regenerateRecoveryCodes(password);
          setSheet(null);
          setCodes(res.recovery_codes);
          await refresh(true);
        }}
        onClose={() => setSheet((cur) => (cur?.kind === 'regenerateCodes' ? null : cur))}
      />
      <RecoveryCodesSheet open={!!codes} codes={codes ?? []} onClose={() => setCodes(null)} />
      <ChangeEmailSheet
        open={sheet?.kind === 'changeEmail'}
        currentEmail={info?.email ?? ''}
        mailEnabled={instanceInfo.emailEnabled}
        totpEnabled={s?.totp_enabled === true}
        hasPasskeys={(s?.webauthn_credentials.length ?? 0) > 0}
        onDone={(state, sent) => {
          if (sent && state.pending) {
            // The request was a 202, which starts the same one-minute cooldown as a resend.
            lockResend();
            setResendNotice('');
            setActionError('');
            setSheet({ kind: 'changeEmailSent', email: state.pending.email });
          } else {
            emailChanged();
            setSheet(null);
          }
        }}
        onClose={() => setSheet((cur) => (cur?.kind === 'changeEmail' ? null : cur))}
      />
      <ChangeEmailSentSheet
        open={sheet?.kind === 'changeEmailSent'}
        email={sheet?.kind === 'changeEmailSent' ? sheet.email : ''}
        onClose={() => setSheet((cur) => (cur?.kind === 'changeEmailSent' ? null : cur))}
      />
      <TextPromptSheet
        open={sheet?.kind === 'pasteEmailLink'}
        title={t('settings.security.email.paste.title')}
        description={t('settings.security.email.paste.description', { email: pending?.email ?? '' })}
        icon="link"
        label={t('settings.security.email.paste.label')}
        placeholder={t('settings.security.email.paste.placeholder')}
        confirmLabel={t('settings.security.email.paste.submit')}
        keyboardType="url"
        autoCapitalize="none"
        validate={(value) => (parseEmailChangeToken(value) ? null : t('settings.security.email.paste.invalid'))}
        onConfirm={async (value) => {
          const token = parseEmailChangeToken(value);
          if (!token) return;
          await confirmPendingEmailChange(token);
          emailChanged();
          setSheet(null);
        }}
        onClose={() => setSheet((cur) => (cur?.kind === 'pasteEmailLink' ? null : cur))}
      />
    </SettingsScreen>
  );
}
