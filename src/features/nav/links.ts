/**
 * The nav area's only doorways into other feature areas, kept in one module so the rest of the
 * area imports from here (and component tests mock one file instead of three areas).
 *
 * - settings: openSettings(section?), openSpaceSettings(spaceId, section?), openRoomSettings(roomId, section?)
 * - voice: joinVoiceFromUi(roomId, { spaceId }) - every check and prompt of a join (voice set
 *   up, Connect permission, switching calls, microphone, errors) and the call screen; and the
 *   voice area's row for a person in a voice room, which carries its own voice sheet
 * - auth: openAccountSwitcher()
 */
export { openSettings, openSpaceSettings, openRoomSettings } from '@/features/settings';
export { joinVoiceFromUi, VoiceUserRow as VoiceOccupantRow } from '@/features/voice';
export { openAccountSwitcher } from '@/features/auth';
