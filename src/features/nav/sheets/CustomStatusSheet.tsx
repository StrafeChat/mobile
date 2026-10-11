/**
 * The custom status editor (the desktop user popover's field, which the web's mobile You panel
 * never got): up to 128 characters; Save keeps it, Clear removes it. Saving is optimistic and
 * rolls back with a message if the server refuses (ownPresence.ts).
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { useSelfPresence } from '@/data';
import { Button, Input, Sheet } from '@/ui';
import { CUSTOM_STATUS_MAX, setOwnCustomStatus } from '../you/ownPresence';

export interface CustomStatusSheetProps {
  open: boolean;
  onRequestClose: () => void;
  onClosed: () => void;
}

export function CustomStatusSheet({ open, onRequestClose, onClosed }: CustomStatusSheetProps) {
  const self = useSelfPresence();
  const [draft, setDraft] = useState(self.custom_status ?? '');
  const [saving, setSaving] = useState(false);

  async function save(text: string) {
    setSaving(true);
    const ok = await setOwnCustomStatus(text);
    setSaving(false);
    if (ok) onRequestClose();
  }

  return (
    <Sheet open={open} onClose={onClosed} title={t('userArea.customStatus')} icon="fa-face-smile" dismissible={!saving}>
      <View style={styles.body}>
        <Input
          value={draft}
          onChangeText={setDraft}
          placeholder={t('userArea.setCustomStatus')}
          accessibilityLabel={t('userArea.customStatus')}
          maxLength={CUSTOM_STATUS_MAX}
          disabled={saving}
          autoFocus
          returnKeyType="done"
          onSubmitEditing={() => void save(draft)}
        />
        <View style={styles.actions}>
          <Button
            title={t('common.clear')}
            variant="outline"
            disabled={saving || (!draft && !self.custom_status)}
            onPress={() => {
              setDraft('');
              void save('');
            }}
            style={styles.flex}
          />
          <Button title={t('common.save')} loading={saving} onPress={() => void save(draft)} style={styles.flex} />
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: 12, paddingTop: 8 },
  actions: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
});
