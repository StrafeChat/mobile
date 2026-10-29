/**
 * The Friends screen's lists and the add-friend handle rules, as FriendsPage computes them.
 * Pure functions over the relationships list (plus live presence), so the tabs are testable.
 *
 * Tabs: Online = friends whose live or embedded status is online or idle (DND does not count,
 * as on the web); All = every friend; Pending = incoming then outgoing requests (the tab's
 * count is incoming only); Blocked.
 */
import type { Relationship } from '@web/api/relationships';
import { RelType } from '@web/stores/relationships';
import { isPresentStatus, isVisibleStatus, type UserPresence } from '@web/stores/presence';
import { playingLabel } from '@/data/activity';

export type FriendsTab = 'online' | 'all' | 'pending' | 'blocked';

export const FRIENDS_TABS: readonly FriendsTab[] = ['online', 'all', 'pending', 'blocked'];

/** The same grammar equinox accepts: a username, optionally @domain[:port]. */
export const HANDLE_RE = /^([A-Za-z0-9_.\-]{2,32})(?:@([A-Za-z0-9.\-]+(?::\d+)?))?$/;

/** What to send for a typed handle (a leading "@" dropped), or null when it is malformed. */
export function normalizeHandle(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, '');
  return HANDLE_RE.test(handle) ? handle : null;
}

export interface FriendsSection {
  /** i18n key of the section header (friends.sections.*), shown with its count. */
  titleKey: string;
  kind: 'friend' | 'incoming' | 'outgoing' | 'blocked';
  userIds: string[];
}

export function friendSections(
  list: readonly Relationship[],
  tab: FriendsTab,
  presenceOf: (userId: string) => UserPresence | undefined,
): FriendsSection[] {
  const of = (type: number) => list.filter((r) => r.type === type);
  const ids = (rs: readonly Relationship[]) => rs.map((r) => r.user.id);
  switch (tab) {
    case 'online': {
      const online = of(RelType.Friend).filter(
        (r) => isVisibleStatus(presenceOf(r.user.id)?.status) || isVisibleStatus(r.user.presence?.status),
      );
      return online.length ? [{ titleKey: 'friends.sections.online', kind: 'friend', userIds: ids(online) }] : [];
    }
    case 'all': {
      const all = of(RelType.Friend);
      return all.length ? [{ titleKey: 'friends.sections.all', kind: 'friend', userIds: ids(all) }] : [];
    }
    case 'pending': {
      const out: FriendsSection[] = [];
      const incoming = of(RelType.IncomingRequest);
      const outgoing = of(RelType.OutgoingRequest);
      if (incoming.length) out.push({ titleKey: 'friends.sections.incoming', kind: 'incoming', userIds: ids(incoming) });
      if (outgoing.length) out.push({ titleKey: 'friends.sections.sent', kind: 'outgoing', userIds: ids(outgoing) });
      return out;
    }
    case 'blocked': {
      const blocked = of(RelType.Blocked);
      return blocked.length ? [{ titleKey: 'friends.sections.blocked', kind: 'blocked', userIds: ids(blocked) }] : [];
    }
  }
}

/** Whether there are any relationships at all (the "add friends to get started" state). */
export function hasAnyRelationship(list: readonly Relationship[]): boolean {
  return list.some(
    (r) =>
      r.type === RelType.Friend ||
      r.type === RelType.IncomingRequest ||
      r.type === RelType.OutgoingRequest ||
      r.type === RelType.Blocked,
  );
}

export function incomingCount(list: readonly Relationship[]): number {
  return list.filter((r) => r.type === RelType.IncomingRequest).length;
}

export interface FriendLine {
  /** The line as plain text (also the row's accessibility label). */
  text: string;
  /** The game's name when the line is what they are playing (set in bold). */
  playing?: string;
}

/**
 * The line under a friend (FriendsPage's FriendRow): while they are around, their custom
 * status, else what they are playing, else their handle. `live` is their entry in the
 * presence store, undefined when it has none - then the relationship's own presence stands
 * in for the status and custom status, but never for the game (only the store has a current
 * one), and a store entry without a custom status never falls back to the relationship's.
 */
export function friendLine(rel: Relationship, live: UserPresence | undefined, handle: string): FriendLine {
  const st = live?.status ?? rel.user.presence?.status;
  if (!isPresentStatus(st)) return { text: handle };
  const custom = (live ? live.custom_status : rel.user.presence?.custom_status) || undefined;
  if (custom) return { text: custom };
  const playing = live && isPresentStatus(live.status) ? live.activities?.[0]?.name : undefined;
  return playing ? { text: playingLabel(playing), playing } : { text: handle };
}

/** The status line under a friend, as plain text (friendLine). */
export function friendSubtitle(rel: Relationship, live: UserPresence | undefined, handle: string): string {
  return friendLine(rel, live, handle).text;
}
