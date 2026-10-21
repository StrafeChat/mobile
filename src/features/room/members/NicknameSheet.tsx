/**
 * "Change Nickname" (the web's NicknameDialog) as a bottom sheet, for presentNicknameSheet:
 * one field prefilled with the current nickname (the global name as its placeholder), Save,
 * "Reset nickname" while one is set, and Cancel. Saving an empty field clears the nickname,
 * which shows the display name again.
 *
 * Your own goes to `@me`, anyone else's to their id. The server applies the rule again (Change
 * Nickname for your own; Manage Nicknames and a higher role for someone else's; the owner's
 * only by the owner) and its refusal is shown in the sheet. A nickname the server would refuse
 * (lib/spaceProfileLimits: 32 characters as it counts them, on one line, something visible)
 * says why as it is typed, and Save waits.
 *
 * The answer goes into the space's member list only when that list is loaded (the web's
 * NicknameDialog): a list this started would hold a single member, and an E2EE space room
 * shares its Megolm key from that list.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { ensureSpaceMembers, spaceMembers, upsertSpaceMember } from '@web/stores/spaceMembers';
import { inputMaxLength, spaceProfileFieldError } from '@web/lib/spaceProfileLimits';
import { useSolid } from '@/bridge/solid';
import { patchSpaceMember, resolveSpaceUser, spaceMemberOf } from '@/data';
import { Button, Input, Sheet, useExternalStore } from '@/ui';
import { dismissNicknameSheet, nicknameSheetStore, nicknameValue, type NicknameSheetRequest } from '../nicknameSheet';
import { errorMessage } from '../util';

export function NicknameSheetHost() {
  const request = useExternalStore(nicknameSheetStore);
  // Keep showing the last request while the sheet slides away.
  const last = useRef<(NicknameSheetRequest & { id: number }) | null>(request);
  if (request) last.current = request;
  const shown = last.current;
  const spaceId = shown?.spaceId ?? null;
  const userId = shown?.userId ?? null;
  const target = useSolid(() => {
    if (!spaceId || !userId) return null;
    const view = resolveSpaceUser(spaceId, userId);
    return { known: !!spaceMemberOf(spaceId, userId), nick: view.nick ?? '', name: view.name, globalName: view.globalName };
  }, [spaceId, userId]);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState<'save' | 'reset' | null>(null);
  const [error, setError] = useState('');

  const requestId = request?.id;
  useEffect(() => {
    if (!request) return;
    setValue(target?.nick ?? '');
    setError('');
    setBusy(null);
    // Opened on someone whose row is not loaded yet: the space's list brings it (and the
    // current nickname) in; the field fills in below once it arrives.
    if (!spaceMemberOf(request.spaceId, request.userId)) void ensureSpaceMembers(request.spaceId).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestId]);

  // The row arrived after the sheet opened, before anything was typed: show its nickname.
  const knownNick = target?.known ? target.nick : null;
  const typed = useRef(false);
  useEffect(() => {
    typed.current = false;
  }, [requestId]);
  useEffect(() => {
    if (knownNick !== null && !typed.current) setValue(knownNick);
  }, [knownNick]);

  if (!shown || !target) return <Sheet open={false} onClose={() => undefined} />;
  const isSelf = shown.userId === auth.user?.id;

  async function send(nick: string | null, kind: 'save' | 'reset') {
    if (!request || busy) return;
    const { spaceId: sid, userId: uid } = request;
    setBusy(kind);
    setError('');
    try {
      const member = await patchSpaceMember(sid, isSelf ? '@me' : uid, { nick });
      // The API calls never touch the stores: show it now, ahead of the gateway's update -
      // into a loaded list only (see the file comment).
      if (spaceMembers.bySpaceId[sid]?.length) upsertSpaceMember(sid, member);
      dismissNicknameSheet();
    } catch (e) {
      setError(errorMessage(e, 'spaceProfile.dialog.failed'));
    } finally {
      setBusy(null);
    }
  }

  const unchanged = nicknameValue(value) === (target.nick.trim() || null);
  /** Why the server would refuse what is typed, translated; an unchanged value is not judged. */
  const problemKey = unchanged ? undefined : spaceProfileFieldError('nick', value);
  const problem = problemKey ? t(problemKey) : '';

  return (
    <Sheet
      open={!!request}
      onClose={() => {
        if (nicknameSheetStore.get()) dismissNicknameSheet();
      }}
      title={isSelf ? t('spaceProfile.dialog.titleSelf') : t('spaceProfile.dialog.titleOther', { name: target.name })}
      dismissible={!busy}
      testID="nickname-sheet"
    >
      <View style={{ gap: 14, paddingTop: 8 }}>
        <Input
          label={t('spaceProfile.dialog.label')}
          placeholder={target.globalName}
          hint={t('spaceProfile.dialog.hint')}
          value={value}
          onChangeText={(v) => {
            typed.current = true;
            setError('');
            setValue(v);
          }}
          maxLength={inputMaxLength('nick')}
          error={problem || error || undefined}
          disabled={!!busy}
          autoFocus
          selectTextOnFocus
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => {
            if (!unchanged && !problem) void send(nicknameValue(value), 'save');
          }}
          testID="nickname-input"
        />
        {target.nick ? (
          <Button
            title={t('spaceProfile.dialog.reset')}
            variant="outline"
            icon="rotate-left"
            loading={busy === 'reset'}
            disabled={!!busy}
            onPress={() => void send(null, 'reset')}
            testID="nickname-reset"
          />
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title={t('common.cancel')} variant="ghost" style={{ flex: 1 }} disabled={!!busy} onPress={dismissNicknameSheet} />
          <Button
            title={t('common.save')}
            style={{ flex: 1 }}
            loading={busy === 'save'}
            disabled={!!busy || unchanged || !!problem}
            onPress={() => void send(nicknameValue(value), 'save')}
            testID="nickname-save"
          />
        </View>
      </View>
    </Sheet>
  );
}
