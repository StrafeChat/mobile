/**
 * One conversation: the header, the banners, the message list, who is typing and the
 * composer - for a PM, a group, Notes, a space text channel or a thread, in the shell's
 * content panel or on a pushed screen (a thread). A space voice room shows its voice view.
 *
 * The list (chat area) enters and leaves the room in the stores; the composer (composer area)
 * sends (and rises with the keyboard). This view owns the frame around them: the header and
 * its sheets, the banners, the member drawer's availability, and what to show while the room
 * is not known yet or no longer exists.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { upsertSpaceRoomFromPayload } from '@web/stores/spaces';
import { t } from '@web/i18n/t';
import { roomInfo, useEnsureRoomPins, useRoomInfo, useSession, useSpaceRoomsLoaded, type RoomInfo } from '@/data';
import { MessageList, TYPING_ROW_HEIGHT, TypingIndicator } from '@/features/chat';
import { Composer } from '@/features/composer';
import { openNav, openRoom, setMembersAvailable } from '@/shell/state';
import { useIsWide } from '@/shell/SwipeShell';
import { useTheme } from '@/theme';
import { Button, EmptyState, Header, Spinner } from '@/ui';
import { RoomBanners } from './RoomBanners';
import { RoomHeader } from './RoomHeader';
import { RoomInfoSheet } from './RoomInfoSheet';
import { VoiceRoomView } from './VoiceRoomView';
import { backToShell, goBack } from './navigation';
import type { RoomMode } from './roomActions';
import { fetchThreadOnce } from './threads/data';

export interface RoomViewProps {
  roomId: string;
  /** The room's space when the caller knows it; null for a PM; undefined to look it up. */
  spaceId?: string | null;
  /** 'shell' (the content panel) or 'screen' (pushed over the shell, e.g. a thread). */
  mode?: RoomMode;
}

function useBack(mode: RoomMode): (() => void) | undefined {
  const wide = useIsWide();
  if (mode === 'screen') return goBack;
  return wide ? undefined : openNav;
}

/** The room isn't in the stores (yet): loading, a thread to fetch, or gone. */
function RoomMissing({ roomId, spaceId, mode }: { roomId: string; spaceId: string | null | undefined; mode: RoomMode }) {
  const theme = useTheme();
  const session = useSession();
  const roomsLoaded = useSpaceRoomsLoaded(spaceId ?? '');
  const onBack = useBack(mode);
  const [lookup, setLookup] = useState<'idle' | 'fetching' | 'gone'>('idle');

  // A thread the live list doesn't hold (archived, a deep link, a footer that only knew its
  // id): fetch its record once and put it in its space's list. Not for PMs (spaceId null),
  // and not before the space's own list could have answered.
  const ready = session.hydrated && spaceId !== null && (!spaceId || roomsLoaded);
  useEffect(() => {
    if (!ready) return;
    let live = true;
    setLookup('fetching');
    void fetchThreadOnce(roomId).then((r) => {
      if (!live) return;
      const sid = r ? (r.room.space_id ?? spaceId) : null;
      if (r && sid) upsertSpaceRoomFromPayload(sid, r.raw);
      // Found and stored: the view switches to the conversation as the store updates. If the
      // record still doesn't make a room (an unusable payload), stop the spinner.
      if (!r || !sid || !roomInfo(roomId, sid)) setLookup('gone');
    });
    return () => {
      live = false;
    };
  }, [roomId, spaceId, ready]);

  // 'idle' while ready is the render before the lookup starts: still loading, not "not found".
  const loading = !session.hydrated || (!!spaceId && !roomsLoaded) || lookup === 'fetching' || (ready && lookup === 'idle');
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Header title={loading ? t('common.loading') : t('room.conversation')} onBack={onBack} />
      {loading ? (
        <Spinner fill label={spaceId ? t('space.loadingRoom') : t('common.loading')} />
      ) : (
        <EmptyState
          icon="circle-question"
          body={t('room.notFound')}
          size="page"
          action={
            mode === 'screen' ? (
              <Button title={t('common.back')} variant="secondary" onPress={goBack} />
            ) : onBack ? (
              <Button title={t('mobile.room.openRooms')} variant="secondary" onPress={onBack} />
            ) : undefined
          }
        />
      )}
    </View>
  );
}

function Conversation({ info, mode }: { info: RoomInfo; mode: RoomMode }) {
  const theme = useTheme();
  const onBack = useBack(mode);
  const [infoOpen, setInfoOpen] = useState(false);
  // The body under the header and banners: the composer's emoji panel may expand to all of it
  // but the typing row (the list shrinks to nothing, as in Discord's expanded panel).
  const [bodyHeight, setBodyHeight] = useState(0);
  const spaceId = info.spaceId ?? null;
  useEnsureRoomPins(info.id);

  const onThreadDeleted = (parentId: string | undefined) => {
    if (mode === 'screen') {
      goBack();
      return;
    }
    if (parentId) openRoom(parentId, spaceId);
    else openNav();
    backToShell();
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }} testID={`room-${info.id}`}>
      <RoomHeader info={info} mode={mode} onBack={onBack} onOpenInfo={() => setInfoOpen(true)} />
      <RoomBanners info={info} />
      {/* The composer rises with the keyboard itself (it pads by the keyboard's height, or the
          emoji panel's, which takes the keyboard's place), so the list above it shrinks;
          nothing else here may add keyboard avoidance on top. */}
      <View style={{ flex: 1 }} onLayout={(e) => setBodyHeight(e.nativeEvent.layout.height)}>
        <View style={{ flex: 1 }}>
          <MessageList roomId={info.id} spaceId={spaceId} />
        </View>
        <TypingIndicator roomId={info.id} />
        <Composer roomId={info.id} spaceId={spaceId} {...(bodyHeight > 0 ? { maxHeight: bodyHeight - TYPING_ROW_HEIGHT } : {})} />
      </View>
      <RoomInfoSheet info={info} mode={mode} open={infoOpen} onClose={() => setInfoOpen(false)} onThreadDeleted={onThreadDeleted} />
    </View>
  );
}

function VoiceRoom({ info, mode }: { info: RoomInfo; mode: RoomMode }) {
  const onBack = useBack(mode);
  return <VoiceRoomView info={info} onBack={onBack} />;
}

export function RoomView({ roomId, spaceId, mode = 'shell' }: RoomViewProps) {
  const info = useRoomInfo(roomId, spaceId);
  const hasMembers = !!info?.hasMemberList;

  // The shell's member drawer exists only for rooms with a member list (groups, channels,
  // threads); a pushed screen shows members in a sheet instead.
  useEffect(() => {
    if (mode !== 'shell') return;
    setMembersAvailable(hasMembers);
    return () => {
      setMembersAvailable(false);
    };
  }, [mode, hasMembers]);

  if (!info) return <RoomMissing roomId={roomId} spaceId={spaceId} mode={mode} />;
  if (info.kind === 'voice') return <VoiceRoom info={info} mode={mode} />;
  if (info.kind === 'section') return <RoomMissing roomId={roomId} spaceId={null} mode={mode} />;
  return <Conversation info={info} mode={mode} />;
}
