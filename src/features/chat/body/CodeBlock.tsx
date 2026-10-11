/**
 * A fenced code block: monospace, coloured by lib/codeHighlight's token runs (the mobile
 * override: highlight.js run synchronously, the same grammars and aliases, never guessing a
 * language) in the theme's code colours, scrolling sideways inside the block. The language
 * label and the Copy button are always visible (there is no hover); a long-press copies too.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text as RNText, View, type TextStyle } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { t } from '@web/i18n/t';
import { highlightCodeLines, type CodeToken } from '@/platform/overrides/lib/codeHighlight';
import { HorizontalGestureOwner } from '@/shell/SwipeShell';
import { useTheme, type CodeColors } from '@/theme';
import { haptics, MONO_FONT, Text, Touchable, withAlpha } from '@/ui';

const COPIED_MS = 1500;

export function tokenColor(code: CodeColors, token: Pick<CodeToken, 'role'>): string {
  switch (token.role) {
    case null:
      return code.fg;
    case 'comment':
      return code.comment;
    case 'muted':
      return code.muted;
    default:
      return code[token.role];
  }
}

function tokenStyle(code: CodeColors, token: CodeToken): TextStyle {
  return {
    color: tokenColor(code, token),
    ...(token.italic || token.role === 'comment' ? { fontStyle: 'italic' as const } : {}),
    ...(token.bold ? { fontWeight: '700' as const } : {}),
    ...(token.underline ? { textDecorationLine: 'underline' as const } : {}),
  };
}

export const CodeBlock = memo(function CodeBlock({ lang, content }: { lang: string; content: string }) {
  const theme = useTheme();
  const highlighted = useMemo(() => (lang ? highlightCodeLines(content, lang) : null), [content, lang]);
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(content);
      haptics.success();
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), COPIED_MS);
    } catch {
      /* clipboard refused - nothing useful to say */
    }
  };

  const fontSize = theme.font(13);
  const lineHeight = Math.round(fontSize * 1.45);
  const body = highlighted ? (
    highlighted.lines.map((line, i) => (
      <RNText key={i}>
        {line.map((tok, j) => (
          <RNText key={j} style={tokenStyle(theme.code, tok)}>
            {tok.text}
          </RNText>
        ))}
        {i < highlighted.lines.length - 1 ? '\n' : ''}
      </RNText>
    ))
  ) : (
    <RNText style={{ color: theme.code.fg }}>{content}</RNText>
  );

  return (
    <View
      style={[
        styles.box,
        { borderColor: theme.colors.border, backgroundColor: withAlpha(theme.colors.muted, 0.5), borderRadius: theme.radii.md },
      ]}
    >
      <View style={styles.bar}>
        <Text variant="caption" style={styles.lang} numberOfLines={1}>
          {highlighted?.language ?? lang}
        </Text>
        <Touchable
          onPress={() => void copy()}
          accessibilityRole="button"
          accessibilityLabel={copied ? t('common.copied') : t('common.copy')}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={[styles.copy, { borderColor: withAlpha(theme.colors.border, 0.7), borderRadius: theme.radii.sm }]}
        >
          <Text variant="caption" weight="medium">
            {copied ? t('common.copied') : t('common.copy')}
          </Text>
        </Touchable>
      </View>
      <HorizontalGestureOwner>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          <RNText
            onLongPress={() => void copy()}
            style={{ fontFamily: MONO_FONT, fontSize, lineHeight, color: theme.code.fg }}
          >
            {body}
          </RNText>
        </ScrollView>
      </HorizontalGestureOwner>
    </View>
  );
});

const styles = StyleSheet.create({
  box: { borderWidth: StyleSheet.hairlineWidth, marginVertical: 6, overflow: 'hidden', alignSelf: 'stretch' },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 6 },
  lang: { textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 10, flexShrink: 1 },
  copy: { borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 8, paddingVertical: 2 },
  scroll: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 10 },
});
