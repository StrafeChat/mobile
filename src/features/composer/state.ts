/**
 * What the composer of each conversation is doing: replying to a message, editing one, and
 * its unsent text. Shared between the message list (which starts a reply or an edit from a
 * message's actions) and the composer (which shows the reply strip / edit mode and sends).
 *
 * Kept per room (a thread is its own room id), unlike the web client, which reuses one
 * composer across rooms and loses a draft when you switch: on a phone people hop between
 * conversations constantly, so a half-written message and its reply target stay with their
 * conversation until sent or cancelled. In memory only - drafts are not written to disk
 * (an encrypted conversation's draft would otherwise sit there in the clear).
 *
 * Editing happens in the composer itself (Discord mobile), not inline in the list: the edit
 * text lives in `editText`, beside the unsent `draft`, so editing a message never throws
 * away what you were typing - cancel or save and the draft is back.
 *
 * Read with useSolid(() => composerFor(roomId)); change through the functions below.
 */
import { createStore, produce } from 'solid-js/store';

export interface ComposerRoomState {
  /** The message being replied to. */
  replyTo: string | null;
  /**
   * Ping the replied-to author (Discord's reply mention toggle). Kept for the message actions'
   * API; the wire format has no reply ping yet (sendMessage takes no such flag and the server
   * never mentions a reply's author), so the composer does not offer a switch for it.
   */
  replyMention: boolean;
  /** The message being edited; the composer shows its text and saves instead of sending. */
  editing: string | null;
  /** The edit buffer while `editing` is set (null until the composer seeds it). */
  editText: string | null;
  /** Unsent text. */
  draft: string;
  /** Why the last send failed ('' = none); the composer offers a retry beside it. */
  sendError: string;
  /** Bumped to ask the composer to focus its input (a reply or an edit was started). */
  focusRequest: number;
}

const EMPTY: ComposerRoomState = {
  replyTo: null,
  replyMention: true,
  editing: null,
  editText: null,
  draft: '',
  sendError: '',
  focusRequest: 0,
};

const [state, setState] = createStore<Record<string, ComposerRoomState>>({});

/** The composer state of a room (a fresh empty one when it has none). */
export function composerFor(roomId: string): ComposerRoomState {
  return state[roomId] ?? EMPTY;
}

function update(roomId: string, fn: (s: ComposerRoomState) => void): void {
  setState(
    produce((all) => {
      const cur = all[roomId] ?? { ...EMPTY };
      fn(cur);
      all[roomId] = cur;
    }),
  );
}

/** Reply to `messageId` (ends an edit in progress; the draft stays). */
export function startReply(roomId: string, messageId: string, mention = true): void {
  update(roomId, (s) => {
    s.replyTo = messageId;
    s.replyMention = mention;
    s.editing = null;
    s.editText = null;
    s.focusRequest += 1;
  });
}

export function cancelReply(roomId: string): void {
  update(roomId, (s) => {
    s.replyTo = null;
    s.replyMention = true;
  });
}

export function setReplyMention(roomId: string, mention: boolean): void {
  update(roomId, (s) => {
    s.replyMention = mention;
  });
}

/** Edit `messageId` in the composer (ends a reply in progress; the draft is kept aside). */
export function startEdit(roomId: string, messageId: string): void {
  update(roomId, (s) => {
    if (s.editing !== messageId) s.editText = null;
    s.editing = messageId;
    s.replyTo = null;
    s.focusRequest += 1;
  });
}

/** Leave edit mode without saving; the draft comes back. */
export function cancelEdit(roomId: string): void {
  update(roomId, (s) => {
    s.editing = null;
    s.editText = null;
  });
}

/** The edit was saved: leave edit mode, keep the draft. */
export function finishEdit(roomId: string): void {
  cancelEdit(roomId);
}

export function setEditText(roomId: string, text: string): void {
  update(roomId, (s) => {
    s.editText = text;
  });
}

export function setDraft(roomId: string, text: string): void {
  update(roomId, (s) => {
    s.draft = text;
  });
}

export function setSendError(roomId: string, message: string): void {
  update(roomId, (s) => {
    s.sendError = message;
  });
}

/** Ask the composer of `roomId` to focus its input (opens the keyboard). */
export function requestComposerFocus(roomId: string): void {
  update(roomId, (s) => {
    s.focusRequest += 1;
  });
}

/** After a send: the draft and the reply target go; the mention preference resets. */
export function clearAfterSend(roomId: string): void {
  update(roomId, (s) => {
    s.draft = '';
    s.replyTo = null;
    s.replyMention = true;
    s.editing = null;
    s.editText = null;
    s.sendError = '';
  });
}

/**
 * A send failed: put the text and the reply target back (unless something new was typed in
 * the meantime, which is kept rather than overwritten) and say why.
 */
export function restoreAfterFailedSend(roomId: string, failed: { text: string; replyTo: string | null }, message: string): void {
  update(roomId, (s) => {
    if (s.draft.trim() === '') s.draft = failed.text;
    if (s.replyTo === null && s.editing === null) s.replyTo = failed.replyTo;
    s.sendError = message;
  });
}

/** Sign-out / account switch reloads the app, but a room that went away clears its state. */
export function forgetComposer(roomId: string): void {
  setState(
    produce((all) => {
      delete all[roomId];
    }),
  );
}
