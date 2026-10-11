/**
 * The bio preview on the profile editor: the bio as others will see it on the full profile -
 * Markdown plus the limited HTML the web allows, parsed by the shared sanitiser
 * (overrides/lib/profileRichText parseBio: no images, media, iframes, forms or styles) and
 * drawn with native text. Links open through the external-link confirmation.
 */
import { Fragment, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { requestOpenExternalLink } from '@web/stores/externalLink';
import { parseBio, type BioBlock, type BioDocument, type BioInline } from '@/platform/overrides/lib/profileRichText';
import { useTheme } from '@/theme';
import { MONO_FONT, Text } from '@/ui';

function inlines(nodes: readonly BioInline[], keyBase: string, linkColor: string): ReactNode[] {
  return nodes.map((n, i) => {
    const key = `${keyBase}.${i}`;
    switch (n.type) {
      case 'text':
        return <Fragment key={key}>{n.text}</Fragment>;
      case 'br':
        return <Fragment key={key}>{'\n'}</Fragment>;
      case 'strong':
        return (
          <Text key={key} variant="body" tone="inherit" weight="bold">
            {inlines(n.children, key, linkColor)}
          </Text>
        );
      case 'em':
        return (
          <Text key={key} variant="body" tone="inherit" style={{ fontStyle: 'italic' }}>
            {inlines(n.children, key, linkColor)}
          </Text>
        );
      case 'del':
        return (
          <Text key={key} variant="body" tone="inherit" style={{ textDecorationLine: 'line-through' }}>
            {inlines(n.children, key, linkColor)}
          </Text>
        );
      case 'u':
        return (
          <Text key={key} variant="body" tone="inherit" style={{ textDecorationLine: 'underline' }}>
            {inlines(n.children, key, linkColor)}
          </Text>
        );
      case 'code':
        return (
          <Text key={key} variant="mono" tone="inherit">
            {inlines(n.children, key, linkColor)}
          </Text>
        );
      case 'link':
        return (
          <Text
            key={key}
            variant="body"
            color={linkColor}
            style={{ textDecorationLine: 'underline' }}
            accessibilityRole="link"
            onPress={() => {
              if (/^https?:/i.test(n.href)) requestOpenExternalLink(n.href);
            }}
          >
            {inlines(n.children, key, linkColor)}
          </Text>
        );
    }
  });
}

function Block({ block, k }: { block: BioBlock; k: string }) {
  const theme = useTheme();
  const link = theme.colors.link;
  switch (block.type) {
    case 'paragraph':
      return <Text variant="body">{inlines(block.children, k, link)}</Text>;
    case 'heading':
      return (
        <Text variant={block.depth <= 2 ? 'heading' : 'label'} weight="bold" accessibilityRole="header">
          {inlines(block.children, k, link)}
        </Text>
      );
    case 'blockquote':
      return (
        <View style={{ borderStartWidth: 3, borderStartColor: theme.colors.border, paddingStart: 10, gap: 6 }}>
          {block.children.map((b, i) => (
            <Block key={`${k}.${i}`} block={b} k={`${k}.${i}`} />
          ))}
        </View>
      );
    case 'list':
      return (
        <View style={{ gap: 4 }}>
          {block.items.map((item, i) => (
            <View key={`${k}.${i}`} style={{ flexDirection: 'row', gap: 8 }}>
              <Text variant="body" tone="muted">
                {item.checked === true ? '☑' : item.checked === false ? '☐' : block.ordered ? `${block.start + i}.` : '•'}
              </Text>
              <View style={{ flex: 1, gap: 4 }}>
                {item.children.map((b, j) => (
                  <Block key={`${k}.${i}.${j}`} block={b} k={`${k}.${i}.${j}`} />
                ))}
              </View>
            </View>
          ))}
        </View>
      );
    case 'code':
      return (
          <ScrollView
            horizontal
            style={{ borderRadius: theme.radii.md, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.muted }}
            contentContainerStyle={{ padding: 10 }}
          >
            <Text variant="mono" style={{ fontFamily: MONO_FONT }}>
              {block.text}
            </Text>
          </ScrollView>
      );
    case 'hr':
      return <View style={{ height: 1, backgroundColor: theme.colors.border, marginVertical: 4 }} />;
    case 'table':
      return (
        <View style={{ gap: 2 }}>
          <Text variant="body" weight="semibold">
            {block.header.map((cell, i) => (
              <Fragment key={`${k}.h${i}`}>
                {i > 0 ? ' | ' : ''}
                {inlines(cell, `${k}.h${i}`, link)}
              </Fragment>
            ))}
          </Text>
          {block.rows.map((row, r) => (
            <Text key={`${k}.r${r}`} variant="body">
              {row.map((cell, i) => (
                <Fragment key={`${k}.r${r}.${i}`}>
                  {i > 0 ? ' | ' : ''}
                  {inlines(cell, `${k}.r${r}.${i}`, link)}
                </Fragment>
              ))}
            </Text>
          ))}
        </View>
      );
  }
}

export function BioView({ doc }: { doc: BioDocument }) {
  return (
    <View style={{ gap: 8 }}>
      {doc.map((b, i) => (
        <Block key={i} block={b} k={String(i)} />
      ))}
    </View>
  );
}

/** Parses on every render; bios are short (190 characters on the server). */
export function BioPreview({ source }: { source: string }) {
  const doc = parseBio(source);
  if (doc.length === 0) return null;
  return <BioView doc={doc} />;
}
