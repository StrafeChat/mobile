/**
 * A colour control: preview swatch, hex field and (optional) quick swatches, with an on-screen
 * hue / saturation / brightness picker in place of the browser's <input type="color">.
 *
 * The hex field behaves like the theme editor's: validated as you type (red while it is not a
 * colour), committed as soon as it is one, and put back to the stored value on blur. Picker
 * drags preview locally and commit when the finger lifts, so a live theme preview is not
 * rebuilt on every step.
 */
import { useEffect, useRef, useState } from 'react';
import { TextInput, View } from 'react-native';
import { t } from '@web/i18n/t';
import { isHexColor, normalizeHex } from '@web/theme/themes';
import { useTheme } from '@/theme';
import { Icon, MONO_FONT, Slider, Text, Touchable, fieldBoxStyle, hitSlopFor, withAlpha } from '@/ui';
import { hexToHsv, hsvToHex, type Hsv } from '../color';

export interface ColorFieldProps {
  value: string;
  onChange: (hex: string) => void;
  label?: string;
  /** Read by screen readers for the swatch and the field ("Brand colour"). */
  name: string;
  swatches?: readonly string[];
  disabled?: boolean;
  /** Show the picker open from the start. */
  expanded?: boolean;
  testID?: string;
}

export function ColorField({ value, onChange, label, name, swatches, disabled, expanded = false, testID }: ColorFieldProps) {
  const theme = useTheme();
  const [draft, setDraft] = useState<string | null>(null);
  const [open, setOpen] = useState(expanded);
  const [hsv, setHsvState] = useState<Hsv>(() => hexToHsv(value));
  const hsvRef = useRef(hsv);
  const [dragging, setDragging] = useState(false);
  const setHsv = (next: Hsv) => {
    hsvRef.current = next;
    setHsvState(next);
  };

  // Follow the stored value unless a drag is previewing its own.
  useEffect(() => {
    if (!dragging) {
      const next = hexToHsv(value);
      hsvRef.current = next;
      setHsvState(next);
    }
  }, [value, dragging]);

  const shown = dragging ? hsvToHex(hsv) : value;
  const invalid = draft != null && !isHexColor(draft);

  /** A drag step: preview only. */
  const preview = (patch: Partial<Hsv>) => {
    setDragging(true);
    setHsv({ ...hsvRef.current, ...patch });
  };
  /** The finger lifted: commit. */
  const commit = (patch: Partial<Hsv>) => {
    const next = { ...hsvRef.current, ...patch };
    setHsv(next);
    setDragging(false);
    onChange(hsvToHex(next));
  };

  return (
    <View testID={testID} style={{ gap: 10, opacity: disabled ? 0.5 : 1 }}>
      {label ? (
        <Text variant="label" accessibilityElementsHidden importantForAccessibility="no">
          {label}
        </Text>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Touchable
          feedback="opacity"
          disabled={disabled}
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel={t('themeEditor.colorFor', { name })}
          accessibilityState={{ expanded: open, disabled: !!disabled }}
          hitSlop={hitSlopFor(36)}
          style={{
            width: 36,
            height: 36,
            borderRadius: theme.radii.md,
            backgroundColor: shown,
            borderWidth: 1,
            borderColor: withAlpha(theme.colors.foreground, 0.2),
          }}
        />
        <View style={[{ flex: 1, height: 40, justifyContent: 'center' }, fieldBoxStyle(theme, { error: invalid, disabled })]}>
          <TextInput
            value={draft ?? value}
            editable={!disabled}
            onChangeText={(raw) => {
              setDraft(raw);
              if (isHexColor(raw)) onChange(normalizeHex(raw));
            }}
            onBlur={() => setDraft(null)}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            maxLength={7}
            placeholder="#99aab5"
            placeholderTextColor={theme.colors.mutedForeground}
            accessibilityLabel={t('themeEditor.hexFor', { name })}
            style={{ paddingHorizontal: 12, color: theme.colors.foreground, fontFamily: MONO_FONT, fontSize: theme.font(14) }}
          />
        </View>
        <Touchable
          feedback="opacity"
          disabled={disabled}
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel={open ? t('mobile.settings.colorPickerHide') : t('mobile.settings.colorPickerShow')}
          hitSlop={hitSlopFor(28)}
          style={{ padding: 6 }}
        >
          <Icon name={open ? 'chevron-up' : 'eye-dropper'} size={15} tone="muted" />
        </Touchable>
      </View>
      {swatches?.length ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityRole="radiogroup">
          {swatches.map((hex) => {
            const on = value.toLowerCase() === hex.toLowerCase();
            return (
              <Touchable
                key={hex}
                feedback="opacity"
                disabled={disabled}
                onPress={() => onChange(hex)}
                accessibilityRole="radio"
                accessibilityLabel={hex}
                accessibilityState={{ checked: on, disabled: !!disabled }}
                hitSlop={hitSlopFor(30)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: theme.radii.sm,
                  backgroundColor: hex,
                  borderWidth: on ? 3 : 1,
                  borderColor: on ? theme.colors.ring : withAlpha(theme.colors.foreground, 0.15),
                }}
              />
            );
          })}
        </View>
      ) : null}
      {open ? (
        <View style={{ gap: 4 }}>
          <Slider
            label={t('mobile.settings.colorHue')}
            min={0}
            max={359}
            value={Math.round(hsv.h)}
            valueLabel={`${Math.round(hsv.h)}°`}
            disabled={disabled}
            onValueChange={(h) => preview({ h })}
            onSlidingComplete={(h) => commit({ h })}
          />
          <Slider
            label={t('mobile.settings.colorSaturation')}
            min={0}
            max={100}
            value={Math.round(hsv.s * 100)}
            valueLabel={`${Math.round(hsv.s * 100)}%`}
            disabled={disabled}
            onValueChange={(s) => preview({ s: s / 100 })}
            onSlidingComplete={(s) => commit({ s: s / 100 })}
          />
          <Slider
            label={t('mobile.settings.colorBrightness')}
            min={0}
            max={100}
            value={Math.round(hsv.v * 100)}
            valueLabel={`${Math.round(hsv.v * 100)}%`}
            disabled={disabled}
            onValueChange={(v) => preview({ v: v / 100 })}
            onSlidingComplete={(v) => commit({ v: v / 100 })}
          />
        </View>
      ) : null}
    </View>
  );
}
