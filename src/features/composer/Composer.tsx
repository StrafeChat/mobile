/**
 * The message composer of a conversation (a PM, a group, a space room or a thread).
 *
 * The web's RoomMessageInput + the send/typing/slowmode logic of RoomPage and SpacePage,
 * rebuilt for a phone:
 * - a multiline field that grows to ~200 pt then scrolls, sitting on the keyboard (it pads
 *   itself by the keyboard's height, or the home-indicator inset when the keyboard is down);
 *   Return inserts a newline and the round button sends (Discord mobile); the keyboard stays
 *   up after a send;
 * - '+' opens photos/videos, camera, files and GIFs; queued files wait in a strip above the
 *   field with remove buttons (a recorded voice message is playable there);
 * - @mention / #room / :emoji: suggestions above the field, inserted at the caret, and
 *   serializeDraft to wire syntax on send - as the web does;
 * - the emoji / GIF panel in the keyboard's place (Discord's): the emoji button swaps the
 *   keyboard for it without moving the input row, becomes a keyboard button while it is open,
 *   and an emoji goes in at the caret with the panel staying open (panel/useExpressionPanel);
 * - hold the microphone to record a voice message (slide to cancel, slide up to lock);
 * - a reply strip (tap to jump to the message) and an edit mode that edits in the composer,
 *   with mentions shown as @names rather than the web's raw <@id>;
 * - typing announcements throttled like the web's, the slowmode countdown, and a notice in
 *   place of the field when sending isn't allowed (no permission, the official account's
 *   read-only PM, a locked thread, a verification rule, or no encryption engine);
 * - a failed send puts the text, files and reply back and offers Retry.
 *
 * The draft, reply/edit target and queued files are per room and survive switching rooms
 * (state.ts, attachmentQueues.ts).
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  I18nManager,
  TextInput,
  View,
  type LayoutChangeEvent,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { editMessage, jumpToMessage, messages, sendMessage } from '@web/stores/messages';
import { sendTyping } from '@web/api/rooms';
import { removeTyping } from '@web/stores/typing';
import { auth } from '@web/stores/auth';
import { dismissNewHeader } from '@web/stores/newHeaderDismissed';
import { startSlowmode } from '@web/stores/slowmode';
import { settings } from '@web/stores/settings';
import type { GifResult } from '@web/lib/gif/providers';
import { serializeDraft } from '@web/lib/utils/mentions';
import { t } from '@web/i18n/t';
import { useSolid } from '@/bridge/solid';
import { useTheme } from '@/theme';
import { Button, Icon, IconButton, Text, haptics, toast, withAlpha } from '@/ui';
import { useRoomInfo } from '@/data/rooms';
import { useComposerLock, useRoomGates } from '@/data/permissions';
import { useSlowmodeRemaining } from '@/data/reactions';
import { useEmojiPrefs } from '@/data/settings';
import { asWebPendingAttachments, isVoiceRecordingSupported, recoverPendingPick, type VoiceRecording } from '@/platform/media';
import {
  cancelEdit,
  cancelReply,
  clearAfterSend,
  composerFor,
  finishEdit,
  restoreAfterFailedSend,
  setDraft,
  setEditText,
  setSendError,
  takeFocusRequest,
} from './state';
import { attachmentQueueFor } from './attachmentQueues';
import { handlePick, openAttachMenu } from './attach';
import { computeCompletion, spliceText, type Candidate } from './logic/completion';
import { NotSentError, createTypingEmitter, hasContent, retryAfterSeconds, sendErrorText } from './logic/sending';
import { readableToWire, wireToReadable } from './logic/wireText';
import { deleteBackward } from './logic/backspace';
import { useComposerContext } from './hooks/useComposerContext';
import { useEmojiCatalog } from './hooks/useEmojiCatalog';
import { useEditTarget, useReplyTarget } from './hooks/useComposerTargets';
import { useEncryptionEngineFailed } from './hooks/useEncryptionEngineFailed';
import { useVoiceRecorder } from './hooks/useVoiceRecorder';
import { AutocompleteList } from './components/AutocompleteList';
import { ComposerNotice, ContextStrip, ErrorLine, SendButton } from './components/ComposerParts';
import type { EmojiPick } from './components/EmojiPicker';
import { ExpressionPanel } from './panel/ExpressionPanel';
import { useExpressionPanel } from './panel/useExpressionPanel';
import { MicButton } from './components/MicButton';
import { PendingAttachments } from './components/PendingAttachments';
import { LockHint, RecordingBar } from './components/RecordingBar';

export interface ComposerProps {
  roomId: string;
  spaceId?: string | null;
  /** The most height the composer may take (the conversation's body less what must stay
   * visible): the expression panel expands up to it. Without it the panel estimates from the
   * window. */
  maxHeight?: number;
}

/** The field grows with its content up to this height, then scrolls (the web's 200 px). */
const MAX_INPUT_HEIGHT = 200;

/** The text each room's edit started from, to recognise an unchanged save (kept beside the
 * per-room edit buffer, so it survives switching rooms mid-edit). */
const editSeeds = new Map<string, { id: string; text: string }>();

export function Composer({ roomId, spaceId, maxHeight }: ComposerProps) {
  const info = useRoomInfo(roomId, spaceId);
  const gates = useRoomGates(roomId, spaceId);
  const { lock, text: lockText } = useComposerLock(roomId, spaceId);
  const engineFailed = useEncryptionEngineFailed();
  const theme = useTheme();

  let notice: { icon: string; text: string } | null = null;
  if (lock && lockText) {
    const icon = lock.kind === 'officialReadOnly' ? 'circle-info' : lock.kind === 'verification' ? 'shield-halved' : 'lock';
    notice = { icon, text: lockText };
  } else if (info?.e2ee && engineFailed) {
    notice = { icon: 'lock', text: t('mobile.composer.e2eeUnavailable') };
  }

  return (
    <View style={{ backgroundColor: theme.colors.background }} testID="composer">
      {notice ? (
        <>
          <ComposerNotice icon={notice.icon} text={notice.text} />
          <KeyboardSpacer />
        </>
      ) : (
        <ComposerBody
          key={roomId}
          roomId={roomId}
          spaceId={spaceId ?? info?.spaceId ?? null}
          canAttach={gates?.canAttach ?? true}
          canMentionEveryone={gates?.canMentionEveryone ?? false}
          customEmojiSpaceId={gates?.customEmojiSpaceId}
          slowmodeSeconds={gates?.slowmodeSeconds ?? 0}
          inSpace={gates?.kind === 'space'}
          {...(maxHeight !== undefined ? { maxHeight } : {})}
        />
      )}
    </View>
  );
}

/** Under a notice: the keyboard's height while it is up (its height is negative here), else
 * the home indicator. The body has its own, shared with the expression panel. */
function KeyboardSpacer() {
  const insets = useSafeAreaInsets();
  const { height: keyboardHeight } = useReanimatedKeyboardAnimation();
  const spacer = useAnimatedStyle(() => ({ height: Math.max(-keyboardHeight.value, insets.bottom) }));
  return <Animated.View style={spacer} />;
}

interface BodyProps {
  roomId: string;
  spaceId: string | null;
  canAttach: boolean;
  canMentionEveryone: boolean;
  customEmojiSpaceId?: string;
  slowmodeSeconds: number;
  inSpace: boolean;
  maxHeight?: number;
}

function ComposerBody({ roomId, spaceId, canAttach, canMentionEveryone, customEmojiSpaceId, slowmodeSeconds, inSpace, maxHeight }: BodyProps) {
  const theme = useTheme();
  const info = useRoomInfo(roomId, spaceId);
  const st = useSolid(() => composerFor(roomId), [roomId]);
  // The web's composer spellcheck setting (Settings > Keybinds): on a phone it is the
  // keyboard's own spellcheck and autocorrect.
  const spellcheck = useSolid(() => settings.spellcheck);
  const sending = useSolid(() => messages.sending[roomId] ?? false, [roomId]);
  const slowmodeLeft = useSlowmodeRemaining(roomId);
  const ctx = useComposerContext(roomId, spaceId, customEmojiSpaceId);
  const emojiCatalog = useEmojiCatalog();
  const { skinTone } = useEmojiPrefs();
  const queue = attachmentQueueFor(roomId);
  const queued = useSolid(() => queue.items(), [queue]);
  const queueError = useSolid(() => queue.error(), [queue]);
  const replyTarget = useReplyTarget(roomId, st.replyTo);
  const editTarget = useEditTarget(roomId, st.editing);
  const editing = st.editing !== null;

  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  // A failure that Retry can't redo (a voice take that didn't start, a GIF that didn't go):
  // shown like a send error, but without the Retry, which would send the draft instead.
  const [localError, setLocalError] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  // Everything above the keyboard's space (suggestions, error line, input row): the expanded
  // panel leaves it in view.
  const [aboveHeight, setAboveHeight] = useState(56);
  const panel = useExpressionPanel({ inputRef, aboveHeight, ...(maxHeight !== undefined ? { maxHeight } : {}) });
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  // ---- the field's text: the draft, or the edit buffer while editing ----------------------
  const stored = editing ? (st.editText ?? '') : st.draft;
  const [text, setText] = useState(stored);
  const textRef = useRef(stored);
  const selection = useRef({ start: stored.length, end: stored.length });
  const [caret, setCaret] = useState(stored.length);
  // Typing writes the store at once, so the two only differ when the store changed under us
  // (a restore after a failed send, edit mode starting or ending). Checked on every render:
  // a send's clear-then-restore can return the store to the value it had at the last render.
  useLayoutEffect(() => {
    if (stored !== textRef.current) {
      textRef.current = stored;
      setText(stored);
      selection.current = { start: stored.length, end: stored.length };
      setCaret(stored.length);
    }
  });

  const typing = useMemo(() => createTypingEmitter(() => void sendTyping(roomId).catch(() => undefined)), [roomId]);

  const writeText = useCallback(
    (next: string, nextCaret?: number) => {
      textRef.current = next;
      setText(next);
      if (editing) setEditText(roomId, next);
      else setDraft(roomId, next);
      if (nextCaret !== undefined) {
        selection.current = { start: nextCaret, end: nextCaret };
        setCaret(nextCaret);
        requestAnimationFrame(() => inputRef.current?.setSelection?.(nextCaret, nextCaret));
      }
    },
    [editing, roomId],
  );

  const onChangeText = (next: string) => {
    // The new caret arrives in a separate selection event; predict it for plain typing so the
    // suggestions don't flicker on the previous caret in between.
    const sel = selection.current;
    if (sel.start === sel.end) {
      const c = Math.max(0, Math.min(next.length, sel.end + (next.length - textRef.current.length)));
      selection.current = { start: c, end: c };
      setCaret(c);
    }
    writeText(next);
    if (!editing && next.length > 0) typing.onInput();
    if (st.sendError) setSendError(roomId, '');
  };

  const onSelectionChange = (e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    selection.current = e.nativeEvent.selection;
    setCaret(e.nativeEvent.selection.end);
  };

  // ---- edit mode: seed the buffer with the readable form of the message ------------------
  useEffect(() => {
    if (!st.editing) {
      editSeeds.delete(roomId);
      return;
    }
    if (editTarget && !editTarget.exists) {
      cancelEdit(roomId);
      return;
    }
    if (st.editText !== null || !editTarget || editTarget.text === null) return;
    const readable = wireToReadable(editTarget.text, ctx.catalog);
    editSeeds.set(roomId, { id: st.editing, text: readable });
    setEditText(roomId, readable);
  }, [st.editing, st.editText, editTarget, ctx.catalog, roomId]);

  // ---- focus when a reply or an edit starts, or on request (never just for entering a room).
  // A request made just before this composer mounted counts too: a push's "Reply" opens the
  // room and asks for the keyboard before the conversation panel has rendered it.
  useEffect(() => {
    if (takeFocusRequest(roomId)) inputRef.current?.focus();
  }, [st.focusRequest, roomId]);

  // Android can kill the app while the photo picker is up; recover the pick on return.
  useEffect(() => {
    let alive = true;
    void recoverPendingPick().then((r) => {
      if (alive && r) void handlePick(queue, r);
    });
    return () => {
      alive = false;
    };
  }, [queue]);

  // ---- autocomplete -----------------------------------------------------------------------
  const completion = useMemo(
    () =>
      focused
        ? computeCompletion(text, caret, {
            participants: ctx.participants,
            roles: ctx.roles,
            rooms: ctx.rooms,
            canMentionEveryone,
            currentUserId: auth.user?.id ?? null,
            customEmojis: ctx.customEmojis,
            emojiCatalog,
            skinTone,
          })
        : null,
    [focused, text, caret, ctx, canMentionEveryone, emojiCatalog, skinTone],
  );

  // Stable identities for the memoised rows (suggestions, queued files): the body re-renders
  // on every keystroke and 10 times a second while recording.
  const completionRef = useRef(completion);
  completionRef.current = completion;
  const writeTextRef = useRef(writeText);
  writeTextRef.current = writeText;
  const pickCompletion = useCallback((c: Candidate) => {
    const open = completionRef.current;
    if (!open) return;
    haptics.selection();
    const next = spliceText(textRef.current, open.queryStart, open.cursorEnd, c.insertText);
    writeTextRef.current(next.text, next.caret);
  }, []);
  const removeQueued = useCallback((localId: string) => queue.remove(localId), [queue]);

  const insertAtCaret = (insert: string) => {
    const { start, end } = selection.current;
    const cur = textRef.current;
    const s = Math.min(start, cur.length);
    const e = Math.min(Math.max(end, s), cur.length);
    const next = spliceText(cur, s, e, insert);
    writeText(next.text, next.caret);
  };

  // ---- sending ----------------------------------------------------------------------------
  const send = async () => {
    const raw = textRef.current.trim();
    if (!hasContent(raw, queue.items().length) || sending || slowmodeLeft > 0) return;
    const wire = raw ? serializeDraft(raw, ctx.catalog) : '';
    const uid = auth.user?.id;
    if (uid) removeTyping(roomId, uid);
    typing.reset();
    const files = queue.take();
    const replyTo = composerFor(roomId).replyTo;
    textRef.current = '';
    setText('');
    clearAfterSend(roomId);
    setLocalError('');
    try {
      const sent = await sendMessage(roomId, wire, replyTo ?? undefined, asWebPendingAttachments(files));
      if (sent === null) throw new NotSentError();
      dismissNewHeader(roomId);
      if (inSpace) startSlowmode(roomId, slowmodeSeconds);
    } catch (err) {
      console.warn('[composer] send failed', err);
      startSlowmode(roomId, retryAfterSeconds(err));
      queue.restore(files);
      restoreAfterFailedSend(roomId, { text: raw, replyTo }, sendErrorText(err));
      haptics.error();
    }
  };
  const sendRef = useRef(send);
  sendRef.current = send;

  const saveEdit = async () => {
    const id = st.editing;
    if (!id || savingEdit) return;
    const raw = textRef.current.trim();
    // Saving an emptied message cancels; it never deletes. Saving it unchanged is a no-op.
    const seed = editSeeds.get(roomId);
    if (!raw || (seed?.id === id && raw === seed.text.trim())) {
      finishEdit(roomId);
      return;
    }
    setSavingEdit(true);
    try {
      // null: the store refused before trying (the room or the session is gone) - not saved.
      if ((await editMessage(roomId, id, readableToWire(raw, ctx.catalog))) === null) throw new NotSentError();
      finishEdit(roomId);
      setSendError(roomId, '');
    } catch (err) {
      console.warn('[composer] edit failed', err);
      setSendError(roomId, sendErrorText(err));
      haptics.error();
    } finally {
      setSavingEdit(false);
    }
  };

  const sendGif = (gif: GifResult) => {
    panel.close();
    if (sending || slowmodeLeft > 0) return;
    setLocalError('');
    sendMessage(roomId, gif.url)
      .then((sent) => {
        if (sent === null) throw new NotSentError();
        dismissNewHeader(roomId);
        if (inSpace) startSlowmode(roomId, slowmodeSeconds);
      })
      .catch((err: unknown) => {
        console.warn('[composer] GIF send failed', err);
        startSlowmode(roomId, retryAfterSeconds(err));
        setLocalError(sendErrorText(err));
        haptics.error();
      });
  };

  // The panel stays open for more (Discord). Unicode emoji go in back to back; a custom
  // emoji's :name: keeps the web's trailing space so the token stays separate.
  const pickEmoji = (pick: EmojiPick) => {
    insertAtCaret(pick.custom ? `:${pick.custom.name}: ` : (pick.unicode ?? ''));
  };

  const customNames = useMemo(() => new Set(ctx.customEmojis.map((c) => c.name)), [ctx.customEmojis]);
  const backspace = () => {
    const next = deleteBackward(textRef.current, selection.current, (name) => customNames.has(name));
    if (next.text !== textRef.current || next.caret !== selection.current.start) writeText(next.text, next.caret);
  };

  // ---- voice messages ---------------------------------------------------------------------
  const recorder = useVoiceRecorder({
    onClip: (clip: VoiceRecording, reason) => {
      if (reason === 'max') toast(t('attachments.voice.maxReached'));
      queue
        .addFiles([clip.file])
        .then(() => {
          // The take joins anything already queued (and the typed text) in one message.
          if (queue.items().some((p) => p.file.uri === clip.file.uri)) void sendRef.current();
        })
        .catch(() => setLocalError(t('attachments.voice.failed')));
    },
    onError: (message) => setLocalError(message),
  });
  const recording = recorder.state.phase !== 'idle';
  // A recording takes the input row; the panel has nothing to insert into meanwhile.
  const closePanel = panel.close;
  useEffect(() => {
    if (recording) closePanel();
  }, [recording, closePanel]);

  // ---- derived UI state -------------------------------------------------------------------
  const content = hasContent(text, queued.length);
  const canSend = content && !sending && slowmodeLeft === 0 && !recording;
  const placeholder = editing
    ? t('messages.editPlaceholder')
    : !info
      ? t('room.messagePlaceholder')
      : info.kind === 'pm'
        ? t('room.messageUser', { name: info.name })
        : info.kind === 'group' || info.kind === 'notes'
          ? t('room.messageRoom', { name: info.name })
          : t('room.messageSpaceRoom', { name: info.name });
  const errorText = st.sendError || queueError || localError;
  const voiceSupported = isVoiceRecordingSupported();

  let action;
  if (editing) {
    action = <SendButton icon="check" label={t('common.save')} onPress={() => void saveEdit()} busy={savingEdit} />;
  } else if (recording && recorder.state.locked) {
    action = <SendButton label={t('attachments.voice.stop')} onPress={recorder.finish} busy={recorder.state.phase === 'starting'} />;
  } else if (recording || (!content && canAttach)) {
    action = <MicButton recorder={recorder} dragX={dragX} dragY={dragY} supported={voiceSupported} disabled={slowmodeLeft > 0} />;
  } else {
    action = <SendButton label={t('common.send')} onPress={() => void send()} disabled={!canSend} busy={sending && content} />;
  }

  return (
    <View>
      {/* What sits above the keyboard's space; the expanded panel leaves it in view. */}
      <View style={{ paddingTop: 6 }} onLayout={(e: LayoutChangeEvent) => setAboveHeight(Math.round(e.nativeEvent.layout.height))}>
        {completion && !recording ? <AutocompleteList list={completion.list} onPick={pickCompletion} /> : null}
        {errorText ? (
          <ErrorLine
            message={errorText}
            action={
              st.sendError && !editing && content ? (
                <Button title={t('common.retry')} size="sm" variant="ghost" onPress={() => void send()} />
              ) : undefined
            }
            onDismiss={() => {
              setSendError(roomId, '');
              queue.setError('');
              setLocalError('');
            }}
          />
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 8, paddingBottom: 6 }} testID="composer-row">
          {recording ? null : (
            <IconButton
              icon="circle-plus"
              size="lg"
              tone="subtle"
              label={canAttach && !editing ? t('composer.attachFiles') : t('composer.attachUnavailable')}
              disabled={!canAttach || editing}
              onPress={() => openAttachMenu({ queue, onGif: () => panel.openPanel('gif') })}
              testID="composer-attach"
            />
          )}
          <View
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: theme.radii.xl,
              backgroundColor: withAlpha(theme.colors.muted, 0.55),
              borderWidth: 1,
              borderColor: focused ? withAlpha(theme.colors.ring, 0.5) : 'transparent',
              overflow: 'hidden',
            }}
          >
            {editing ? (
              <ContextStrip
                icon="pen"
                lead={t('mobile.composer.editing')}
                onCancel={() => cancelEdit(roomId)}
                cancelLabel={t('common.cancel')}
                testID="composer-edit-strip"
              />
            ) : replyTarget ? (
              <ContextStrip
                icon="reply"
                lead={t('composer.replyingTo')}
                name={replyTarget.name}
                preview={replyTarget.preview}
                {...(replyTarget.loaded ? { onPress: () => void jumpToMessage(roomId, replyTarget.id), pressHint: t('messages.replyJump') } : {})}
                onCancel={() => cancelReply(roomId)}
                cancelLabel={t('composer.cancelReply')}
                testID="composer-reply-strip"
              />
            ) : null}
            {!editing ? <PendingAttachments items={queued} onRemove={removeQueued} /> : null}
            {recording ? (
              <RecordingBar state={recorder.state} dragX={dragX} rtl={I18nManager.isRTL} onCancel={recorder.cancel} />
            ) : (
              <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
                {info?.e2ee ? (
                  <View style={{ height: 44, justifyContent: 'center', paddingStart: 12 }} accessible accessibilityLabel={t('room.e2eeBadge')}>
                    <Icon name="lock" size={11} tone="muted" />
                  </View>
                ) : null}
                <TextInput
                  ref={inputRef}
                  value={text}
                  onChangeText={onChangeText}
                  onSelectionChange={onSelectionChange}
                  onFocus={() => {
                    setFocused(true);
                    panel.onInputFocus();
                  }}
                  onBlur={() => setFocused(false)}
                  placeholder={placeholder}
                  placeholderTextColor={theme.colors.mutedForeground}
                  selectionColor={theme.colors.primary}
                  cursorColor={theme.colors.primary}
                  multiline
                  scrollEnabled
                  textAlignVertical="center"
                  autoCorrect={spellcheck}
                  spellCheck={spellcheck}
                  autoCapitalize="sentences"
                  accessibilityLabel={placeholder}
                  testID="composer-input"
                  style={{
                    flex: 1,
                    minHeight: 44,
                    maxHeight: MAX_INPUT_HEIGHT,
                    paddingHorizontal: 12,
                    paddingTop: 11,
                    paddingBottom: 11,
                    color: theme.colors.foreground,
                    fontSize: theme.font(15),
                  }}
                />
                {slowmodeLeft > 0 && !editing ? (
                  <View
                    accessible
                    accessibilityLabel={t('composer.slowmodeWait', { seconds: String(slowmodeLeft) })}
                    accessibilityLiveRegion="polite"
                    testID="composer-slowmode"
                    style={{
                      height: 44,
                      justifyContent: 'center',
                    }}
                  >
                    <View
                      style={{
                        minWidth: 28,
                        height: 24,
                        paddingHorizontal: 7,
                        borderRadius: 12,
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 4,
                        backgroundColor: withAlpha(theme.colors.mutedForeground, 0.18),
                      }}
                    >
                      <Icon name="stopwatch" size={10} tone="muted" />
                      <TextCount value={slowmodeLeft} />
                    </View>
                  </View>
                ) : null}
                {panel.open ? (
                  <IconButton
                    icon="keyboard"
                    tone="subtle"
                    size="lg"
                    label={t('mobile.composer.showKeyboard')}
                    onPress={panel.showKeyboard}
                    testID="composer-keyboard"
                  />
                ) : (
                  <IconButton
                    icon="face-smile"
                    tone="subtle"
                    size="lg"
                    label={t('composer.emoji')}
                    onPress={() => panel.openPanel('emoji')}
                    testID="composer-emoji"
                  />
                )}
              </View>
            )}
          </View>
          <View>
            {recording && !recorder.state.locked ? <LockHint dragY={dragY} /> : null}
            {action}
          </View>
        </View>
      </View>
      {/* The keyboard's space - or the panel's, which sits in it. */}
      <Animated.View style={panel.spacerStyle} />
      {panel.open ? (
        <ExpressionPanel
          panel={panel}
          onPickEmoji={pickEmoji}
          onPickGif={sendGif}
          onBackspace={backspace}
          gifAllowed={!editing}
          currentSpaceId={spaceId}
          {...(customEmojiSpaceId !== undefined ? { customEmojiSpaceId } : {})}
        />
      ) : null}
    </View>
  );
}

function TextCount({ value }: { value: number }) {
  return (
    <Text variant="caption" weight="semibold" style={{ fontVariant: ['tabular-nums'] }}>
      {value}
    </Text>
  );
}
