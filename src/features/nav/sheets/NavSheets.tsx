/**
 * Host for the nav area's sheets (sheets/store.ts). NavPanel mounts one, and the app root may
 * mount another (exported as NavHosts) so the sheets also work on a screen opened without the
 * shell beneath it (a cold-start deep link). Only the first mounted host renders; if it goes
 * away the next one takes over. Each open mounts a fresh sheet (keyed), so no state leaks from
 * the last one; the previous sheet stays rendered while it animates closed.
 */
import { useEffect, useRef, useState } from 'react';
import { createExternalStore, useExternalStore } from '@/ui';
import { AddFriendSheet } from './AddFriendSheet';
import { CreateRoomSheet, CreateSectionSheet } from './CreateRoomSheet';
import { CustomStatusSheet } from './CustomStatusSheet';
import { AddPeopleSheet, CreateGroupSheet } from './FriendPickerSheets';
import { InviteSheet } from './InviteSheet';
import { closeNavSheet, navSheetStore, type NavSheet } from './store';

const hosts = createExternalStore<readonly number[]>([]);
let nextHostId = 0;

export function NavSheets() {
  const id = useRef(0);
  if (id.current === 0) id.current = ++nextHostId;
  useEffect(() => {
    const me = id.current;
    hosts.set((list) => [...list, me]);
    return () => hosts.set((list) => list.filter((h) => h !== me));
  }, []);
  const active = useExternalStore(hosts)[0] === id.current;
  return active ? <NavSheetsHost /> : null;
}

function NavSheetsHost() {
  const requested = useExternalStore(navSheetStore);
  const [shown, setShown] = useState<{ sheet: NavSheet; key: number } | null>(null);
  const [open, setOpen] = useState(false);
  const counter = useRef(0);

  useEffect(() => {
    if (requested) {
      counter.current += 1;
      setShown({ sheet: requested, key: counter.current });
      setOpen(true);
    } else {
      setOpen(false);
    }
  }, [requested]);

  if (!shown) return null;
  const { sheet, key } = shown;
  const props = {
    open,
    onRequestClose: () => closeNavSheet(),
    onClosed: () => {
      // Closed by a swipe, the backdrop or back: clear the request too (unless a newer one
      // replaced it meanwhile).
      if (navSheetStore.get() === sheet) closeNavSheet();
      setShown((cur) => (cur?.key === key ? null : cur));
    },
  };
  switch (sheet.kind) {
    case 'invite':
      return <InviteSheet key={key} spaceId={sheet.spaceId} {...props} />;
    case 'createRoom':
      return <CreateRoomSheet key={key} spaceId={sheet.spaceId} parentSectionId={sheet.parentSectionId} {...props} />;
    case 'createSection':
      return <CreateSectionSheet key={key} spaceId={sheet.spaceId} {...props} />;
    case 'createGroup':
      return <CreateGroupSheet key={key} {...props} />;
    case 'addPeople':
      return <AddPeopleSheet key={key} roomId={sheet.roomId} {...props} />;
    case 'addFriend':
      return <AddFriendSheet key={key} {...props} />;
    case 'customStatus':
      return <CustomStatusSheet key={key} {...props} />;
  }
}
