/**
 * "Change Nickname" (the web's NicknameDialog) as a bottom sheet, for presentNicknameSheet:
 * one field prefilled with the current nickname (the global name as its placeholder), Save,
 * "Reset nickname" while one is set, and Cancel. Saving an empty field clears the nickname,
 * which shows the display name again.
 *
 * Your own goes to `@me`, anyone else's to their id. The server applies the rule again (Change
 * Nickname for your own; Manage Nicknames and a higher role for someone else's; the owner's
 * only by the owner) and its refusal is shown in the sheet.
 */
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { t } from '@web/i18n/t';
import { auth } from '@web/stores/auth';
import { ensureSpaceMembers, upsertSpaceMember } from '@web/stores/spaceMembers';
import { useSolid } from '@/bridge/solid';
import { patchSpaceMember, resolveSpaceUser, spaceMemberOf } from '@/data';
import { Button, Input, Sheet, useExternalStore } from '@/ui';
import { dismissNicknameSheet, nicknameSheetStore, nicknameValue, type NicknameSheetRequest } from '../nicknameSheet';
import { errorMessage } from '../util';

/** Server limit (equinox spaces/member_profile.go MaxNicknameRunes). */
export const NICKNAME_MAX_LENGTH = 32;

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
      // The API calls never touch the stores: show it now, ahead of the gateway's update.
      upsertSpaceMember(sid, member);
      dismissNicknameSheet();
    } catch (e) {
      setError(errorMessage(e, 'mobile.room.nickname.failed'));
    } finally {
      setBusy(null);
    }
  }

  const unchanged = nicknameValue(value) === (target.nick.trim() || null);

  return (
    <Sheet
      open={!!request}
      onClose={() => {
        if (nicknameSheetStore.get()) dismissNicknameSheet();
      }}
      title={isSelf ? t('mobile.room.nickname.titleSelf') : t('mobile.room.nickname.titleOther', { name: target.name })}
      dismissible={!busy}
      testID="nickname-sheet"
    >
      <View style={{ gap: 14, paddingTop: 8 }}>
        <Input
          label={t('mobile.room.nickname.label')}
          placeholder={target.globalName}
          hint={t('mobile.room.nickname.hint')}
          value={value}
          onChangeText={(v) => {
            typed.current = true;
            setError('');
            setValue(v);
          }}
          maxLength={NICKNAME_MAX_LENGTH}
          error={error || undefined}
          disabled={!!busy}
          autoFocus
          selectTextOnFocus
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={() => {
            if (!unchanged) void send(nicknameValue(value), 'save');
          }}
          testID="nickname-input"
        />
        {target.nick ? (
          <Button
            title={t('mobile.room.nickname.reset')}
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
            disabled={!!busy || unchanged}
            onPress={() => void send(nicknameValue(value), 'save')}
            testID="nickname-save"
          />
        </View>
      </View>
    </Sheet>
  );
}
