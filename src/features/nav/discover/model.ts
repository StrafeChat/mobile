/**
 * Discover's client-side filtering (DiscoverPage): the search matches tagline, tags, a space's
 * name and description, and a bot's name, description, username and display name,
 * case-insensitively; "This instance" hides listings federated in from elsewhere.
 */
import type { DiscoverEntry } from '@web/api/discover';

export type DiscoverTab = 'spaces' | 'bots';
export type DiscoverScope = 'all' | 'local';

export function matchesDiscover(e: DiscoverEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [
    e.tagline,
    ...e.tags,
    e.space?.name,
    e.space?.description,
    e.bot?.name,
    e.bot?.description,
    e.bot?.bot?.username,
    e.bot?.bot?.display_name,
  ];
  return hay.some((h) => !!h && h.toLowerCase().includes(q));
}

export function visibleListings(
  list: readonly DiscoverEntry[],
  tab: DiscoverTab,
  scope: DiscoverScope,
  query: string,
): DiscoverEntry[] {
  const scoped = tab === 'spaces' && scope === 'local' ? list.filter((e) => !e.space?.origin_domain) : list;
  return scoped.filter((e) => matchesDiscover(e, query));
}

/** The scope control only appears when some listing came from another instance. */
export function hasRemoteListings(list: readonly DiscoverEntry[]): boolean {
  return list.some((e) => !!e.space?.origin_domain);
}

/**
 * "Open" instead of "Join": a local listing for a space you are in. A space listed by another
 * instance is only yours once mirrored here, under a local id the join hands back - so a remote
 * card is never "already joined" by its origin id.
 */
export function isJoinedListing(e: DiscoverEntry, mySpaceIds: ReadonlySet<string>): boolean {
  return !!e.space && !e.space.origin_domain && mySpaceIds.has(e.space.id);
}
