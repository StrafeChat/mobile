/**
 * The inline pieces of a message body, each a <Text> (or an inline image) that nests inside
 * the run's <Text>: emoji, custom emoji, spoilers, mention / role / room pills, @everyone,
 * dynamic timestamps and links. The web's MessageBody node rules, one component per node.
 *
 * Nested <Text> cannot take padding or a radius (Android ignores it), so pills are a tinted
 * background with a hair space either side - the shape Discord's own app uses.
 */
import { createContext, memo, useContext, useMemo, useState, type ReactNode } from 'react';
import { PixelRatio, Text as RNText, type TextStyle } from 'react-native';
import { Image } from 'expo-image';
import { t } from '@web/i18n/t';
import { appearance } from '@web/stores/appearance';
import { accessibility } from '@web/stores/accessibility';
import { getEmojiProvider } from '@web/lib/emoji/providers';
import { spaces } from '@web/stores/spaces';
import { spaceRoleColorHex } from '@web/lib/spacePermissions';
import {
  formatRelativeTimestamp,
  formatTimestamp,
  formatTimestampTooltip,
  type TimestampStyle,
} from '@web/lib/utils/messageTimestamp';
import { useSolid } from '@/bridge/solid';
import { useCustomEmoji, useSpaceRoles, useUserDisplay } from '@/data';
import { useTheme, type Theme } from '@/theme';
import { haptics, toast, withAlpha } from '@/ui';
import { navigateToRoom, openMessageLink, showLinkActions } from '../navigation';
import { openUserProfile } from '../people';
import { useLiveNow } from './clock';

// ---- context ---------------------------------------------------------------------------------------

export interface BodyContextValue {
  roomId: string;
  spaceId: string | null;
  /** Emoji-only message: emoji render large. */
  jumbo: boolean;
}

export const BodyContext = createContext<BodyContextValue>({ roomId: '', spaceId: null, jumbo: false });

export function useBodyContext(): BodyContextValue {
  return useContext(BodyContext);
}

// ---- sizing ---------------------------------------------------------------------------------------

/** Base body text size (the web's text-sm at phone scale, like Text variant 'body'). */
export const BODY_FONT = 15;
export const BODY_LINE = 21;
const EMOJI_EM = 1.375;
const JUMBO_PX = 48;

/** Inline images do not follow the system text size on their own; scale them with it. */
export function emojiPixels(theme: Theme, jumbo: boolean): number {
  const os = Math.min(PixelRatio.getFontScale(), 2);
  return Math.round((jumbo ? JUMBO_PX : BODY_FONT * EMOJI_EM) * theme.fontScale * os);
}

/** A hair space: room around a pill's label without padding (nested Text has none). */
const HAIR = ' ';

// ---- emoji -----------------------------------------------------------------------------------------

/** The image URL of a Unicode emoji in the reader's chosen set (null = the system font). */
export function useEmojiUrl(emoji: string): string | null {
  const provider = useSolid(() => appearance.emojiProvider);
  return useMemo(() => {
    const p = getEmojiProvider(provider);
    return p.imageUrl ? p.imageUrl(emoji) : null;
  }, [provider, emoji]);
}

/**
 * One Unicode emoji: the chosen set's image (SVG on the instance CDN; expo-image draws SVG),
 * or the system glyph when the set is "native" or the image is missing.
 */
export const EmojiGlyph = memo(function EmojiGlyph({ emoji, size, label }: { emoji: string; size: number; label?: string }) {
  const url = useEmojiUrl(emoji);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!url || failedUrl === url) {
    return (
      <RNText style={{ fontSize: Math.round(size * 0.82), lineHeight: Math.round(size * 1.05) }} accessibilityLabel={label ?? emoji}>
        {emoji}
      </RNText>
    );
  }
  return (
    <Image
      source={{ uri: url }}
      style={{ width: size, height: size }}
      contentFit="contain"
      recyclingKey={url}
      cachePolicy="memory-disk"
      accessible
      accessibilityLabel={label ?? emoji}
      onError={() => setFailedUrl(url)}
    />
  );
});

export function InlineEmoji({ emoji }: { emoji: string }) {
  const theme = useTheme();
  const { jumbo } = useBodyContext();
  return <EmojiGlyph emoji={emoji} size={emojiPixels(theme, jumbo)} />;
}

/** A space emoji `<:name:id>`; `:name:` in muted text when unknown or deleted. */
export function InlineCustomEmoji({ id, name }: { id: string; name: string }) {
  const theme = useTheme();
  const { jumbo } = useBodyContext();
  const emoji = useCustomEmoji(id);
  if (!emoji) {
    return (
      <RNText
        style={{ color: theme.colors.mutedForeground }}
        onPress={() => toast(t('mobile.chat.emojiUnavailable'))}
        accessibilityHint={t('mobile.chat.emojiUnavailable')}
      >
        :{name}:
      </RNText>
    );
  }
  return <CustomEmojiImage url={emoji.url} name={emoji.name} animated={emoji.animated} size={emojiPixels(theme, jumbo)} />;
}

export function CustomEmojiImage({ url, name, animated, size }: { url: string; name: string; animated?: boolean; size: number }) {
  return (
    <Image
      source={{ uri: url }}
      style={{ width: size, height: size }}
      contentFit="contain"
      recyclingKey={url}
      autoplay={animated !== false}
      cachePolicy="memory-disk"
      accessible
      accessibilityLabel={`:${name}:`}
    />
  );
}

// ---- spoiler ----------------------------------------------------------------------------------------

/**
 * ||spoiler||: a solid bar until tapped, then it stays open. While hidden it is drawn as its
 * plain text in the bar's own colour, so nothing inside it (a coloured pill, an emoji image)
 * shows through.
 */
export function Spoiler({ plain, children }: { plain: string; children: ReactNode }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  if (open) return <RNText style={{ backgroundColor: withAlpha(theme.colors.muted, 0.6) }}>{children}</RNText>;
  const bar = withAlpha(theme.colors.foreground, 0.85);
  return (
    <RNText
      style={{ backgroundColor: bar, color: bar }}
      onPress={() => {
        haptics.selection();
        setOpen(true);
      }}
      accessibilityRole="button"
      accessibilityLabel={t('messages.spoilerReveal')}
      suppressHighlighting
    >
      {plain}
    </RNText>
  );
}

// ---- pills -----------------------------------------------------------------------------------------

function pillStyle(theme: Theme): TextStyle {
  return {
    backgroundColor: withAlpha(theme.colors.primary, 0.2),
    color: theme.colors.primary,
    fontWeight: '500',
  };
}

/** `<@id>`: the person's current name (it updates as members load); tap for their profile. */
export function MentionPill({ userId }: { userId: string }) {
  const theme = useTheme();
  const ctx = useBodyContext();
  const display = useUserDisplay(userId, { roomId: ctx.roomId, spaceId: ctx.spaceId });
  const name = display?.name ?? t('common.unknown');
  return (
    <RNText
      style={pillStyle(theme)}
      onPress={() => openUserProfile(userId, { roomId: ctx.roomId, spaceId: ctx.spaceId })}
      accessibilityRole="button"
      accessibilityLabel={`@${name}`}
    >
      {HAIR}@{name}
      {HAIR}
    </RNText>
  );
}

/** `<@&id>`: tinted with the role's colour; the literal token when the role is unknown. */
export function RoleMentionPill({ roleId }: { roleId: string }) {
  const ctx = useBodyContext();
  const roles = useSpaceRoles(ctx.spaceId);
  const role = roles?.find((r) => r.id === roleId);
  if (!role) return <RNText>{`<@&${roleId}>`}</RNText>;
  const hex = spaceRoleColorHex(role.color);
  return (
    <RNText style={{ backgroundColor: `${hex}26`, color: hex, fontWeight: '500' }} accessibilityLabel={`@${role.name}`}>
      {HAIR}@{role.name}
      {HAIR}
    </RNText>
  );
}

/** `<#id>`: the room by name, opening it; a grey '#unknown' when it isn't one of yours. */
export function ChannelPill({ roomId }: { roomId: string }) {
  const theme = useTheme();
  const channel = useSolid(() => {
    for (const [spaceId, list] of Object.entries(spaces.spaceRoomsBySpaceId)) {
      const r = list?.find((x) => x.id === roomId);
      if (r) return { spaceId, name: r.name || 'unnamed' };
    }
    return null;
  }, [roomId]);
  if (!channel) {
    return (
      <RNText
        style={{ backgroundColor: theme.colors.muted, color: theme.colors.mutedForeground }}
        onPress={() => toast(t('messages.roomUnavailable'))}
        accessibilityHint={t('messages.roomUnavailable')}
      >
        {HAIR}#unknown{HAIR}
      </RNText>
    );
  }
  return (
    <RNText
      style={pillStyle(theme)}
      onPress={() => navigateToRoom(roomId, channel.spaceId)}
      accessibilityRole="button"
      accessibilityLabel={t('messages.goToRoom', { name: channel.name })}
    >
      {HAIR}#{channel.name}
      {HAIR}
    </RNText>
  );
}

export function EveryonePill({ text }: { text: string }) {
  const theme = useTheme();
  return (
    <RNText style={pillStyle(theme)}>
      {HAIR}
      {text}
      {HAIR}
    </RNText>
  );
}

/**
 * `<t:unix[:style]>` in the reader's own timezone and language. Relative ones tick from the
 * shared clock. Tapping shows the full weekday date (the web's hover tooltip).
 */
export function TimestampPill({ unix, style }: { unix: number; style: TimestampStyle }) {
  const theme = useTheme();
  const now = useLiveNow(style === 'R');
  const date = useMemo(() => new Date(unix * 1000), [unix]);
  const label = style === 'R' ? formatRelativeTimestamp(date, new Date(now)) : formatTimestamp(date, style);
  const full = () => toast(formatTimestampTooltip(date));
  return (
    <RNText
      style={{ backgroundColor: theme.colors.muted, color: theme.colors.mutedForeground }}
      onPress={full}
      onLongPress={full}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={formatTimestampTooltip(date)}
    >
      {HAIR}
      {label}
      {HAIR}
    </RNText>
  );
}

/**
 * Settings → Accessibility → Underline links (the web's `html.underline-links a`): every link
 * gets an underline, including the ones that otherwise show only colour (preview titles).
 */
export function useUnderlineLinks(): boolean {
  return useSolid(() => accessibility.underlineLinks);
}

/** The underline a link-styled text takes when the reader asked for it. */
export function linkUnderline(on: boolean): TextStyle | null {
  return on ? { textDecorationLine: 'underline' } : null;
}

/**
 * A link in text: opens through the external-link guard; long-press for open / copy / share.
 * Always underlined, as the web's message links are (and so whatever the accessibility
 * setting says).
 */
export function LinkText({ href, children }: { href: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <RNText
      style={{ color: theme.colors.primary, textDecorationLine: 'underline' }}
      onPress={() => openMessageLink(href)}
      onLongPress={() => {
        haptics.longPress();
        showLinkActions(href);
      }}
      accessibilityRole="link"
      accessibilityHint={href}
    >
      {children}
    </RNText>
  );
}

/** The `(edited)` marker at the end of the last line; tap shows when. */
export function EditedMarker({ label }: { label: string }) {
  const theme = useTheme();
  return (
    <RNText
      style={{ fontSize: theme.font(11), color: withAlpha(theme.colors.mutedForeground, 0.8) }}
      onPress={() => toast(label)}
      accessibilityLabel={label}
    >
      {' '}
      {t('messages.edited')}
    </RNText>
  );
}
