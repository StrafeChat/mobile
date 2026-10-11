/**
 * A settings slider whose label follows the finger but which writes the store only when the
 * drag ends (persisting on every step would rewrite localStorage dozens of times a second and
 * re-render everything reading the setting).
 */
import { useEffect, useState } from 'react';
import { Slider } from '@/ui';

export interface LiveSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  format: (v: number) => string;
  onCommit: (v: number) => void;
  /** Also called on every step (a live preview). */
  onPreview?: (v: number) => void;
  disabled?: boolean;
  testID?: string;
}

export function LiveSlider({ value, min, max, step, label, format, onCommit, onPreview, disabled, testID }: LiveSliderProps) {
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => {
    setDraft(null);
  }, [value]);
  const shown = draft ?? value;
  return (
    <Slider
      testID={testID}
      label={label}
      min={min}
      max={max}
      step={step}
      value={shown}
      valueLabel={format(shown)}
      disabled={disabled}
      onValueChange={(v) => {
        setDraft(v);
        onPreview?.(v);
      }}
      onSlidingComplete={(v) => {
        setDraft(null);
        if (v !== value) onCommit(v);
      }}
    />
  );
}
