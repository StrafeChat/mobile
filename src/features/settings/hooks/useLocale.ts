/**
 * Re-render a screen when the UI language changes. `t()` reads a Solid signal, which React
 * does not see; a settings screen calls this once so its copy follows a switch made on the
 * Language page (the screens below it in the stack included) without a restart.
 */
import { currentLanguage } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';

export function useLocale(): string {
  return useSolid(() => currentLanguage());
}
