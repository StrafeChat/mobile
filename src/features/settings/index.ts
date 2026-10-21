/**
 * Settings area: user settings, space settings, room settings, the instance admin dashboard
 * and the OAuth2 consent screen.
 *
 * Other areas only need the openers below. Screens are mounted by the routes under
 * src/app/(main)/{settings,space-settings,room-settings,admin,oauth2}, which import them from
 * this folder's files directly - this module stays light so importing an opener does not pull
 * every settings page in.
 *
 * Importing this module also wires the web's `stores/userSettingsModal`: web code that calls
 * `openUserSettings(section)` lands on the matching settings screen (see navigation.ts).
 */
import { installSettingsWiring } from './navigation';

export {
  openSettings,
  openSpaceProfile,
  openSpaceSettings,
  openRoomSettings,
  openAdminDashboard,
  openDeveloperApp,
  openThemeEditor,
  openOAuthConsent,
  installSettingsWiring,
} from './navigation';
export {
  userSettingsPath,
  spaceProfilePath,
  spaceSettingsPath,
  roomSettingsPath,
  adminPath,
  USER_SETTINGS_SECTIONS,
  SPACE_SETTINGS_PAGES,
  ROOM_SETTINGS_PAGES,
  type UserSettingsSectionId,
  type SpaceSettingsPageId,
  type RoomSettingsPageId,
} from './routes';
export { saturateHex } from './color';

installSettingsWiring();
