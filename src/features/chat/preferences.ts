/**
 * Chat gesture preferences, on this device.
 *
 * Swipe to reply is opt-in. A leftward swipe over a conversation is how the member list
 * opens (src/shell), and messages fill the conversation, so with swipe-to-reply on, that
 * gesture only works from the gaps between messages - and on Android the screen edges belong
 * to the system's Back gesture, so an edge strip for the member list can't make up for it.
 * Off by default, the member list swipe works everywhere; replying stays a long-press away.
 */
import { createSignal } from 'solid-js';
import { appStorage } from '@/platform/storage';

const SWIPE_TO_REPLY_KEY = 'chat.swipeToReply';

function read(): boolean {
  try {
    return appStorage.getBoolean(SWIPE_TO_REPLY_KEY) === true;
  } catch {
    return false;
  }
}

const [swipeToReply, setSwipeToReplySignal] = createSignal(read());

/** Whether a leftward swipe on a message replies to it (reactive). */
export function swipeToReplyEnabled(): boolean {
  return swipeToReply();
}

export function setSwipeToReplyEnabled(on: boolean): void {
  setSwipeToReplySignal(on);
  try {
    appStorage.set(SWIPE_TO_REPLY_KEY, on);
  } catch {
    /* not persisted; still applies for this run */
  }
}
