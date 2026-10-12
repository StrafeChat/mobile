/**
 * The emoji picker on its own in a bottom sheet - adding a reaction. Closes after a pick.
 * (The composer's emoji / GIF picker is the expression panel in the keyboard's place,
 * panel/ExpressionPanel.tsx; both draw the same EmojiPicker grid.)
 */
import { useEffect, useState } from 'react';
import { Sheet } from '@/ui';
import { EmojiPicker, type EmojiPick } from './EmojiPicker';

const SNAP_POINTS = ['60%', '92%'];

export interface EmojiPickerSheetProps {
  open: boolean;
  onClose: () => void;
  onPick: (pick: EmojiPick) => void;
  customEmojiSpaceId?: string;
  title?: string;
}

export function EmojiPickerSheet({ open, onClose, onPick, customEmojiSpaceId, title }: EmojiPickerSheetProps) {
  // Content stays mounted through the closing slide, and goes once the sheet is gone.
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
      testID="emoji-picker-sheet"
    >
      {mounted ? (
        <EmojiPicker inSheet onPick={onPick} {...(customEmojiSpaceId !== undefined ? { customEmojiSpaceId } : {})} />
      ) : null}
    </Sheet>
  );
}
