/**
 * Font Awesome names, the web's way, for the native icon font.
 *
 * The web writes icons as class strings - `fa-solid fa-gear`, `fa-regular fa-copy`,
 * `fa-brands fa-discord`, and in its shared data just `fa-crown` (badges) or `fa-trash`
 * (context-menu items, which ContextMenu prefixes with fa-solid). Those strings travel through
 * the stores and libs the app reuses, so the mobile Icon takes them as they are. FontAwesome6
 * in @expo/vector-icons ships the same FA6 Free glyphs under the same names minus `fa-`, so
 * "mapping" is parsing: pick the style and the glyph token, ignore utility classes.
 */

export type IconStyle = 'solid' | 'regular' | 'brand';

export interface ParsedIcon {
  /** The FA6 glyph name, e.g. `gear`. */
  name: string;
  style: IconStyle;
  /** `fa-spin` / `fa-spin-pulse` was present. */
  spin: boolean;
}

const STYLE_TOKENS: Record<string, IconStyle> = {
  'fa-solid': 'solid',
  fas: 'solid',
  'fa-regular': 'regular',
  far: 'regular',
  'fa-brands': 'brand',
  fab: 'brand',
};

/** Utility classes that are not glyph names (sizing, animation, layout). */
const MODIFIER = /^fa-(?:spin|spin-pulse|spin-reverse|pulse|beat|beat-fade|bounce|fade|flip|shake|fw|inverse|border|li|ul|stack|stack-1x|stack-2x|lg|xl|2xl|xs|sm|2xs|[0-9]+x|rotate-[0-9]+|rotate-by|flip-horizontal|flip-vertical|flip-both|pull-left|pull-right|pull-start|pull-end|width-auto|sharp|thin|light|duotone)$/;

/**
 * Font Awesome 4/5 names the web might still carry in older data, to their FA6 names. FA6
 * Free kept most names; these are the renames that matter.
 */
const ALIASES: Record<string, string> = {
  times: 'xmark',
  close: 'xmark',
  remove: 'xmark',
  'times-circle': 'circle-xmark',
  cog: 'gear',
  cogs: 'gears',
  home: 'house',
  search: 'magnifying-glass',
  'trash-alt': 'trash-can',
  edit: 'pen-to-square',
  'sign-out-alt': 'right-from-bracket',
  'sign-in-alt': 'right-to-bracket',
  'exclamation-triangle': 'triangle-exclamation',
  'exclamation-circle': 'circle-exclamation',
  'info-circle': 'circle-info',
  'question-circle': 'circle-question',
  'check-circle': 'circle-check',
  'plus-circle': 'circle-plus',
  'ellipsis-h': 'ellipsis',
  'ellipsis-v': 'ellipsis-vertical',
  'external-link-alt': 'arrow-up-right-from-square',
  'volume-up': 'volume-high',
  'volume-down': 'volume-low',
  'volume-mute': 'volume-xmark',
  'shield-alt': 'shield-halved',
  sync: 'arrows-rotate',
  'sync-alt': 'arrows-rotate',
  redo: 'arrow-rotate-right',
  undo: 'arrow-rotate-left',
  'user-friends': 'user-group',
  'comment-alt': 'message',
  smile: 'face-smile',
};

/**
 * Parse a web icon string (or a bare FA6 name) into glyph + style.
 *
 *   parseIcon('fa-solid fa-gear')              -> { name: 'gear', style: 'solid' }
 *   parseIcon('fa-regular fa-copy')            -> { name: 'copy', style: 'regular' }
 *   parseIcon('fa-crown')                      -> { name: 'crown', style: 'solid' }
 *   parseIcon('gear')                          -> { name: 'gear', style: 'solid' }
 *   parseIcon('fa-solid fa-circle-notch fa-spin text-xs') -> spin: true
 *
 * A bare name with no `fa-` prefix is only accepted when it is the whole string, so a stray
 * Tailwind class can never be read as a glyph.
 */
export function parseIcon(spec: string, defaultStyle: IconStyle = 'solid'): ParsedIcon {
  const tokens = spec.trim().split(/\s+/).filter(Boolean);
  let style: IconStyle | null = null;
  let name = '';
  let spin = false;
  for (const tok of tokens) {
    const st = STYLE_TOKENS[tok];
    if (st) {
      style = st;
      continue;
    }
    if (tok === 'fa-spin' || tok === 'fa-spin-pulse' || tok === 'fa-pulse') {
      spin = true;
      continue;
    }
    if (tok.startsWith('fa-')) {
      if (MODIFIER.test(tok) || name) continue;
      name = tok.slice(3);
    }
  }
  if (!name && tokens.length === 1 && !tokens[0]!.startsWith('fa-')) name = tokens[0]!;
  name = ALIASES[name] ?? name;
  return { name, style: style ?? defaultStyle, spin };
}
