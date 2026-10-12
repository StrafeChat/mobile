/**
 * The expression panel's backspace key: what one press deletes before the caret.
 *
 * The panel replaces the keyboard, so it carries the keyboard's backspace (Discord's panel
 * does). One press removes what a person sees as one character: a whole emoji however many
 * code points it is (ZWJ families, skin tones, flags, keycaps, tag flags) - matched with the
 * web's own emoji pattern - a custom emoji's whole `:name:` token when the name is one the
 * picker inserted, or else one code point with any combining marks after it. A selection is
 * deleted as a whole, as the keyboard's key would.
 */
import { EMOJI_REGEX } from '@web/lib/emoji/regex';

/** The web's emoji sequence, anchored at the end of the text before the caret. */
const EMOJI_AT_END = new RegExp(`(?:${EMOJI_REGEX.source})$`, 'u');
/** A `:name:` token right before the caret (the composer's readable form of a custom emoji). */
const CUSTOM_AT_END = /:([A-Za-z0-9_~-]+):$/;
/** Marks that belong to the character before them (combining diacritics, VS15/16). */
const COMBINING = /[̀-ͯ᪰-᫿᷀-᷿⃐-⃿︀-️︠-︯]$/;

/** Where the unit ending at `end` starts. */
export function deleteStart(text: string, end: number, isCustomName: (name: string) => boolean = () => false): number {
  if (end <= 0) return 0;
  const before = text.slice(0, end);
  const emoji = EMOJI_AT_END.exec(before);
  if (emoji) return end - emoji[0].length;
  const custom = CUSTOM_AT_END.exec(before);
  if (custom && isCustomName(custom[1]!)) return end - custom[0].length;
  let start = end;
  // Combining marks first, then the character they sit on (a surrogate pair is one).
  while (start > 0 && COMBINING.test(text.slice(0, start))) start -= 1;
  if (start === 0) return 0;
  const low = text.charCodeAt(start - 1);
  const high = start >= 2 ? text.charCodeAt(start - 2) : 0;
  return low >= 0xdc00 && low <= 0xdfff && high >= 0xd800 && high <= 0xdbff ? start - 2 : start - 1;
}

/** The text and caret after one backspace with `selection` in `text`. */
export function deleteBackward(
  text: string,
  selection: { start: number; end: number },
  isCustomName?: (name: string) => boolean,
): { text: string; caret: number } {
  const s = Math.max(0, Math.min(selection.start, selection.end, text.length));
  const e = Math.min(Math.max(selection.start, selection.end), text.length);
  if (e > s) return { text: text.slice(0, s) + text.slice(e), caret: s };
  const from = deleteStart(text, s, isCustomName);
  return { text: text.slice(0, from) + text.slice(s), caret: from };
}
