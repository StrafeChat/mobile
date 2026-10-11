/**
 * The @mention / #room / :emoji: suggestions, just above the input (above the keyboard).
 * Tap a row to insert it; taps never dismiss the keyboard. Rows are the web's: a person
 * (avatar, name, BOT tag, @username or "You"), a role (its colour dot), a room (#), @everyone /
 * @here (with what they do), an emoji (its glyph and :shortcode:).
 */
import { memo } from 'react';
import { ScrollView, View } from 'react-native';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { Avatar, BotTag, Icon, Text, Touchable, withAlpha } from '@/ui';
import type { Candidate } from '../logic/completion';
import { EmojiGlyph } from './EmojiGlyph';

export interface AutocompleteListProps {
  list: readonly Candidate[];
  onPick: (c: Candidate) => void;
}

const ROW = 44;
const VISIBLE_ROWS = 5;

export function AutocompleteList({ list, onPick }: AutocompleteListProps) {
  const theme = useTheme();
  return (
    <View
      accessibilityLabel={t('composer.completionAria')}
      accessibilityLiveRegion="polite"
      style={{
        marginHorizontal: 8,
        marginBottom: 6,
        borderRadius: theme.radii.lg,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.popover,
        overflow: 'hidden',
        maxHeight: ROW * VISIBLE_ROWS + 8,
      }}
      testID="composer-autocomplete"
    >
      <ScrollView keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingVertical: 4 }}>
        {list.map((c) => (
          <CandidateRow key={c.key} candidate={c} onPick={onPick} />
        ))}
      </ScrollView>
    </View>
  );
}

const CandidateRow = memo(function CandidateRow({ candidate: c, onPick }: { candidate: Candidate; onPick: (c: Candidate) => void }) {
  const theme = useTheme();
  let leading;
  switch (c.kind) {
    case 'user':
      leading = <Avatar uri={c.avatar ?? null} name={c.label} size={26} />;
      break;
    case 'role':
      leading = (
        <View style={{ width: 26, alignItems: 'center' }}>
          <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: c.colorHex || theme.colors.mutedForeground }} />
        </View>
      );
      break;
    case 'channel':
      leading = (
        <View style={{ width: 26, alignItems: 'center' }}>
          <Icon name="hashtag" size={14} tone="muted" />
        </View>
      );
      break;
    case 'special':
      leading = (
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 13,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: withAlpha(theme.colors.primary, 0.2),
          }}
        >
          <Icon name="at" size={12} color={theme.colors.primary} />
        </View>
      );
      break;
    case 'emoji':
      leading = <EmojiGlyph unicode={c.unicode} customUrl={c.customUrl} size={24} />;
      break;
  }
  return (
    <Touchable
      onPress={() => onPick(c)}
      accessibilityLabel={`${c.label}, ${c.sublabel}`}
      testID={`completion-${c.key}`}
      style={{ minHeight: ROW, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12 }}
    >
      {leading}
      <Text variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
        {c.label}
      </Text>
      {c.kind === 'user' && c.bot ? <BotTag bot size="xs" /> : null}
      <Text variant="caption" numberOfLines={1} style={{ flexShrink: 2 }}>
        {c.sublabel}
      </Text>
    </Touchable>
  );
});
