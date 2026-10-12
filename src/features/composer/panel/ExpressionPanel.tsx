/**
 * The composer's emoji / GIF panel, drawn in the keyboard's place under the input row (where
 * it sits and how it moves is useExpressionPanel's job). Discord's layout: a grab handle (drag
 * up to expand towards the header, down to close; tap to toggle), Emoji | GIFs tabs, then the
 * tab: the emoji picker with its category bar and backspace key along the bottom, or the GIF
 * feed. An emoji goes in at the caret and the panel stays for more; a GIF is sent and closes
 * it (the composer decides both).
 *
 * The GIF tab mounts (and fetches) only once chosen. Editing a message has no GIF tab - a GIF
 * is a new message.
 */
import { View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import type { GifResult } from '@web/lib/gif/providers';
import { t } from '@web/i18n/t';
import { useTheme } from '@/theme';
import { SegmentedControl, Touchable, withAlpha } from '@/ui';
import { EmojiPicker, type EmojiPick } from '../components/EmojiPicker';
import { GifPicker } from '../components/GifPicker';
import type { ExpressionPanel as PanelController, ExpressionTab } from './useExpressionPanel';

export interface ExpressionPanelProps {
  panel: PanelController;
  onPickEmoji: (pick: EmojiPick) => void;
  onPickGif: (gif: GifResult) => void;
  onBackspace: () => void;
  /** False hides the GIF tab (editing a message). */
  gifAllowed: boolean;
  customEmojiSpaceId?: string;
  currentSpaceId?: string | null;
}

export function ExpressionPanel({
  panel,
  onPickEmoji,
  onPickGif,
  onBackspace,
  gifAllowed,
  customEmojiSpaceId,
  currentSpaceId,
}: ExpressionPanelProps) {
  const theme = useTheme();
  const tab: ExpressionTab = gifAllowed ? panel.tab : 'emoji';

  return (
    <Animated.View
      testID="expression-panel"
      accessibilityLabel={t('composer.expressionPicker')}
      style={[
        {
          position: 'absolute',
          start: 0,
          end: 0,
          bottom: 0,
          overflow: 'hidden',
          backgroundColor: theme.colors.background,
          borderTopWidth: 1,
          borderTopColor: theme.colors.border,
        },
        panel.panelStyle,
      ]}
    >
      <Animated.View style={panel.contentStyle}>
        <GestureDetector gesture={panel.handleGesture}>
          <View style={{ paddingBottom: 6 }}>
            <Touchable
              feedback="none"
              onPress={panel.toggleExpanded}
              accessibilityLabel={panel.expanded ? t('mobile.composer.collapsePanel') : t('mobile.composer.expandPanel')}
              accessibilityHint={t('mobile.composer.panelHandleHint')}
              testID="expression-handle"
              style={{ height: 22, alignItems: 'center', justifyContent: 'center' }}
            >
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: withAlpha(theme.colors.mutedForeground, 0.5) }} />
            </Touchable>
            {gifAllowed ? (
              <View style={{ paddingHorizontal: 12 }}>
                <SegmentedControl<ExpressionTab>
                  value={tab}
                  onChange={panel.setTab}
                  items={[
                    { id: 'emoji', label: t('composer.emoji') },
                    { id: 'gif', label: t('mobile.composer.gifsTab') },
                  ]}
                  accessibilityLabel={t('composer.expressionPicker')}
                  testID="expression-tabs"
                />
              </View>
            ) : null}
          </View>
        </GestureDetector>
        <View style={{ flex: 1 }}>
          {tab === 'emoji' ? (
            <EmojiPicker
              variant="panel"
              onPick={onPickEmoji}
              onBackspace={onBackspace}
              onSearchFocus={panel.onSearchFocus}
              onSearchBlur={panel.onSearchBlur}
              currentSpaceId={currentSpaceId ?? null}
              {...(customEmojiSpaceId !== undefined ? { customEmojiSpaceId } : {})}
            />
          ) : (
            <GifPicker inPanel onPick={onPickGif} onSearchFocus={panel.onSearchFocus} onSearchBlur={panel.onSearchBlur} />
          )}
        </View>
        <Animated.View style={panel.bottomPadStyle} />
      </Animated.View>
    </Animated.View>
  );
}
