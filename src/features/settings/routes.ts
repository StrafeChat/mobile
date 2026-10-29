/**
 * Where every settings surface lives in the router, as plain functions (no React, no router
 * import) so the openers, the web-store wiring and the tests share one map.
 *
 * Section ids are the web's own (`stores/userSettingsModal`'s UserSettingsSection, the space
 * settings modal's SpaceSettingsSection, the room settings modal's Page), so a web call such
 * as `openUserSettings('instance')` lands on the matching screen without a translation table.
 */

/** User settings pages, by the web's section id. `desktop` and `activity` (the desktop app's
 * window and game detection) have no mobile page. */
export const USER_SETTINGS_SECTIONS = [
  'account',
  // Your nickname, avatar and profile in each space (the web's SpaceProfilesSettingsPage).
  'spaceProfiles',
  'security',
  'devices',
  // Mobile only: blocked people and the privacy switches the web spreads over other pages.
  'privacy',
  'authorizedApps',
  'appearance',
  'accessibility',
  'voice',
  'notifications',
  'keybinds',
  'language',
  'developers',
  'instance',
] as const;
export type UserSettingsSectionId = (typeof USER_SETTINGS_SECTIONS)[number];

export function isUserSettingsSection(v: unknown): v is UserSettingsSectionId {
  return typeof v === 'string' && (USER_SETTINGS_SECTIONS as readonly string[]).includes(v);
}

/** `/settings`, or the page for a section; an unknown id (or `desktop`, `activity`) opens the list. */
export function userSettingsPath(section?: string | null): string {
  return section && isUserSettingsSection(section) ? `/settings/${section}` : '/settings';
}

/**
 * Space Profiles, opened on one space (`?space=`) or on the screen's own choice: the space on
 * the rail, else the first. A member's own space profile is a user setting, not a space
 * settings page: those are gated by moderator permissions, and anyone may edit their own.
 */
export function spaceProfilePath(spaceId?: string | null): string {
  return spaceId ? `/settings/spaceProfiles?space=${encodeURIComponent(spaceId)}` : '/settings/spaceProfiles';
}

/** Space settings pages. The web calls Overview `general`; both ids are accepted. */
export const SPACE_SETTINGS_PAGES = [
  'overview',
  'system',
  'discover',
  'roles',
  'emojis',
  'moderation',
  'members',
  'invites',
  'bans',
  'audit',
] as const;
export type SpaceSettingsPageId = (typeof SPACE_SETTINGS_PAGES)[number];

const SPACE_PAGE_ALIASES: Record<string, SpaceSettingsPageId> = { general: 'overview' };

export function spaceSettingsPage(section?: string | null): SpaceSettingsPageId | null {
  if (!section) return null;
  const id = SPACE_PAGE_ALIASES[section] ?? section;
  return (SPACE_SETTINGS_PAGES as readonly string[]).includes(id) ? (id as SpaceSettingsPageId) : null;
}

export function spaceSettingsPath(spaceId: string, section?: string | null): string {
  const page = spaceSettingsPage(section);
  const base = `/space-settings/${encodeURIComponent(spaceId)}`;
  return page ? `${base}/${page}` : base;
}

/** A role's editor (Display / Permissions / Members). */
export function spaceRolePath(spaceId: string, roleId: string): string {
  return `/space-settings/${encodeURIComponent(spaceId)}/roles/${encodeURIComponent(roleId)}`;
}

/** Room (channel / section) settings pages. The web calls Permissions `overrides`. */
export const ROOM_SETTINGS_PAGES = ['general', 'encryption', 'voice', 'permissions', 'notifications'] as const;
export type RoomSettingsPageId = (typeof ROOM_SETTINGS_PAGES)[number];

const ROOM_PAGE_ALIASES: Record<string, RoomSettingsPageId> = { overrides: 'permissions', notify: 'notifications' };

export function roomSettingsPage(section?: string | null): RoomSettingsPageId | null {
  if (!section) return null;
  const id = ROOM_PAGE_ALIASES[section] ?? section;
  return (ROOM_SETTINGS_PAGES as readonly string[]).includes(id) ? (id as RoomSettingsPageId) : null;
}

export function roomSettingsPath(roomId: string, section?: string | null): string {
  const page = roomSettingsPage(section);
  const base = `/room-settings/${encodeURIComponent(roomId)}`;
  return page ? `${base}/${page}` : base;
}

/** One permission-override target in a room: a role or a member. */
export type OverrideTarget = { kind: 'role'; id: string } | { kind: 'user'; id: string };

export function overrideTargetParam(target: OverrideTarget): string {
  return `${target.kind}:${target.id}`;
}

export function parseOverrideTarget(raw: string | null | undefined): OverrideTarget | null {
  if (!raw) return null;
  const decoded = decodeURIComponent(raw);
  const i = decoded.indexOf(':');
  if (i <= 0) return null;
  const kind = decoded.slice(0, i);
  const id = decoded.slice(i + 1);
  if (!id || (kind !== 'role' && kind !== 'user')) return null;
  return { kind, id };
}

export function roomOverridePath(roomId: string, target: OverrideTarget): string {
  return `/room-settings/${encodeURIComponent(roomId)}/permissions/${encodeURIComponent(overrideTargetParam(target))}`;
}

/** The instance admin dashboard and its detail screens. */
export const ADMIN_TABS = ['overview', 'users', 'reports', 'bans', 'discover', 'audit', 'federation'] as const;
export type AdminTabId = (typeof ADMIN_TABS)[number];

export function adminPath(tab?: AdminTabId | null): string {
  return tab && tab !== 'overview' ? `/admin?tab=${tab}` : '/admin';
}
export function adminUserPath(userId: string): string {
  return `/admin/users/${encodeURIComponent(userId)}`;
}
export function adminReportPath(reportId: string): string {
  return `/admin/reports/${encodeURIComponent(reportId)}`;
}
export function adminSpacePath(spaceId: string): string {
  return `/admin/spaces/${encodeURIComponent(spaceId)}`;
}

/** Developer settings: the list, and one application. */
export function developerAppPath(appId: string): string {
  return `/settings/developers/${encodeURIComponent(appId)}`;
}

/** The custom theme editor, seeded from a theme (custom: edited in place; built-in: copied). */
export function themeEditorPath(baseThemeId?: string | null): string {
  return baseThemeId ? `/settings/theme-editor?base=${encodeURIComponent(baseThemeId)}` : '/settings/theme-editor';
}

/**
 * The in-app OAuth2 consent screen for a web URL (`https://host/oauth2/authorize?...`) or a
 * bare path: the router path with the same query, or null when the URL is not a consent URL.
 */
export function oauthConsentPath(url: string): string | null {
  let pathname = '';
  let search = '';
  try {
    const u = new URL(url, 'https://app.invalid');
    pathname = u.pathname;
    search = u.search;
  } catch {
    return null;
  }
  if (pathname !== '/oauth2/authorize') return null;
  return `/oauth2/authorize${search}`;
}
