/**
 * joinVoiceFromUi: every "join" in the app goes through here - a voice room in the room list,
 * a PM header's call buttons, the call screen's Join, accepting a ring. It adds to the voice
 * store's joinVoiceRoom what a phone needs around it:
 *
 * - voice switched off on the instance, no Connect permission, or no call encryption on this
 *   device: refused with the web's message (never joined in the clear);
 * - already connected elsewhere: confirm the switch (an accidental join on a phone costs
 *   more than a click on a desktop);
 * - microphone (and camera for video) permission prompts first, so a refusal is explained
 *   rather than found mid-join - joining to listen still works;
 * - the call screen opens at once, so "Connecting…" is visible while the request runs;
 * - failures map to the web's strings (VoiceStage.join) and show as a toast, or through
 *   `onError` for a screen that shows them inline.
 */
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { confirmDialog } from '@web/stores/confirmDialog';
import { instance } from '@web/stores/instance';
import {
  CallEncryptionUnsupportedError,
  acceptIncomingCall,
  declineIncomingCall,
  isConnectedTo,
  joinVoiceRoom,
  setCameraEnabled,
  voice,
} from '@web/stores/voice';
import { voicePermsFor } from '@web/lib/voice/perms';
import { callEncryptionSupported } from '@/platform/voice';
import { stopRingtone } from '@/platform/voice/ringtone';
import { openRoom } from '@/shell/state';
import { roomInfo, spaceIdOfRoom } from '@/data/rooms';
import { createExternalStore, haptics, toast } from '@/ui';
import { openCallScreen } from './callView';
import { joinErrorText } from './model';
import { ensureCameraPermission, ensureMicPermission, reportPermission } from './permissions';

export interface JoinVoiceOptions {
  /** The room's space; looked up from the loaded room lists when omitted, null for a PM. */
  spaceId?: string | null;
  /** Join with the camera on (Start video call / Join with video). */
  video?: boolean;
  /** Show the call screen (default true). */
  openCall?: boolean;
  /** Report a failure here instead of as a toast. */
  onError?: (message: string) => void;
}

/** The room a join is in flight for (the Join buttons' spinner), or null. */
export const joiningStore = createExternalStore<string | null>(null);

/** Resolves true once connected (or already there), false when refused, cancelled or failed. */
export async function joinVoiceFromUi(roomId: string, opts: JoinVoiceOptions = {}): Promise<boolean> {
  const fail = (message: string): false => {
    if (opts.onError) opts.onError(message);
    else toast.error(message, { icon: 'phone-slash' });
    return false;
  };
  if (joiningStore.get()) return false;
  if (!instance.voiceEnabled) return fail(t('space.voiceUnsupported'));
  const spaceId = opts.spaceId === undefined ? (spaceIdOfRoom(roomId) ?? null) : opts.spaceId;
  const openCall = opts.openCall !== false;

  if (isConnectedTo(roomId)) {
    if (opts.video && !voice.session.camera) {
      const cam = await ensureCameraPermission();
      reportPermission('camera', cam);
      if (cam === 'granted') await setCameraEnabled(true);
    }
    if (openCall) openCallScreen({ roomId, spaceId });
    return true;
  }

  if (!callEncryptionSupported()) return fail(t('mobile.voice.errors.e2eeUnsupported'));
  if (spaceId && !voicePermsFor(auth.user?.id, spaceId, roomId).connect) return fail(t('voice.noConnect'));

  const current = voice.session;
  if (current.status !== 'idle' && current.roomId && current.roomId !== roomId) {
    const name = roomInfo(current.roomId, current.spaceId)?.name ?? '';
    const ok = await confirmDialog({
      title: t('mobile.voice.switchTitle'),
      body: t('mobile.voice.switchBody', { room: name }),
      confirmLabel: t('mobile.voice.switchConfirm'),
      icon: 'fa-solid fa-right-left',
    });
    if (!ok) return false;
  }

  joiningStore.set(roomId);
  try {
    const mic = await ensureMicPermission();
    reportPermission('mic', mic);
    let video = !!opts.video;
    if (video) {
      const cam = await ensureCameraPermission();
      if (cam !== 'granted') {
        video = false;
        reportPermission('camera', cam);
      }
    }
    if (openCall) openCallScreen({ roomId, spaceId });
    haptics.impact('light');
    await joinVoiceRoom(roomId, { video });
    return true;
  } catch (err) {
    const text = joinErrorText(err, (e) => e instanceof CallEncryptionUnsupportedError);
    return fail('key' in text ? t(text.key) : text.message);
  } finally {
    joiningStore.set(null);
  }
}

/**
 * The camera button: turning it on asks for the camera first (and says how to fix a refusal)
 * instead of leaving it to a WebRTC error; turning it off is immediate.
 */
export async function toggleCameraFromUi(): Promise<void> {
  if (!voice.session.camera) {
    const cam = await ensureCameraPermission();
    if (cam !== 'granted') {
      reportPermission('camera', cam);
      return;
    }
  }
  await setCameraEnabled(!voice.session.camera);
}

/**
 * Accept the ringing call (the incoming-call overlay): the ringtone stops while the OS asks
 * for the microphone, then the store's acceptIncomingCall joins - leaving any other call, as
 * picking up does - and the conversation and the call screen open, as the web navigates to
 * the room. A call that ended while the prompt was up is not rejoined (that would ring the
 * caller back).
 */
export async function acceptIncomingFromUi(video = false): Promise<boolean> {
  const inc = voice.incoming;
  if (!inc) return false;
  const roomId = inc.roomId;
  stopRingtone();
  const mic = await ensureMicPermission();
  reportPermission('mic', mic);
  let withVideo = video;
  if (withVideo) {
    const cam = await ensureCameraPermission();
    if (cam !== 'granted') {
      withVideo = false;
      reportPermission('camera', cam);
    }
  }
  if (voice.incoming?.roomId !== roomId) return false;
  openRoom(roomId, null);
  openCallScreen({ roomId, spaceId: null });
  try {
    await acceptIncomingCall(withVideo);
    return true;
  } catch (err) {
    const text = joinErrorText(err, (e) => e instanceof CallEncryptionUnsupportedError);
    toast.error('key' in text ? t(text.key) : text.message, { icon: 'phone-slash' });
    return false;
  }
}

/** Decline the ringing call (POST /rooms/:id/call/decline; the ringtone stops). */
export function declineIncomingFromUi(): Promise<void> {
  haptics.impact('medium');
  return declineIncomingCall();
}

/**
 * Open a voice room's page without joining: its stage, who is in it, and a Join button
 * (the inventory's advice for a tap in the room list - joining is a deliberate act on a
 * phone). Already connected there: the call itself.
 */
export function previewVoiceRoom(roomId: string, spaceId?: string | null): void {
  openCallScreen({ roomId, spaceId: spaceId === undefined ? (spaceIdOfRoom(roomId) ?? null) : spaceId });
}
