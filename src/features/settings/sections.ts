/**
 * The user settings list: groups, pages, icons and the search filter - the web's
 * settings/types.ts (ACCOUNT_ITEMS, APP_ITEMS, DEVELOPERS_ITEM, INSTANCE_ITEM) and
 * UserSettingsModal's navMatches, with the mobile differences spelled out:
 *
 * - no Desktop app page (Tauri only);
 * - Privacy & safety gathers the blocked list and the privacy switches (mobile only);
 * - "System & Keybinds" becomes Behaviour: phones have no keyboard shortcuts to rebind, only
 *   the two behaviour toggles that page also holds;
 * - a few descriptions say what the page does on a phone (no custom CSS, system
 *   notifications rather than desktop ones).
 */
import { t } from '@web/i18n/t';
import type { UserSettingsSectionId } from './routes';

export interface SettingsNavEntry {
  id: UserSettingsSectionId;
  icon: string;
  label: () => string;
  description: () => string;
}

export interface SettingsNavGroup {
  id: 'account' | 'app' | 'developers' | 'instance';
  label: () => string;
  items: SettingsNavEntry[];
}

const item = (id: UserSettingsSectionId, icon: string, label?: string, description?: string): SettingsNavEntry => ({
  id,
  icon,
  label: () => t(label ?? `settings.sections.${id}.title`),
  description: () => t(description ?? `settings.sections.${id}.description`),
});

export const ACCOUNT_ENTRIES: SettingsNavEntry[] = [
  item('account', 'user'),
  item('security', 'lock'),
  item('devices', 'shield-halved'),
  item('privacy', 'user-shield', 'mobile.settings.privacyTitle', 'mobile.settings.privacyDescription'),
  item('authorizedApps', 'plug'),
];

export const APP_ENTRIES: SettingsNavEntry[] = [
  item('appearance', 'palette', undefined, 'mobile.settings.appearanceDescription'),
  item('accessibility', 'universal-access'),
  item('voice', 'microphone'),
  item('notifications', 'bell', undefined, 'mobile.settings.notificationsDescription'),
  item('keybinds', 'sliders', 'mobile.settings.behaviourTitle', 'mobile.settings.behaviourDescription'),
  item('language', 'language'),
];

export const DEVELOPERS_ENTRY = item('developers', 'code');
export const INSTANCE_ENTRY = item('instance', 'server');

/** The web's navMatches: the translated label, or the section id, contains the query. */
export function entryMatches(entry: SettingsNavEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return entry.label().toLowerCase().includes(q) || entry.id.toLowerCase().includes(q) || entry.description().toLowerCase().includes(q);
}

/**
 * The groups to show for a search query. Instance appears only for an instance administrator
 * (asked of the server each time the list opens, failing closed); empty groups are dropped.
 */
export function settingsGroups(query: string, opts: { instanceAdmin: boolean }): SettingsNavGroup[] {
  const groups: SettingsNavGroup[] = [
    { id: 'account', label: () => t('settings.groups.account'), items: ACCOUNT_ENTRIES.filter((e) => entryMatches(e, query)) },
    { id: 'app', label: () => t('settings.groups.app'), items: APP_ENTRIES.filter((e) => entryMatches(e, query)) },
    { id: 'developers', label: () => t('settings.groups.developers'), items: entryMatches(DEVELOPERS_ENTRY, query) ? [DEVELOPERS_ENTRY] : [] },
    {
      id: 'instance',
      label: () => t('settings.sections.instance.title'),
      items: opts.instanceAdmin && entryMatches(INSTANCE_ENTRY, query) ? [INSTANCE_ENTRY] : [],
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** Every page's title by id, for screens that need their own header. */
export function sectionTitle(id: UserSettingsSectionId): string {
  const all = [...ACCOUNT_ENTRIES, ...APP_ENTRIES, DEVELOPERS_ENTRY, INSTANCE_ENTRY];
  return all.find((e) => e.id === id)?.label() ?? t('settings.title');
}
