/**
 * Tapping a voice room in the list joins it, as on the web (SpaceChannelRow.handleVoiceClick).
 * Everything a join involves - voice set up on the instance, the Connect permission, "switch
 * from your current call?", the microphone prompt, errors, and the call screen (opened at once
 * when you are already connected there) - is the voice area's joinVoiceFromUi.
 */
import { joinVoiceFromUi } from './links';

export function pressVoiceRoom(spaceId: string, roomId: string): void {
  void Promise.resolve(joinVoiceFromUi(roomId, { spaceId })).catch(() => undefined);
}
