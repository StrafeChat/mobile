/**
 * Invite people to a space (InviteSpaceModal): one invite is created when the sheet opens
 * (server defaults; once per open - a failure is retried only by "Generate new link"), shown
 * as `<instance>/invite/<code>`, with the system share sheet first and Copy beside it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { createSpaceInvite } from '@web/api/spaces';
import { useTheme } from '@/theme';
import { Button, FieldError, FieldLabel, Sheet, Text, haptics, withAlpha } from '@/ui';
import { copyText, errorMessage } from '../actions';
import { inviteLink } from '../invites';

export interface InviteSheetProps {
  spaceId: string;
  open: boolean;
  onRequestClose: () => void;
  onClosed: () => void;
}

export function InviteSheet({ spaceId, open, onRequestClose, onClosed }: InviteSheetProps) {
  const theme = useTheme();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const attempted = useRef(false);

  const fetchInvite = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const inv = await createSpaceInvite(spaceId);
      setCode(inv.code ?? '');
    } catch (err) {
      setError(errorMessage(err, 'invite.failed'));
    } finally {
      setLoading(false);
    }
  }, [spaceId]);

  // Once per open (the host mounts a fresh sheet for each one).
  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    void fetchInvite();
  }, [fetchInvite]);

  const link = code ? inviteLink(code) : '';

  return (
    <Sheet
      open={open}
      onClose={onClosed}
      title={t('space.invitePeople')}
      description={t('invite.description')}
      icon="fa-user-plus"
      dismissible={!loading}
    >
      <View style={styles.body}>
        <FieldLabel label={t('invite.link')} />
        <View
          accessibilityLiveRegion="polite"
          style={[styles.linkBox, { borderRadius: theme.radii.md, borderColor: theme.colors.input, backgroundColor: withAlpha(theme.colors.muted, 0.4) }]}
        >
          <Text variant="mono" tone={link ? 'default' : 'muted'} selectable>
            {loading ? t('invite.creating') : link || t('invite.noLink')}
          </Text>
        </View>
        <Text variant="caption">{t('invite.anyoneCanJoin')}</Text>
        <FieldError message={error || undefined} />
        <View style={styles.row}>
          <Button
            title={t('mobile.nav.share')}
            icon="fa-share-nodes"
            disabled={loading || !code}
            style={styles.flex}
            onPress={() => {
              haptics.selection();
              void Share.share({ message: link, url: link }).catch(() => undefined);
            }}
          />
          <Button
            title={t('common.copy')}
            icon="fa-copy"
            variant="secondary"
            disabled={loading || !code}
            style={styles.flex}
            onPress={() => void copyText(link)}
          />
        </View>
        <View style={styles.row}>
          <Button
            title={t('invite.regenerate')}
            icon="fa-rotate"
            variant="ghost"
            disabled={loading}
            style={styles.flex}
            onPress={() => {
              setCode('');
              void fetchInvite();
            }}
          />
          <Button title={t('common.done')} variant="outline" style={styles.flex} disabled={loading} onPress={onRequestClose} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 10, paddingTop: 8 },
  linkBox: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 12, minHeight: 44, justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
