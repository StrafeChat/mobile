/**
 * The emoji picker's content as data: sections (Frequently used, each space's custom emoji,
 * the Unicode groups), search results, and the flat header/row list a virtualised grid draws.
 *
 * Same sources, filters and caps as the web's EmojiPicker: recent keys 'u:<unicode>' /
 * 'c:<id>', custom emoji limited to one space when the viewer lacks Use External Emojis,
 * search = custom names containing the query (max 24) then searchEmoji (max 96). The
 * conversation's own space comes first among the custom emoji (Discord's order). Where the
 * web renders only the active category, the phone scrolls through all of them with the rail
 * jumping between sections (the mobile pattern the inventory asks for).
 */
import { EMOJI_GROUPS, searchEmoji, withSkinTone, type EmojiCatalog, type EmojiEntry } from '@web/lib/emoji/data';
import { t } from '@web/i18n/t';

export interface PickerCustomEmoji {
  id: string;
  name: string;
  url: string;
  space_id?: string | null;
}

export interface EmojiCell {
  key: string;
  /** Unicode to insert (skin tone applied). */
  unicode?: string;
  /** Base Unicode, the recent-list key. */
  baseUnicode?: string;
  custom?: PickerCustomEmoji;
  /** ':shortcode:' / ':name:' - the long-press preview and the accessibility label. */
  label: string;
}

export type CategoryId = 'recent' | `space:${string}` | `group:${number}`;

export interface EmojiSection {
  id: CategoryId;
  title: string;
  /** Font Awesome glyph for the rail (Unicode groups and Recent). */
  icon?: string;
  /** Space sections: the space's icon URL / acronym for the rail. */
  spaceIcon?: string;
  acronym?: string;
  cells: EmojiCell[];
}

export interface SpaceEmojiSet {
  spaceId: string;
  name: string;
  icon?: string;
  acronym: string;
  emojis: readonly PickerCustomEmoji[];
}

export type GridRow =
  | { kind: 'header'; key: string; sectionId: CategoryId; title: string }
  | { kind: 'row'; key: string; sectionId: CategoryId; cells: EmojiCell[] }
  | { kind: 'status'; key: string; text: string };

export const SEARCH_CUSTOM_MAX = 24;
export const SEARCH_UNICODE_MAX = 96;

export function unicodeCell(e: EmojiEntry, tone: number): EmojiCell {
  return { key: `u:${e.hexcode}`, unicode: withSkinTone(e, tone), baseUnicode: e.unicode, label: `:${e.shortcode}:` };
}

export function customCell(c: PickerCustomEmoji): EmojiCell {
  return { key: `c:${c.id}`, custom: c, label: `:${c.name}:` };
}

/** The recent-list key a picked cell is stored under (the web's format). */
export function recentKeyOf(cell: EmojiCell): string | null {
  if (cell.custom) return `c:${cell.custom.id}`;
  if (cell.baseUnicode) return `u:${cell.baseUnicode}`;
  return null;
}

export interface SectionsInput {
  catalog: EmojiCatalog | null;
  recent: readonly string[];
  spaces: readonly SpaceEmojiSet[];
  /** Restrict custom emoji to this space (no Use External Emojis). */
  onlySpaceId?: string;
  /** The conversation's space: its emoji come first (Discord's order). */
  currentSpaceId?: string | null;
  customById: (id: string) => PickerCustomEmoji | undefined;
  tone: number;
}

const allows = (onlySpaceId: string | undefined, spaceId: string | null | undefined) =>
  onlySpaceId === undefined || spaceId === onlySpaceId;

export function buildEmojiSections(input: SectionsInput): EmojiSection[] {
  const { catalog, tone, onlySpaceId } = input;
  const out: EmojiSection[] = [];

  const recentCells: EmojiCell[] = [];
  for (const key of input.recent) {
    if (key.startsWith('c:')) {
      const custom = input.customById(key.slice(2));
      if (custom && allows(onlySpaceId, custom.space_id)) recentCells.push(customCell(custom));
    } else if (key.startsWith('u:') && catalog) {
      const entry = catalog.byUnicode.get(key.slice(2));
      if (entry) recentCells.push(unicodeCell(entry, tone));
    }
  }
  if (recentCells.length > 0) {
    out.push({ id: 'recent', title: t('emoji.picker.recent'), icon: 'clock-rotate-left', cells: recentCells });
  }

  for (const s of currentFirst(input.spaces, input.currentSpaceId)) {
    if (s.emojis.length === 0 || !allows(onlySpaceId, s.spaceId)) continue;
    out.push({
      id: `space:${s.spaceId}`,
      title: s.name || t('emoji.picker.space'),
      ...(s.icon ? { spaceIcon: s.icon } : {}),
      acronym: s.acronym,
      cells: s.emojis.map(customCell),
    });
  }

  if (catalog) {
    for (const g of EMOJI_GROUPS) {
      const list = catalog.byGroup.get(g.id) ?? [];
      if (list.length === 0) continue;
      out.push({ id: `group:${g.id}`, title: t(`emoji.groups.${g.key}`), icon: g.icon.replace(/^fa-/, ''), cells: list.map((e) => unicodeCell(e, tone)) });
    }
  }
  return out;
}

/** The spaces with the conversation's own first, the rest in their stored order. */
export function currentFirst(spaces: readonly SpaceEmojiSet[], currentSpaceId: string | null | undefined): readonly SpaceEmojiSet[] {
  if (!currentSpaceId) return spaces;
  const own = spaces.find((s) => s.spaceId === currentSpaceId);
  return own ? [own, ...spaces.filter((s) => s !== own)] : spaces;
}

export function searchEmojiCells(
  query: string,
  input: { catalog: EmojiCatalog | null; spaces: readonly SpaceEmojiSet[]; onlySpaceId?: string; currentSpaceId?: string | null; tone: number },
): EmojiCell[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const custom = currentFirst(input.spaces, input.currentSpaceId)
    .filter((s) => allows(input.onlySpaceId, s.spaceId))
    .flatMap((s) => s.emojis)
    .filter((c) => c.name.toLowerCase().includes(q))
    .slice(0, SEARCH_CUSTOM_MAX)
    .map(customCell);
  const unicode = input.catalog ? searchEmoji(input.catalog, q, SEARCH_UNICODE_MAX).map((e) => unicodeCell(e, input.tone)) : [];
  return [...custom, ...unicode];
}

/** Chunk sections into a header row plus rows of `columns` cells each. */
export function toGridRows(sections: readonly EmojiSection[], columns: number): GridRow[] {
  const cols = Math.max(1, Math.floor(columns));
  const rows: GridRow[] = [];
  for (const s of sections) {
    rows.push({ kind: 'header', key: `h:${s.id}`, sectionId: s.id, title: s.title });
    for (let i = 0; i < s.cells.length; i += cols) {
      rows.push({ kind: 'row', key: `r:${s.id}:${i}`, sectionId: s.id, cells: s.cells.slice(i, i + cols) });
    }
  }
  return rows;
}

/** Index of a section's header row (the rail's scroll target), or -1. */
export function headerIndex(rows: readonly GridRow[], id: CategoryId): number {
  return rows.findIndex((r) => r.kind === 'header' && r.sectionId === id);
}
