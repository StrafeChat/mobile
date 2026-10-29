/**
 * A translated sentence with someone else's text in it - a game's name in "Playing <name>" -
 * kept apart from the words around it (the web's SentenceWithName, components/ActivityStatus).
 *
 * The sentence is translated as a whole, with a placeholder where the name goes, and cut
 * there, so each language keeps its own word order. The name is set in bold as plain text -
 * never markdown, emoji, mentions or a link - and wrapped in Unicode isolates (FSI ... PDI,
 * what <bdi> does on the web), so a right-to-left name cannot reorder the words around it.
 */
import { Text, type TextProps } from './Text';

/** Stands in for the name while the sentence is translated, then marks where to cut it. */
const NAME_SLOT = '\u0000';
const FSI = '\u2068';
const PDI = '\u2069';

export interface SentenceParts {
  before: string;
  after: string;
}

/** The words before and after the name. A translation without the placeholder keeps its
 * words first and the name after them. */
export function sentenceParts(sentence: (name: string) => string): SentenceParts {
  const s = sentence(NAME_SLOT);
  const at = s.indexOf(NAME_SLOT);
  return at < 0 ? { before: `${s} `, after: '' } : { before: s.slice(0, at), after: s.slice(at + NAME_SLOT.length) };
}

/** `s` as an isolated run of text (the name never reorders what is around it). */
export function bidiIsolate(s: string): string {
  return `${FSI}${s}${PDI}`;
}

export interface SentenceWithNameProps extends Omit<TextProps, 'children'> {
  sentence: (name: string) => string;
  name: string;
}

export function SentenceWithName({ sentence, name, variant = 'caption', numberOfLines = 1, ...rest }: SentenceWithNameProps) {
  const { before, after } = sentenceParts(sentence);
  return (
    <Text variant={variant} numberOfLines={numberOfLines} {...rest}>
      {before}
      <Text variant={variant} weight="semibold" tone="inherit">
        {bidiIsolate(name)}
      </Text>
      {after}
    </Text>
  );
}
