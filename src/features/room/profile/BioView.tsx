/**
 * A profile bio, drawn from the node tree the mobile profileRichText override produces
 * (parseBio: the web's Markdown + limited HTML, with what the web's sanitiser drops already
 * gone - no images, no media, no styles). Links go through the external-link guard.
 */
import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { ScrollView, Text as RNText, View, type TextStyle } from 'react-native';
import { parseBio, type BioBlock, type BioInline } from '@/platform/overrides/lib/profileRichText';
import { useTheme, type Theme } from '@/theme';
import { Icon, MONO_FONT, textStyle, withAlpha } from '@/ui';
import { openLink } from '../links';

function inlines(nodes: BioInline[], theme: Theme, key: string): ReactNode {
  return nodes.map((n, i) => {
    const k = `${key}.${i}`;
    switch (n.type) {
      case 'text':
        return <Fragment key={k}>{n.text}</Fragment>;
      case 'br':
        return <Fragment key={k}>{'\n'}</Fragment>;
      case 'strong':
        return (
          <RNText key={k} style={{ fontWeight: '700' }}>
            {inlines(n.children, theme, k)}
          </RNText>
        );
      case 'em':
        return (
          <RNText key={k} style={{ fontStyle: 'italic' }}>
            {inlines(n.children, theme, k)}
          </RNText>
        );
      case 'del':
        return (
          <RNText key={k} style={{ textDecorationLine: 'line-through' }}>
            {inlines(n.children, theme, k)}
          </RNText>
        );
      case 'u':
        return (
          <RNText key={k} style={{ textDecorationLine: 'underline' }}>
            {inlines(n.children, theme, k)}
          </RNText>
        );
      case 'code':
        return (
          <RNText key={k} style={{ fontFamily: MONO_FONT, backgroundColor: withAlpha(theme.colors.muted, 0.8) }}>
            {inlines(n.children, theme, k)}
          </RNText>
        );
      case 'link':
        return (
          <RNText key={k} accessibilityRole="link" onPress={() => openLink(n.href)} style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}>
            {inlines(n.children, theme, k)}
          </RNText>
        );
    }
  });
}

function blocks(list: BioBlock[], theme: Theme, base: TextStyle, key: string): ReactNode {
  return list.map((b, i) => {
    const k = `${key}.${i}`;
    switch (b.type) {
      case 'paragraph':
        return (
          <RNText key={k} style={base}>
            {inlines(b.children, theme, k)}
          </RNText>
        );
      case 'heading': {
        const size = [20, 18, 16, 15, 15, 15][b.depth - 1] ?? 15;
        return (
          <RNText key={k} accessibilityRole="header" style={[base, { fontWeight: '700', fontSize: theme.font(size), lineHeight: theme.font(size + 6) }]}>
            {inlines(b.children, theme, k)}
          </RNText>
        );
      }
      case 'blockquote':
        return (
          <View key={k} style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ width: 3, borderRadius: 2, backgroundColor: theme.colors.border }} />
            <View style={{ flex: 1, gap: 6 }}>{blocks(b.children, theme, base, k)}</View>
          </View>
        );
      case 'list':
        return (
          <View key={k} style={{ gap: 4 }}>
            {b.items.map((item, j) => (
              <View key={`${k}.${j}`} style={{ flexDirection: 'row', gap: 6 }}>
                {item.checked !== null ? (
                  <Icon name={item.checked ? 'square-check' : 'fa-regular fa-square'} size={14} tone="muted" style={{ marginTop: 3 }} />
                ) : (
                  <RNText style={[base, { minWidth: 16 }]}>{b.ordered ? `${b.start + j}.` : '•'}</RNText>
                )}
                <View style={{ flex: 1, gap: 4 }}>{blocks(item.children, theme, base, `${k}.${j}`)}</View>
              </View>
            ))}
          </View>
        );
      case 'code':
        return (
          <ScrollView
            key={k}
            horizontal
            style={{ borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: withAlpha(theme.colors.muted, 0.5) }}
            contentContainerStyle={{ padding: 10 }}
          >
            <RNText selectable style={{ fontFamily: MONO_FONT, fontSize: theme.font(13), lineHeight: theme.font(18), color: theme.code.fg }}>
              {b.text}
            </RNText>
          </ScrollView>
        );
      case 'hr':
        return <View key={k} style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 4 }} />;
      case 'table':
        return (
          <ScrollView key={k} horizontal>
            <View style={{ borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radii.sm }}>
              {[b.header, ...b.rows].map((row, r) => (
                <View
                  key={`${k}.${r}`}
                  style={{ flexDirection: 'row', borderTopWidth: r === 0 ? 0 : 1, borderTopColor: theme.colors.border }}
                >
                  {row.map((cell, c) => (
                    <RNText
                      key={`${k}.${r}.${c}`}
                      style={[
                        base,
                        {
                          minWidth: 96,
                          padding: 6,
                          textAlign: b.align[c] ?? 'left',
                          fontWeight: r === 0 ? '600' : '400',
                        },
                      ]}
                    >
                      {inlines(cell, theme, `${k}.${r}.${c}`)}
                    </RNText>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
        );
    }
  });
}

export const BioView = memo(function BioView({ source }: { source: string }) {
  const theme = useTheme();
  const doc = useMemo(() => parseBio(source), [source]);
  const base: TextStyle = { ...textStyle(theme, 'body'), color: theme.colors.foreground };
  return <View style={{ gap: 8 }}>{blocks(doc, theme, base, 'b')}</View>;
});
