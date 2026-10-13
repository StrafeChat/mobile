/**
 * Security (SecuritySettingsPage): the account's email and its verification, the
 * authenticator app (set up with a QR code, or opened straight in an authenticator on this
 * phone, or the secret copied), passkeys, and recovery codes. Every change is proven with a
 * code or the password, as on the web.
 *
 * Passkeys cannot be added from the app (WebAuthn needs the instance's web origin, which an
 * app on arbitrary self-hosted instances cannot claim), but ones added on the web are listed
 * and can be removed - that takes only the password.
 */
import { useEffect, useState } from 'react';
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
import { getMe, sendVerificationEmail } from '@web/api/users';
import { loadInstanceInfo } from '@web/stores/instance';
import { useInstance } from '@/data';
import { Button, Input, ListSection, MONO_FONT, Sheet, Spinner, Text, toast } from '@/ui';
import { useTheme } from '@/theme';
import { QrCode } from '../components/QrCode';
import { Note, SettingItem, StatusPill } from '../components/rows';
import { PasswordPromptSheet, RecoveryCodesSheet, errorText } from '../components/sheets';
import { SettingsScreen } from '../components/SettingsScreen';
import { useLocale } from '../hooks/useLocale';
import { useCopy } from '../hooks/useCopy';

type ActiveSheet =
  | { kind: 'totpSetup' }
  | { kind: 'disableTotp' }
  | { kind: 'deletePasskey'; credentialId: string; name: string }
  | { kind: 'regenerateCodes' }
  | null;

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
  const [emailInfo, setEmailInfo] = useState<{ email: string; verified: boolean } | null>(null);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [sendError, setSendError] = useState('');

  async function loadEmail() {
    void loadInstanceInfo();
    try {
      const me = await getMe();
      if (me.email) setEmailInfo({ email: me.email, verified: me.verified_email === true });
    } catch {
      // The 2FA sections do not depend on this; a failed load just hides the row.
    }
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

  const s = status;
  const hasSecondFactor = !!s && (s.totp_enabled || s.webauthn_credentials.length > 0);

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
      {instanceInfo.emailEnabled && emailInfo ? (
        <ListSection title={t('settings.security.email.sectionTitle')}>
          <SettingItem
            icon="envelope"
            title={emailInfo.email}
            titleAccessory={
              <StatusPill
                label={emailInfo.verified ? t('settings.security.email.verified') : t('settings.security.email.unverified')}
                tone={emailInfo.verified ? 'success' : 'warning'}
              />
            }
            description={
              sendError
                ? undefined
                : emailInfo.verified
                  ? t('settings.security.email.verifiedHint')
                  : sendState === 'sent'
                    ? t('settings.security.email.sent')
                    : t('settings.security.email.unverifiedHint')
            }
            error={sendError}
          />
          {!emailInfo.verified ? (
            <SettingItem
              icon="paper-plane"
              title={t('settings.security.email.send')}
              busy={sendState === 'sending'}
              disabled={sendState === 'sent'}
              onPress={() => void sendVerification()}
              testID="security-send-verification"
            />
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
    </SettingsScreen>
  );
}
