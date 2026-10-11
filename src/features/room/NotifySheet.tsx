/**
 * A room's notification settings (the web's RoomNotifyMenu) as a bottom sheet: the mode
 * (Use default / All messages / Only @mentions / Nothing - picking one keeps the sheet open,
 * as the web's menu does) and Mute for 15 minutes / 1 hour / 8 hours / 24 hours / until
 * turned back on, or Unmute. lib/roomNotify applies the change to both stores at once and
 * sends it; ROOM_NOTIFY_SETTINGS_UPDATE carries it to the person's other devices.
 */
import { useRef } from 'react';
import { View } from 'react-native';
import {
  NotifyModeAll,
  NotifyModeDefault,
  NotifyModeMentions,
  NotifyModeNone,
  muteRoom,
  setRoomNotifyMode,
  unmuteRoom,
} from '@web/lib/roomNotify';
import { t } from '@web/i18n/t';
import { useRoomInfo, useRoomNotifySettings } from '@/data';
import { Icon, ListRow, ListSection, Sheet, haptics, toast, useExternalStore } from '@/ui';
import { closeRoomNotifySheet, notifySheetStore } from './presenters';
import { errorMessage } from './util';

const MODES = [NotifyModeDefault, NotifyModeAll, NotifyModeMentions, NotifyModeNone];

export const MUTE_DURATIONS: { key: string; ms: number | null }[] = [
  { key: '15m', ms: 15 * 60 * 1000 },
  { key: '1h', ms: 60 * 60 * 1000 },
  { key: '8h', ms: 8 * 60 * 60 * 1000 },
  { key: '24h', ms: 24 * 60 * 60 * 1000 },
  { key: 'forever', ms: null },
];

/** The mode "Use default" resolves to, as its own label (effectiveNotifyMode's words). */
const EFFECTIVE_LABEL: Record<'all' | 'mentions' | 'none', number> = { all: NotifyModeAll, mentions: NotifyModeMentions, none: NotifyModeNone };

function fail(e: unknown) {
  toast.error(errorMessage(e));
}

function NotifyBody({ roomId, spaceId }: { roomId: string; spaceId: string | null }) {
  const settings = useRoomNotifySettings(roomId, spaceId);
  return (
    <View style={{ gap: 12, paddingTop: 8 }}>
      <ListSection>
        {MODES.map((mode) => {
          const checked = settings.notifyMode === mode;
          return (
            <ListRow
              key={mode}
              title={t(`room.notify.modes.${mode}`)}
              subtitle={mode === NotifyModeDefault ? t(`room.notify.modes.${EFFECTIVE_LABEL[settings.effective]}`) : undefined}
              accessibilityRole="radio"
              checked={checked}
              trailing={checked ? <Icon name="check" size={14} tone="primary" /> : null}
              onPress={() => {
                if (checked) return;
                haptics.selection();
                void setRoomNotifyMode(roomId, mode).catch(fail);
              }}
            />
          );
        })}
      </ListSection>
      <ListSection title={t('room.notify.muteSection')}>
        {settings.muted ? (
          <ListRow
            title={t('room.notify.unmute')}
            icon="bell"
            onPress={() => {
              closeRoomNotifySheet();
              void unmuteRoom(roomId).catch(fail);
            }}
          />
        ) : (
          MUTE_DURATIONS.map((d) => (
            <ListRow
              key={d.key}
              title={t(`room.notify.duration.${d.key}`)}
              icon="bell-slash"
              onPress={() => {
                closeRoomNotifySheet();
                void muteRoom(roomId, d.ms).catch(fail);
              }}
            />
          ))
        )}
      </ListSection>
    </View>
  );
}

/** Root-mounted: renders whatever openRoomNotifySheet asked for. */
export function NotifySheetHost() {
  const target = useExternalStore(notifySheetStore);
  // Keep drawing the room while the sheet slides away.
  const last = useRef(target);
  if (target) last.current = target;
  const shown = last.current;
  const info = useRoomInfo(shown?.roomId, shown?.spaceId);
  return (
    <Sheet
      open={!!target}
      onClose={closeRoomNotifySheet}
      icon="bell"
      title={t('room.notify.title')}
      description={info?.name}
      scrollable
      testID="notify-sheet"
    >
      {shown ? <NotifyBody roomId={shown.roomId} spaceId={shown.spaceId} /> : null}
    </Sheet>
  );
}
