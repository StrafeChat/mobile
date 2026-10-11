/**
 * One emoji as the picker and the autocomplete draw it: a Unicode emoji through the user's
 * emoji set (served by the instance's own CDN, like the web's <Emoji>), falling back to the
 * system glyph when the set is 'native' or lacks the image; a custom emoji as its image.
 */
import { memo, useState } from 'react';
import { Text as RNText, View } from 'react-native';
import { Image } from 'expo-image';
import { getEmojiProvider } from '@web/lib/emoji/providers';
import { useEmojiPrefs } from '@/data/settings';

export interface EmojiGlyphProps {
  unicode?: string;
  customUrl?: string;
  size: number;
}

export const EmojiGlyph = memo(function EmojiGlyph({ unicode, customUrl, size }: EmojiGlyphProps) {
  const { provider } = useEmojiPrefs();
  const [failedFor, setFailedFor] = useState<string | null>(null);
  if (customUrl) {
    return <Image source={{ uri: customUrl }} style={{ width: size, height: size }} contentFit="contain" accessible={false} recyclingKey={customUrl} />;
  }
  if (!unicode) return <View style={{ width: size, height: size }} />;
  const p = getEmojiProvider(provider);
  const url = p.imageUrl ? p.imageUrl(unicode) : null;
  if (url && failedFor !== url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size }}
        contentFit="contain"
        accessible={false}
        recyclingKey={url}
        onError={() => setFailedFor(url)}
      />
    );
  }
  return (
    <RNText
      accessible={false}
      allowFontScaling={false}
      style={{ fontSize: Math.round(size * 0.82), width: size, height: size, textAlign: 'center', lineHeight: size, includeFontPadding: false }}
    >
      {unicode}
    </RNText>
  );
});
