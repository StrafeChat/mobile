/**
 * A message's text, rendered natively from the web's parse tree (lib/utils/markdown's
 * MessageSegment[], see bodyModel.ts for how it is cut into runs and blocks).
 *
 * Node rules are the web MessageBody's: bold / italic / underline / strike nest; spoilers hide
 * until tapped; inline code is a mono chip; fenced code is a CodeBlock; headings 1-3, subtext,
 * quotes (a bar, muted, their own blocks inside) and list items (indented by depth, the author's
 * marker kept); mentions, roles, rooms and @everyone are pills; `<t:…>` timestamps render in
 * the reader's own zone; Unicode and custom emoji are images, large when the message is only
 * emoji; links open through the external-link guard and carry their invite card or inline
 * media; a lone GIF is only the animation; preview cards follow when the room allows them.
 * `trailing` (the "(edited)" marker) sits at the end of the last line.
 */
import { Fragment, memo, useMemo, type ReactNode } from 'react';
import { StyleSheet, Text as RNText, View, type TextStyle } from 'react-native';
import type { MessageSegment } from '@web/lib/utils/markdown';
import { previewUrlsFor } from '@web/lib/linkPreviewUrls';
import { useTheme, type Theme } from '@/theme';
import { MONO_FONT, withAlpha } from '@/ui';
import { CodeBlock } from './CodeBlock';
import { InviteEmbed } from './InviteEmbed';
import { LinkPreview } from './LinkPreview';
import { MediaEmbed } from './MediaEmbed';
import { groupBlocks, isJumbo, loneGif, parseBody, segmentsPlainText, type BodyBlock, type LinkEmbed } from './bodyModel';
import {
  BODY_FONT,
  BODY_LINE,
  BodyContext,
  ChannelPill,
  EveryonePill,
  InlineCustomEmoji,
  InlineEmoji,
  LinkText,
  MentionPill,
  RoleMentionPill,
  Spoiler,
  TimestampPill,
  emojiPixels,
  type BodyContextValue,
} from './inline';

export interface MessageBodyProps {
  text: string;
  roomId: string;
  spaceId?: string | null;
  /** Preview cards for the message's links (the caller applies the E2EE opt-in rule). */
  allowLinkPreviews: boolean;
  /** Inline at the end of the last line ("(edited)"). */
  trailing?: ReactNode;
  /** Inline before the first line (compact mode's "Name time ·" header). */
  leading?: ReactNode;
  /** Base text colour (pending rows are muted). */
  color?: string;
  /** Decrypt-state placeholders render italic and muted. */
  italic?: boolean;
  /** Don't render embeds or cards (reply previews, compact surfaces). */
  inlineOnly?: boolean;
  numberOfLines?: number;
}

function baseStyle(theme: Theme, color: string | undefined, italic: boolean | undefined): TextStyle {
  return {
    fontSize: theme.font(BODY_FONT),
    lineHeight: Math.round(theme.font(BODY_LINE)),
    color: color ?? theme.colors.foreground,
    ...(italic ? { fontStyle: 'italic' as const } : {}),
  };
}

// ---- inline ----------------------------------------------------------------------------------------

function renderInline(nodes: readonly MessageSegment[], theme: Theme, keyPrefix: string): ReactNode[] {
  return nodes.map((seg, i) => renderInlineNode(seg, theme, `${keyPrefix}.${i}`));
}

function renderInlineNode(seg: MessageSegment, theme: Theme, key: string): ReactNode {
  switch (seg.type) {
    case 'text':
      return seg.content;
    case 'bold':
      return (
        <RNText key={key} style={styles.bold}>
          {renderInline(seg.children, theme, key)}
        </RNText>
      );
    case 'italic':
      return (
        <RNText key={key} style={styles.italic}>
          {renderInline(seg.children, theme, key)}
        </RNText>
      );
    case 'underline':
      return (
        <RNText key={key} style={styles.underline}>
          {renderInline(seg.children, theme, key)}
        </RNText>
      );
    case 'strike':
      return (
        <RNText key={key} style={[styles.strike, { textDecorationColor: theme.colors.foreground }]}>
          {renderInline(seg.children, theme, key)}
        </RNText>
      );
    case 'spoiler':
      return (
        <Spoiler key={key} plain={segmentsPlainText(seg.children)}>
          {renderInline(seg.children, theme, key)}
        </Spoiler>
      );
    case 'code':
      return (
        <RNText
          key={key}
          style={{ fontFamily: MONO_FONT, fontSize: theme.font(13.5), backgroundColor: theme.colors.muted }}
        >
          {' '}
          {seg.content}
          {' '}
        </RNText>
      );
    case 'link':
      return (
        <LinkText key={key} href={seg.href}>
          {seg.text}
        </LinkText>
      );
    case 'mention':
      return <MentionPill key={key} userId={seg.userId} />;
    case 'roleMention':
      return <RoleMentionPill key={key} roleId={seg.roleId} />;
    case 'channelMention':
      return <ChannelPill key={key} roomId={seg.roomId} />;
    case 'everyone':
      return <EveryonePill key={key} text={seg.text} />;
    case 'timestamp':
      return <TimestampPill key={key} unix={seg.unix} style={seg.style} />;
    case 'emoji':
      return <InlineEmoji key={key} emoji={seg.emoji} />;
    case 'customEmoji':
      return <InlineCustomEmoji key={key} id={seg.id} name={seg.name} />;
    // Blocks never reach here from groupBlocks; render their content inline if they do.
    case 'codeBlock':
      return seg.content;
    default:
      return 'children' in seg ? <Fragment key={key}>{renderInline(seg.children, theme, key)}</Fragment> : null;
  }
}

// ---- blocks ----------------------------------------------------------------------------------------

interface BlockOptions {
  base: TextStyle;
  muted: string;
  allowLinkPreviews: boolean;
  inlineOnly: boolean;
  jumbo: boolean;
}

function Embed({ href, embed, allowLinkPreviews }: { href: string; embed: LinkEmbed; allowLinkPreviews: boolean }) {
  return embed.kind === 'invite' ? (
    <InviteEmbed code={embed.code} />
  ) : (
    <MediaEmbed href={href} kind={embed.media} allowLinkPreviews={allowLinkPreviews} />
  );
}

function renderBlocks(
  blocks: BodyBlock[],
  theme: Theme,
  opts: BlockOptions,
  keyPrefix: string,
  trailing?: ReactNode,
  leading?: ReactNode,
): ReactNode[] {
  const out: ReactNode[] = [];
  const leadingOnRun = leading != null && blocks[0]?.kind === 'run';
  if (leading != null && !leadingOnRun) out.push(<RNText key={`${keyPrefix}.leading`} style={opts.base}>{leading}</RNText>);
  const lastRun = (() => {
    for (let i = blocks.length - 1; i >= 0; i--) if (blocks[i]!.kind === 'run') return i;
    return -1;
  })();
  const trailingOnRun = trailing != null && lastRun === blocks.length - 1;
  blocks.forEach((b, i) => {
    const key = `${keyPrefix}.${i}`;
    if (b.kind === 'run') {
      const lineHeight = opts.jumbo ? emojiPixels(theme, true) + 6 : opts.base.lineHeight;
      out.push(
        <RNText key={key} style={[opts.base, { lineHeight }]}>
          {leadingOnRun && i === 0 ? leading : null}
          {renderInline(b.nodes, theme, key)}
          {trailingOnRun && i === lastRun ? trailing : null}
        </RNText>,
      );
      if (!opts.inlineOnly) {
        for (const [j, e] of b.embeds.entries()) {
          out.push(<Embed key={`${key}.e${j}`} href={e.href} embed={e.embed} allowLinkPreviews={opts.allowLinkPreviews} />);
        }
      }
      return;
    }
    if (b.kind === 'embedLink') {
      out.push(
        <View key={key} style={styles.embedLink}>
          <RNText style={opts.base}>{renderInlineNode(b.node, theme, `${key}.l`)}</RNText>
          {opts.inlineOnly ? null : <Embed href={b.node.href} embed={b.embed} allowLinkPreviews={opts.allowLinkPreviews} />}
        </View>,
      );
      return;
    }
    const node = b.node;
    switch (node.type) {
      case 'heading': {
        const size = node.level === 1 ? 20 : node.level === 2 ? 18 : 16;
        out.push(
          <RNText
            key={key}
            accessibilityRole="header"
            style={[
              opts.base,
              { fontSize: theme.font(size), lineHeight: Math.round(theme.font(size) * 1.3), fontWeight: '700' },
              i === 0 ? null : styles.headingGap,
              styles.headingBottom,
            ]}
          >
            {renderInline(node.children, theme, key)}
          </RNText>,
        );
        return;
      }
      case 'subtext':
        out.push(
          <RNText key={key} style={[opts.base, { fontSize: theme.font(12), lineHeight: Math.round(theme.font(16)), color: opts.muted }]}>
            {renderInline(node.children, theme, key)}
          </RNText>,
        );
        return;
      case 'quote':
        out.push(
          <View key={key} style={styles.quote}>
            <View style={[styles.quoteBar, { backgroundColor: theme.colors.border }]} />
            <View style={styles.quoteBody}>
              {renderBlocks(groupBlocks(node.children), theme, { ...opts, base: { ...opts.base, color: opts.muted } }, key)}
            </View>
          </View>,
        );
        return;
      case 'listItem':
        out.push(
          <View key={key} style={[styles.listItem, { marginStart: node.depth * 20 }]}>
            <RNText style={[opts.base, { color: opts.muted }]} accessible={false}>
              {node.marker}
            </RNText>
            <RNText style={[opts.base, styles.flex]}>{renderInline(node.children, theme, key)}</RNText>
          </View>,
        );
        return;
      case 'codeBlock':
        out.push(<CodeBlock key={key} lang={node.lang} content={node.content} />);
        return;
      default:
        return;
    }
  });
  if (trailing != null && !trailingOnRun) out.push(<RNText key={`${keyPrefix}.trailing`} style={opts.base}>{trailing}</RNText>);
  return out;
}

// ---- the body --------------------------------------------------------------------------------------

export const MessageBody = memo(function MessageBody({
  text,
  roomId,
  spaceId,
  allowLinkPreviews,
  trailing,
  leading,
  color,
  italic,
  inlineOnly = false,
  numberOfLines,
}: MessageBodyProps) {
  const theme = useTheme();
  const segments = useMemo(() => parseBody(text), [text]);
  const jumbo = useMemo(() => isJumbo(segments), [segments]);
  const gif = useMemo(() => (inlineOnly ? null : loneGif(segments)), [segments, inlineOnly]);
  const blocks = useMemo(() => groupBlocks(segments), [segments]);
  const previews = useMemo(() => (allowLinkPreviews && !inlineOnly ? previewUrlsFor(text) : []), [allowLinkPreviews, inlineOnly, text]);
  const ctx = useMemo<BodyContextValue>(() => ({ roomId, spaceId: spaceId ?? null, jumbo }), [roomId, spaceId, jumbo]);
  const base = baseStyle(theme, color, italic);
  const muted = theme.colors.mutedForeground;

  if (numberOfLines != null) {
    // A clamped one-paragraph rendering (previews): everything inline in one <Text>.
    return (
      <BodyContext.Provider value={ctx}>
        <RNText style={base} numberOfLines={numberOfLines}>
          {leading}
          {renderInline(segments, theme, 'c')}
          {trailing}
        </RNText>
      </BodyContext.Provider>
    );
  }

  return (
    <BodyContext.Provider value={ctx}>
      {gif ? (
        <View>
          {leading != null ? <RNText style={base}>{leading}</RNText> : null}
          <MediaEmbed href={gif} kind="gif" allowLinkPreviews={allowLinkPreviews} showLinkOnFail />
          {trailing != null ? <RNText style={base}>{trailing}</RNText> : null}
        </View>
      ) : (
        <View>{renderBlocks(blocks, theme, { base, muted, allowLinkPreviews, inlineOnly, jumbo }, 'b', trailing, leading)}</View>
      )}
      {previews.map((u) => (
        <LinkPreview key={u} url={u} />
      ))}
    </BodyContext.Provider>
  );
});

/** Muted / pending / placeholder colours for a body, from the theme. */
export function bodyColor(theme: Theme, opts: { pending?: boolean; placeholder?: boolean }): string {
  if (opts.placeholder) return theme.colors.mutedForeground;
  if (opts.pending) return withAlpha(theme.colors.mutedForeground, 0.7);
  return withAlpha(theme.colors.foreground, 0.92);
}

const styles = StyleSheet.create({
  bold: { fontWeight: '600' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  strike: { textDecorationLine: 'line-through' },
  headingGap: { marginTop: 8 },
  headingBottom: { marginBottom: 4 },
  quote: { flexDirection: 'row', gap: 10, marginVertical: 2 },
  quoteBar: { width: 4, borderRadius: 2 },
  quoteBody: { flex: 1, minWidth: 0 },
  listItem: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
  embedLink: { marginVertical: 4 },
});

