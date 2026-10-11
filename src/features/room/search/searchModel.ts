/**
 * The search screen's query: free text plus filter chips (From, In, Has, Mentions) instead of
 * the web's typed `key:value` tokens - serialised into the very same query grammar with the
 * web's own applyFilterToken, so parseSearchQuery, the server search and the local (E2EE)
 * search all read it exactly as they read the web's search box. People and rooms go in by id,
 * which parseSearchQuery resolves whether or not they are in the catalog. Typed tokens in the
 * text still work.
 */
import {
  applyFilterToken,
  HAS_VALUES,
  parseSearchQuery,
  type ParsedSearchQuery,
  type SearchCatalog,
  type SearchFilterKey,
  type SearchHasFilter,
  type SearchMatch,
} from '@web/lib/messageSearch';

export { HAS_VALUES };
export type { SearchHasFilter };

export interface FilterValue {
  /** What goes in the query (a user or room id, or a has: kind). */
  value: string;
  /** What the chip shows. */
  label: string;
}

export type SearchFilters = Partial<Record<SearchFilterKey, FilterValue>>;

/** The filter keys a scope offers: `in:` only spans a space's rooms. */
export function filterKeysFor(isSpace: boolean): SearchFilterKey[] {
  return isSpace ? ['from', 'in', 'has', 'mentions'] : ['from', 'has', 'mentions'];
}

/** Free text + chips -> the raw query the web's search functions take. */
export function buildSearchQuery(text: string, filters: SearchFilters): string {
  let raw = text.trim();
  for (const key of ['from', 'in', 'has', 'mentions'] as SearchFilterKey[]) {
    const f = filters[key];
    if (f?.value) raw = applyFilterToken(raw, null, key, f.value);
  }
  return raw.trim();
}

/** Parse what buildSearchQuery produced (with the catalog for typed names). */
export function parseBuiltQuery(raw: string, catalog: SearchCatalog): ParsedSearchQuery {
  return parseSearchQuery(raw, catalog);
}

export interface ResultGroup {
  roomId: string;
  matches: SearchMatch[];
}

/** Space search: consecutive hits from one room under one "# room" header (the web's grouping). */
export function groupMatches(list: readonly SearchMatch[]): ResultGroup[] {
  const out: ResultGroup[] = [];
  for (const m of list) {
    const last = out[out.length - 1];
    if (last && last.roomId === m.roomId) last.matches.push(m);
    else out.push({ roomId: m.roomId, matches: [m] });
  }
  return out;
}

export type SearchRow =
  | { kind: 'note'; key: string; icon: string; text: string; tone: 'muted' | 'danger' }
  | { kind: 'room'; key: string; roomId: string }
  | { kind: 'hit'; key: string; match: SearchMatch }
  | { kind: 'more'; key: string };

/** The result list's rows: notes, then (grouped in a space) the hits, then "Load more". */
export function searchRows(input: {
  matches: readonly SearchMatch[];
  grouped: boolean;
  notes: { icon: string; text: string; tone?: 'muted' | 'danger' }[];
  hasMore: boolean;
}): SearchRow[] {
  const rows: SearchRow[] = input.notes.map((n, i) => ({ kind: 'note', key: `note:${i}`, icon: n.icon, text: n.text, tone: n.tone ?? 'muted' }));
  if (input.grouped) {
    groupMatches(input.matches).forEach((g, gi) => {
      rows.push({ kind: 'room', key: `room:${gi}:${g.roomId}`, roomId: g.roomId });
      for (const m of g.matches) rows.push({ kind: 'hit', key: `hit:${m.roomId}:${m.message.id}`, match: m });
    });
  } else {
    for (const m of input.matches) rows.push({ kind: 'hit', key: `hit:${m.roomId}:${m.message.id}`, match: m });
  }
  if (input.hasMore) rows.push({ kind: 'more', key: 'more' });
  return rows;
}

// ---- people (the From / Mentions pickers) ---------------------------------------------------------

export interface PickablePerson {
  id: string;
  username: string;
  display_name?: string;
  avatar?: string;
  bot?: boolean;
}

export function personLabel(p: PickablePerson): string {
  return p.display_name || p.username;
}

/** People whose name or username contains `query` (case-insensitive, a leading @ ignored). */
export function filterPeople<T extends PickablePerson>(people: readonly T[], query: string): T[] {
  const q = query.trim().replace(/^@/, '').toLowerCase();
  if (!q) return [...people];
  return people.filter((p) => p.username.toLowerCase().includes(q) || (p.display_name ?? '').toLowerCase().includes(q));
}
