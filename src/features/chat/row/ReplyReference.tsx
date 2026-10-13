/**
 * The "replying to" line above a reply (the web's ReplyReference): a small avatar, the author
 * in bold with their BOT tag, and a one-line preview (mentions resolved, markdown stripped,
 * "(no text)" when empty; "…" for an E2EE reply whose original isn't loaded - its embedded copy
 * is ciphertext). Tap jumps to the original, loading a window around it when needed. When
 * neither the loaded list nor the server's embedded copy has it: "Original message was deleted
 * or isn't loaded". A window that cannot be loaded (offline, access lost) says why in a toast.
 */
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { t } from '@web/i18n/t';
import { jumpToMessage } from '@web/stores/messages';
import { useReplyReference } from '@/data';
import { useTheme } from '@/theme';
import { Avatar, BotTag, haptics, Icon, Text, toast, Touchable, withAlpha } from '@/ui';
import { errorText } from '../navigation';

export const ReplyReference = memo(function ReplyReference({ roomId, messageId, compact }: { roomId: string; messageId: string; compact: boolean }) {
  const theme = useTheme();
  const ref = useReplyReference(roomId, messageId);
  if (!ref) return null;
  const glyph = compact ? <Icon name="reply" size={10} tone="muted" style={styles.mirrored} /> : null;
  if (ref.state === 'missing') {
    return (
      <View style={styles.line}>
        {glyph}
        <View style={[styles.ban, { backgroundColor: theme.colors.muted }]}>
          <Icon name="ban" size={9} tone="muted" />
        </View>
        <Text variant="caption" numberOfLines={1} style={[styles.italic, styles.flexShrink]}>
          {t('messages.replyMissing')}
        </Text>
      </View>
    );
  }
  return (
    <Touchable
      feedback="opacity"
      onPress={() => {
        haptics.selection();
        jumpToMessage(roomId, ref.replyToId).catch((e: unknown) => toast.error(errorText(e)));
      }}
      accessibilityRole="button"
      accessibilityLabel={`${ref.authorName}: ${ref.preview || t('messages.noText')}`}
      accessibilityHint={t('messages.replyJump')}
      hitSlop={{ top: 6, bottom: 4 }}
      style={styles.line}
    >
      {glyph}
      <Avatar uri={ref.authorAvatar ?? null} name={ref.authorName} size={16} />
      <Text variant="caption" weight="semibold" color={withAlpha(theme.colors.foreground, 0.9)} numberOfLines={1} style={styles.name}>
        {ref.authorName}
      </Text>
      <BotTag bot={ref.authorBot} size="xs" />
      <Text variant="caption" numberOfLines={1} style={[styles.flexShrink, ref.preview ? null : styles.italic]}>
        {ref.preview || t('messages.noText')}
      </Text>
    </Touchable>
  );
});

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 20, marginBottom: 4, minWidth: 0 },
  name: { flexShrink: 0, maxWidth: '45%' },
  flexShrink: { flexShrink: 1 },
  italic: { fontStyle: 'italic' },
  ban: { width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  mirrored: { transform: [{ scaleX: -1 }] },
});
