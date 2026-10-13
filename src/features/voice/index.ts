/**
 * Voice and video UI, on the shared voice store (web/src/stores/voice.ts, the mobile override)
 * and the platform call engine (src/platform/voice).
 *
 * For the integrator:
 *   <VoiceDock style?/>   the in-call bar, placed under the shell; renders nothing when idle
 *                         or while the call's own stage is on screen (useVoiceDockVisible()).
 *   <VoiceHosts/>         mount once at the root (inside UiProvider): incoming-call screen,
 *                         per-user voice sheet, statistics, screen-share picker, keep-awake.
 *   route /call           src/app/(main)/call.tsx -> <CallScreen/>.
 *
 * For other areas:
 *   joinVoiceFromUi(roomId, { spaceId?, video?, openCall?, onError? }) -> Promise<boolean>
 *       every "join a call" button (PM header call / video, a voice room). Permission prompts,
 *       the switch-rooms confirm, the encryption gate and error toasts are handled here.
 *   previewVoiceRoom(roomId, spaceId?)  open a voice room's page (stage + Join) without joining.
 *   openCallScreen({ roomId, spaceId }?) / closeCallScreen()
 *   <RoomCallBanner roomId/>            "Call in progress - Join" strip for a PM conversation.
 *   <VoiceUserRow roomId spaceId userId indent?/>  a person under a voice room in the room list.
 *   openVoiceUserSheet({ userId, roomId, spaceId? })  volume / mute for me / moderation sheet.
 */
export { VoiceDock, useVoiceDockVisible, type VoiceDockProps } from './VoiceDock';
export { VoiceHosts, useCallKeepAwake } from './VoiceHosts';
export { CallScreen, type CallScreenProps } from './CallScreen';
export { RoomCallBanner } from './RoomCallBanner';
export { VoiceUserRow, type VoiceUserRowProps } from './VoiceUserRow';
export { joinVoiceFromUi, previewVoiceRoom, acceptIncomingFromUi, declineIncomingFromUi, joiningStore, type JoinVoiceOptions } from './join';
export { openCallScreen, closeCallScreen, callViewStore, type CallViewTarget } from './callView';
export { openVoiceUserSheet, closeVoiceUserSheet, toggleVoiceStats, openScreenShareSheet, type VoiceUserTarget } from './sheets';
export { fitTiles } from './model';
