/**
 * Edit mode's text, both ways.
 *
 * A message is stored in wire syntax - `<@id>`, `<@&id>`, `<#id>`, `<:name:id>` - which the
 * web's inline editor shows as-is (an inventory quirk: you edit "<@1234…>"). Here the edit
 * buffer is seeded with the readable form the composer types (`@username`, `@Role`, `#room`,
 * `:name:`), and saving runs it back through the same serializeDraft a new message uses.
 *
 * Every conversion is checked to survive that round trip: a token whose readable form would
 * serialize to something else (an unknown id, a name another entry shadows, a mention glued
 * to the next word) stays in wire syntax, so saving an untouched message never changes it.
 */
import { serializeDraft, tokenizeDraft, type DraftToken, type MentionCatalog } from '@web/lib/utils/mentions';

function readableFor(tok: DraftToken, catalog: MentionCatalog): string | null {
  if (tok.source !== 'literal' || !tok.id) return null;
  switch (tok.kind) {
    case 'user': {
      const u = catalog.users.find((x) => x.id === tok.id);
      return u ? `@${u.username}` : null;
    }
    case 'role': {
      const r = catalog.roles.find((x) => x.id === tok.id);
      return r ? `@${r.name}` : null;
    }
    case 'channel': {
      const c = catalog.channels.find((x) => x.id === tok.id);
      return c ? `#${c.name}` : null;
    }
    case 'emoji': {
      const e = catalog.emojis.find((x) => x.id === tok.id);
      return e ? `:${e.name}:` : null;
    }
    default:
      return null;
  }
}

/** The readable text to edit for a message stored as `wire`. */
export function wireToReadable(wire: string, catalog: MentionCatalog): string {
  const tokens = tokenizeDraft(wire, catalog);
  const parts = tokens.map((tok) => tok.text);
  const target = serializeDraft(wire, catalog);
  for (let i = 0; i < tokens.length; i++) {
    const readable = readableFor(tokens[i]!, catalog);
    if (readable === null) continue;
    const prev = parts[i]!;
    parts[i] = readable;
    // Keep the conversion only if the whole text still serializes to the same wire text.
    if (serializeDraft(parts.join(''), catalog) !== target) parts[i] = prev;
  }
  return parts.join('');
}

/** The wire text to save for an edited buffer (the same serialization a new message gets). */
export function readableToWire(text: string, catalog: MentionCatalog): string {
  return serializeDraft(text, catalog);
}
