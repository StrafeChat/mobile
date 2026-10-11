/**
 * Why the person is looking at the sign-in screen when they did not sign out: the session
 * expired, was revoked (signed out everywhere, password reset), or the account was banned
 * (the web's ?reason= notice, plus "expired", which only the app notices). Read once when
 * the screen opens; signing in clears it, and so does dismissing it.
 */
import { useState } from 'react';
import { t } from '@web/i18n/t';
import { peekSignOutNotice, takeSignOutNotice, type SignOutReason } from '@/platform/session';
import { Banner } from '@/ui';

export function signOutNoticeText(reason: SignOutReason): string {
  switch (reason) {
    case 'banned':
      return t('auth.login.bannedNotice');
    case 'revoked':
      return t('auth.login.revokedNotice');
    default:
      return t('mobile.auth.sessionExpiredNotice');
  }
}

export function SessionNotice() {
  const [reason, setReason] = useState<SignOutReason | null>(() => peekSignOutNotice()?.reason ?? null);
  if (!reason) return null;
  return (
    <Banner
      tone={reason === 'banned' ? 'error' : 'warning'}
      icon={reason === 'banned' ? 'ban' : reason === 'revoked' ? 'right-from-bracket' : 'clock'}
      message={signOutNoticeText(reason)}
      onDismiss={() => {
        takeSignOutNotice();
        setReason(null);
      }}
      testID="session-notice"
    />
  );
}
