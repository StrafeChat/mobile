/**
 * The composer's expression picker as a bottom sheet: Emoji and GIF tabs (the web's
 * ExpressionPicker). The keyboard is dismissed when it opens, its search is never auto-focused
 * (that would bring the keyboard straight back), and the GIF tab only fetches once it is first
 * opened. Picking an emoji or a GIF closes it, as on the web.
 *
 * Also <EmojiPickerSheet>: the emoji picker alone in a sheet, for reactions.
 */
import { useEffect, useState } from 'react';
import { Keyboard, View } from 'react-native';
import type { GifResult } from '@web/lib/gif/providers';
import { t } from '@web/i18n/t';
import { SegmentedControl, Sheet } from '@/ui';
import { EmojiPicker, type EmojiPick } from './EmojiPicker';
import { GifPicker } from './GifPicker';

export type ExpressionTab = 'emoji' | 'gif';

const SNAP_POINTS = ['60%', '92%'];

export interface ExpressionSheetProps {
  open: boolean;
  tab: ExpressionTab;
  onTabChange: (tab: ExpressionTab) => void;
  onClose: () => void;
  onPickEmoji: (pick: EmojiPick) => void;
  onPickGif: (gif: GifResult) => void;
  /** False hides the GIF tab (editing a message: a GIF is a new message). */
  gifAllowed?: boolean;
  customEmojiSpaceId?: string;
}

export function ExpressionSheet({
  open,
  tab,
  onTabChange,
  onClose,
  onPickEmoji,
  onPickGif,
  gifAllowed = true,
  customEmojiSpaceId,
}: ExpressionSheetProps) {
  const current: ExpressionTab = gifAllowed ? tab : 'emoji';
  // Content stays mounted through the closing slide, and goes once the sheet is gone.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (!open) return;
    setMounted(true);
    Keyboard.dismiss();
  }, [open]);

  return (
    <Sheet
      open={open}
      onClose={() => {
        setMounted(false);
        onClose();
      }}
      snapPoints={SNAP_POINTS}
      padded={false}
      contentStyle={{ flex: 1 }}
      testID="expression-sheet"
    >
      <View style={{ flex: 1 }} accessibilityLabel={t('composer.expressionPicker')}>
        {gifAllowed ? (
          <View style={{ paddingHorizontal: 12, paddingBottom: 4 }}>
            <SegmentedControl<ExpressionTab>
              value={current}
              onChange={onTabChange}
              items={[
                { id: 'emoji', label: t('composer.emoji'), icon: 'face-smile' },
                { id: 'gif', label: t('gif.tab'), icon: 'film' },
              ]}
              accessibilityLabel={t('composer.expressionPicker')}
              testID="expression-tabs"
            />
          </View>
        ) : null}
        {mounted ? (
          current === 'emoji' ? (
            <EmojiPicker inSheet onPick={onPickEmoji} {...(customEmojiSpaceId !== undefined ? { customEmojiSpaceId } : {})} />
          ) : (
            <GifPicker inSheet onPick={onPickGif} />
          )
        ) : null}
      </View>
    </Sheet>
  );
}

export interface EmojiPickerSheetProps {
  open: boolean;
  onClose: () => void;
  onPick: (pick: EmojiPick) => void;
  customEmojiSpaceId?: string;
  title?: string;
}

/** The emoji picker on its own (adding a reaction). Closes after a pick. */
export function EmojiPickerSheet({ open, onClose, onPick, customEmojiSpaceId, title }: EmojiPickerSheetProps) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  return (
    <Sheet
      open={open}
      onClose={() => {
        setMounted(false);
        onClose();
      }}
      snapPoints={SNAP_POINTS}
      padded={false}
      contentStyle={{ flex: 1 }}
      title={title}
    >
      {mounted ? (
        <EmojiPicker inSheet onPick={onPick} {...(customEmojiSpaceId !== undefined ? { customEmojiSpaceId } : {})} />
      ) : null}
    </Sheet>
  );
}
