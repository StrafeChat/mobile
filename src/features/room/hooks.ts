/**
 * Small reads the room area's screens share.
 */
import { useEffect, useState } from 'react';
import { messages } from '@web/stores/messages';
import { auth } from '@web/stores/auth';
import { getBackupStatus } from '@web/lib/e2ee/keyBackup';
import { cryptoHost, type HostState } from '@/platform/crypto';
import { channelRowView, pmRowView, threadRowView, useDerived } from '@/data';

/** The E2EE engine's state ('failed' = encryption unavailable until the app restarts). */
export function useCryptoHostState(): HostState {
  const [state, setState] = useState<HostState>(cryptoHost.state);
  useEffect(() => {
    setState(cryptoHost.state);
    return cryptoHost.onStateChange(setState);
  }, []);
  return state;
}

/** Loaded messages of a room still waiting for their Megolm key. */
export function pendingDecryptCount(roomId: string): number {
  let n = 0;
  for (const m of messages.byRoom[roomId] ?? []) {
    if (m.decryptPending && !m.system_type && !m.id.startsWith('temp-')) n++;
  }
  return n;
}

export function usePendingDecryptCount(roomId: string): number {
  return useDerived(`room:pendingDecrypts:${roomId}`, () => pendingDecryptCount(roomId));
}

/** Unread messages in a room, the way its row in the room list counts them (0 = read). */
export function roomUnreadCount(roomId: string, spaceId: string | null | undefined, kind: string | undefined): number {
  if (kind === 'pm' || kind === 'group' || kind === 'notes') return pmRowView(roomId, null)?.unread ?? 0;
  if (!spaceId) return 0;
  if (kind === 'thread') return threadRowView(spaceId, roomId, null)?.unread ?? 0;
  return channelRowView(spaceId, roomId, null)?.unread ?? 0;
}

export function useRoomUnreadCount(roomId: string, spaceId: string | null | undefined, kind: string | undefined): number {
  return useDerived(`room:unread:${roomId}:${spaceId ?? ''}:${kind ?? ''}`, () => roomUnreadCount(roomId, spaceId, kind));
}

let backupKnown: { userId: string; exists: boolean } | null = null;
let backupAsk: Promise<boolean> | null = null;

/** Whether the account has a key backup (asked once per session, only when `enabled`). */
export function useBackupExists(enabled: boolean): boolean {
  const uid = auth.user?.id ?? null;
  const [exists, setExists] = useState(() => (backupKnown && backupKnown.userId === uid ? backupKnown.exists : false));
  useEffect(() => {
    if (!enabled || !uid) return;
    if (backupKnown && backupKnown.userId === uid) {
      setExists(backupKnown.exists);
      return;
    }
    let live = true;
    backupAsk ??= getBackupStatus(uid)
      .then((s) => {
        backupKnown = { userId: uid, exists: s.exists };
        return s.exists;
      })
      .catch(() => false)
      .finally(() => {
        backupAsk = null;
      });
    void backupAsk.then((v) => {
      if (live) setExists(v);
    });
    return () => {
      live = false;
    };
  }, [enabled, uid]);
  return exists;
}
