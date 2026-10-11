/**
 * Copy to the clipboard with the web's brief "Copied" acknowledgement: `copied(key)` is true
 * for 1.5 s after `copy(key, text)` so the button that was pressed can say so. A light haptic
 * marks it too, since the label change is easy to miss with a thumb over it.
 */
import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useRef, useState } from 'react';
import { haptics, toast } from '@/ui';
import { t } from '@web/i18n/t';

export const COPIED_FLASH_MS = 1500;

export function useCopy(flashMs = COPIED_FLASH_MS): { copy: (key: string, text: string) => Promise<boolean>; copied: (key: string) => boolean } {
  const [copiedKey, setCopiedKey] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const copy = useCallback(
    async (key: string, text: string) => {
      if (!text) return false;
      try {
        await Clipboard.setStringAsync(text);
      } catch {
        toast.error(t('mobile.settings.copyFailed'));
        return false;
      }
      haptics.selection();
      setCopiedKey(key);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopiedKey((k) => (k === key ? '' : k)), flashMs);
      return true;
    },
    [flashMs],
  );

  const copied = useCallback((key: string) => copiedKey === key, [copiedKey]);
  return { copy, copied };
}
