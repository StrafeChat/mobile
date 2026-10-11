/**
 * Ask before leaving a screen with unsaved edits - the web settings modal's "Discard unsaved
 * changes?" confirm, on every way out of a screen (back arrow, Android back, the iOS edge
 * swipe, a navigation from elsewhere).
 */
import { useRef } from 'react';
import { useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import { confirmDialog } from '@web/stores/confirmDialog';
import { t } from '@web/i18n/t';

export function useUnsavedGuard(dirty: boolean): void {
  const navigation = useNavigation();
  const asking = useRef(false);
  usePreventRemove(dirty, ({ data }) => {
    if (asking.current) return;
    asking.current = true;
    void confirmDialog({
      title: t('settings.unsaved.title'),
      body: t('settings.unsaved.body'),
      confirmLabel: t('common.discard'),
      tone: 'danger',
    })
      .then((discard) => {
        if (discard) navigation.dispatch(data.action as never);
      })
      .finally(() => {
        asking.current = false;
      });
  });
}
