/**
 * Add a friend by handle (FriendsPage's dialog): `turtle`, or `turtle@their.instance` when this
 * instance federates. The handle grammar is the server's; errors are the server's own reasons,
 * translated (not found, yourself, bots, already friends, request pending, federation refused...).
 * Your own handle sits underneath with Copy and - on a phone - Share.
 */
import { useState } from 'react';
import { Share, StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { sendFriendRequest } from '@web/api/relationships';
import { loadRelationships } from '@web/stores/relationships';
import { formatHandle } from '@web/stores/instance';
import { translateCaughtApiError } from '@web/lib/formatApiError';
import { useInstance, useMe } from '@/data';
import { useTheme } from '@/theme';
import { Button, IconButton, Input, MONO_FONT, Sheet, Text, toast } from '@/ui';
import { copyText } from '../actions';
import { normalizeHandle } from '../friendsModel';

export interface AddFriendSheetProps {
  open: boolean;
  onRequestClose: () => void;
  onClosed: () => void;
}

/** The handle to give other people: the username, with @domain when this instance federates. */
export function myHandle(username: string, federationEnabled: boolean, domain: string): string {
  const base = formatHandle({ username });
  return federationEnabled && domain ? `${base}@${domain}` : base;
}

export function AddFriendSheet({ open, onRequestClose, onClosed }: AddFriendSheetProps) {
  const theme = useTheme();
  const me = useMe();
  const inst = useInstance();
  const [handle, setHandle] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const mine = me ? myHandle(me.username, inst.federationEnabled, inst.domain) : '';

  async function submit() {
    setError('');
    const h = normalizeHandle(handle);
    if (!h) {
      setError(t(inst.federationEnabled ? 'friends.errors.handleFormatFederated' : 'friends.errors.handleFormat'));
      return;
    }
    setLoading(true);
    try {
      await sendFriendRequest(h);
    } catch (err) {
      setError(translateCaughtApiError(err, t).join(' ') || t('friends.errors.sendFailed'));
      setLoading(false);
      return;
    }
    // Sent: reloading the list to show it is best effort (a failure there is not a failed
    // request, and sending again would only meet "request already sent").
    await loadRelationships().catch(() => undefined);
    setLoading(false);
    toast.success(t('mobile.nav.requestSent'));
    onRequestClose();
  }

  return (
    <Sheet
      open={open}
      onClose={onClosed}
      title={t('friends.addFriend')}
      description={t(inst.federationEnabled ? 'friends.addHelpFederated' : 'friends.addHelp')}
      icon="fa-user-plus"
      dismissible={!loading}
    >
      <View style={styles.body}>
        <Input
          label={t('friends.username')}
          value={handle}
          onChangeText={(v) => {
            setHandle(v);
            setError('');
          }}
          placeholder={inst.federationEnabled ? 'turtle@their.instance' : 'turtle'}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          keyboardType={'email-address'}
          inputStyle={{ fontFamily: MONO_FONT }}
          disabled={loading}
          error={error || undefined}
          autoFocus
          returnKeyType="send"
          onSubmitEditing={() => void submit()}
        />
        {mine ? (
          <View style={[styles.mine, { borderRadius: theme.radii.md, backgroundColor: theme.colors.muted }]}>
            <View style={styles.flex}>
              <Text variant="caption">{t('friends.yourHandle')}</Text>
              <Text variant="mono" numberOfLines={1} selectable>
                {mine}
              </Text>
            </View>
            <IconButton icon="fa-copy" label={t('userArea.copyUsername')} onPress={() => void copyText(mine)} />
            <IconButton
              icon="fa-share-nodes"
              label={t('mobile.nav.shareHandle')}
              onPress={() => void Share.share({ message: mine }).catch(() => undefined)}
            />
          </View>
        ) : null}
        <View style={styles.actions}>
          <Button title={t('common.cancel')} variant="outline" disabled={loading} onPress={onRequestClose} style={styles.flex} />
          <Button
            title={t('friends.sendRequest')}
            loading={loading}
            disabled={!handle.trim()}
            onPress={() => void submit()}
            style={styles.flex}
          />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, paddingTop: 8 },
  flex: { flex: 1, minWidth: 0 },
  mine: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingStart: 12, paddingEnd: 4, paddingVertical: 6 },
  actions: { flexDirection: 'row', gap: 10 },
});
