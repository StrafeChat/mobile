/**
 * Notification buttons and taps for pushes that expo-notifications reports - every Strafe
 * push on iOS (the Notification Service Extension renders them; the buttons come from the
 * categories registered here). Android's native renderer handles its own buttons and opens
 * the app through a deep link instead (+native-intent).
 *
 * - `strafe.message`: Mark as read (in the background: the room's read cursor moves to the
 *   message, and its notifications go) and Reply (opens the conversation, composer focused).
 * - `strafe.call`: Answer (opens the app and joins) and Decline (in the background).
 *
 * The background actions act as the account the push was for - the open one through the
 * web's own API and stores, another one with its stored session on its own instance.
 */
import * as StrafePush from '@strafe/push';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { ackRoom } from '@web/api/rooms';
import { declineCall } from '@web/api/voice';
import { t } from '@web/i18n/t';
import { declineIncomingCall, voice } from '@web/stores/voice';
import { activePushAccount, pushAccounts } from './accounts';
import { ackRoomAs, declineCallAs } from './api';
import { pushDataOf, type PushData } from './links';
import { routePushTarget } from './routing';

export const MESSAGE_CATEGORY = 'strafe.message';
export const CALL_CATEGORY = 'strafe.call';
export const ACTION_MARK_READ = 'markRead';
export const ACTION_REPLY = 'reply';
export const ACTION_ANSWER = 'answer';
export const ACTION_DECLINE = 'decline';

let registeredFor: string | null = null;

/** iOS: the buttons the extension's categories show, in the current language. */
export async function registerPushCategories(): Promise<void> {
  if (Platform.OS !== 'ios') return;
  const titles = [t('mobile.push.markRead'), t('mobile.push.reply'), t('mobile.push.answer'), t('mobile.push.decline')];
  const signature = titles.join('\u0000');
  if (signature === registeredFor) return;
  const [markRead, reply, answer, decline] = titles as [string, string, string, string];
  await Notifications.setNotificationCategoryAsync(MESSAGE_CATEGORY, [
    { identifier: ACTION_MARK_READ, buttonTitle: markRead, options: { opensAppToForeground: false } },
    { identifier: ACTION_REPLY, buttonTitle: reply, options: { opensAppToForeground: true } },
  ]);
  await Notifications.setNotificationCategoryAsync(CALL_CATEGORY, [
    { identifier: ACTION_ANSWER, buttonTitle: answer, options: { opensAppToForeground: true } },
    { identifier: ACTION_DECLINE, buttonTitle: decline, options: { opensAppToForeground: false, isDestructive: true } },
  ]);
  registeredFor = signature;
}

/** The Strafe push a notification response is about, if it is one. */
export function pushDataOfResponse(response: Notifications.NotificationResponse): PushData | null {
  const request = response.notification.request;
  const trigger = request.trigger as { type?: string; payload?: unknown } | null;
  return pushDataOf(request.content, trigger?.type === 'push' ? trigger.payload : undefined);
}

function accountOf(slot: string) {
  return pushAccounts().find((a) => a.slot === slot) ?? null;
}

async function markRead(data: PushData): Promise<void> {
  if (!data.roomId || !data.messageId) return;
  const active = activePushAccount();
  if (active?.slot === data.slot) await ackRoom(data.roomId, data.messageId);
  else {
    const account = accountOf(data.slot);
    if (account) await ackRoomAs(account, data.roomId, data.messageId);
  }
  await StrafePush.clearRoom(data.slot, data.roomId).catch(() => undefined);
}

async function decline(data: PushData): Promise<void> {
  if (!data.roomId) return;
  const active = activePushAccount();
  if (active?.slot === data.slot) {
    // The voice store stops its own ringing too when it knows about the call.
    if (voice.incoming?.roomId === data.roomId) await declineIncomingCall();
    else await declineCall(data.roomId);
    return;
  }
  const account = accountOf(data.slot);
  if (account) await declineCallAs(account, data.roomId);
}

/**
 * Handle a response to one of our pushes. Returns false when it is not one (the caller
 * routes it as a local notification).
 */
export function handlePushResponse(response: Notifications.NotificationResponse): boolean {
  const data = pushDataOfResponse(response);
  if (!data) return false;
  const identifier = response.notification.request.identifier;
  const dismiss = () => void Notifications.dismissNotificationAsync(identifier).catch(() => undefined);
  switch (response.actionIdentifier) {
    case ACTION_MARK_READ:
      dismiss();
      markRead(data).catch((e: unknown) => console.warn('[push] mark as read failed', e));
      return true;
    case ACTION_DECLINE:
      dismiss();
      decline(data).catch((e: unknown) => console.warn('[push] decline failed', e));
      return true;
    default: {
      if (!data.roomId) {
        // A test push, or iOS's generic alert for a push it could not decrypt: no room to
        // open, but it may be another account's - routing switches to it.
        routePushTarget({ slot: data.slot, roomId: '' });
        return true;
      }
      const action =
        response.actionIdentifier === ACTION_REPLY ? 'reply' : response.actionIdentifier === ACTION_ANSWER ? 'answer' : undefined;
      if (data.type === 'call' || action === 'answer') dismiss();
      routePushTarget({
        slot: data.slot,
        roomId: data.roomId,
        ...(data.spaceId ? { spaceId: data.spaceId } : {}),
        ...(data.messageId ? { messageId: data.messageId } : {}),
        ...(action ? { action } : {}),
      });
      return true;
    }
  }
}
